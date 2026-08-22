const { compileCombinedUserRegex, compileUserRegex } = require('./regexSafety');

// Shared word-search / replacement helpers.
//
// These live here (rather than inside jobs.controller.js) so the BullMQ worker can
// reuse the EXACT same logic without importing the Express controller and its
// unrelated dependencies (multer, adm-zip, etc.). The controller and the worker both
// import from this single module, so search and replace can never diverge.

// Escape regex metacharacters so the user's word is matched literally. Without this,
// a word like "a.b" or "$5" would be interpreted as a regex pattern. `$&` re-inserts
// the matched special character, prefixed with a backslash.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Single source of truth for how a "word" becomes a regex, shared by search and
// replace so replacement always matches exactly what search would have counted:
// - literal (escaped) word
// - optional \b...\b whole-word boundaries
// - case-insensitive unless caseSensitive
// - always global so every occurrence is matched
function buildSearchRegex(word, { caseSensitive, wholeWord }) {
  const escaped = escapeRegex(word);
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
  const flags = caseSensitive ? 'g' : 'gi';
  return new RegExp(pattern, flags);
}

// One regex for every target word so replace is a single pass over ORIGINAL content.
// Longer words are listed first so, when whole-word is off, "category" wins over "cat"
// at the same starting position.
//
// Known limitation when wholeWord is OFF: overlapping / substring pairs are not fully
// solvable. Longest-first helps at the same start index, but pairs like "ca"+"at" in
// "cat" still leave one match unused. Whole-word matching avoids the cat/category
// class of mistakes; we are not trying to solve every overlap here.
function buildMultiWordRegex(words, { caseSensitive, wholeWord, isRegex }) {
  // Regex mode: user patterns as-is (no escapeRegex, no auto \b). Combined
  // longest-first so multi-pattern search is still one pass, same as literals.
  // wholeWord is ignored — callers write \b themselves.
  if (isRegex) {
    return compileCombinedUserRegex(words, { caseSensitive });
  }
  const unique = [];
  const seen = new Set();
  for (const word of words) {
    const key = caseSensitive ? word : word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(word);
  }
  unique.sort((a, b) => b.length - a.length);
  const alts = unique.map((word) => {
    const escaped = escapeRegex(word);
    return wholeWord ? `\\b${escaped}\\b` : escaped;
  });
  const flags = caseSensitive ? 'g' : 'gi';
  return new RegExp(`(?:${alts.join('|')})`, flags);
}

function findPairForMatch(matched, pairs, caseSensitive, isRegex) {
  if (!isRegex) {
    return pairs.find((pair) =>
      caseSensitive
        ? pair.word === matched
        : pair.word.toLowerCase() === matched.toLowerCase()
    );
  }
  // Which user pattern produced this match: every pattern that fully matches
  // the captured text, then longest source wins (same longest-first rule as
  // the combined regex, not sequential per-pair application).
  const hits = [];
  for (const pair of pairs) {
    try {
      const re = compileUserRegex(pair.word, { caseSensitive });
      re.lastIndex = 0;
      const found = re.exec(matched);
      if (found && found.index === 0 && found[0] === matched) hits.push(pair);
    } catch {
      continue;
    }
  }
  hits.sort((a, b) => b.word.length - a.word.length);
  return hits[0] || null;
}

// String.replace() treats $ specially in the replacement argument ($&, $1, $$, etc.).
// Doubling each $ ($ -> $$) makes the replacement insert literally, so a value like
// "$5" is written as "$5" rather than being interpreted as a replacement pattern.
function escapeReplacementDollarSigns(text) {
  return text.replace(/\$/g, '$$$$');
}

// True when the string has at least one cased letter and every cased letter is upper.
function isAllUpperCase(text) {
  return text === text.toUpperCase() && text !== text.toLowerCase();
}

// True when the string has at least one cased letter and every cased letter is lower.
function isAllLowerCase(text) {
  return text === text.toLowerCase() && text !== text.toUpperCase();
}

// "Project" style: first cased letter is upper, and the rest is all lowercase.
// A single uppercase letter is treated as ALL UPPERCASE (checked first), not title case.
function isCapitalized(text) {
  if (text.length < 2) return false;
  const first = text[0];
  const rest = text.slice(1);
  const firstIsUpper = first === first.toUpperCase() && first !== first.toLowerCase();
  return firstIsUpper && rest === rest.toLowerCase() && !isAllUpperCase(text);
}

// Copy the matched word's simple case pattern onto the replacement text.
// Mixed junk like "PrOjEcT" (and strings with no cased letters) stays as typed.
function applyCasePattern(matchedText, replacementText) {
  if (isAllUpperCase(matchedText)) return replacementText.toUpperCase();
  if (isCapitalized(matchedText)) {
    if (replacementText.length === 0) return replacementText;
    return replacementText[0].toUpperCase() + replacementText.slice(1).toLowerCase();
  }
  if (isAllLowerCase(matchedText)) return replacementText.toLowerCase();
  return replacementText;
}

function countKey(word, caseSensitive, isRegex) {
  return caseSensitive || isRegex ? word : word.toLowerCase();
}

function emptyWordCounts(words, caseSensitive, isRegex) {
  return Object.fromEntries(
    words.map((word) => [countKey(word, caseSensitive, isRegex), 0])
  );
}

function addWordCounts(target, source, words, caseSensitive, isRegex) {
  for (const word of words) {
    const key = countKey(word, caseSensitive, isRegex);
    target[key] = (target[key] ?? 0) + (source[key] ?? 0);
  }
  return target;
}

// Count matches in a plain-text string. HTML/XML/DOCX handlers feed this only the
// visible text they extracted, so matching never forks per format.
function countPlainText(text, words, { caseSensitive, wholeWord, isRegex }) {
  const regex = buildMultiWordRegex(words, { caseSensitive, wholeWord, isRegex });
  const lookupPairs = words.map((word) => ({ word }));
  const counts = emptyWordCounts(words, caseSensitive, isRegex);
  regex.lastIndex = 0;
  const matches = text.match(regex) ?? [];
  for (const matched of matches) {
    if (!matched) continue;
    const pair = findPairForMatch(matched, lookupPairs, caseSensitive, isRegex);
    if (!pair) continue;
    const key = countKey(pair.word, caseSensitive, isRegex);
    counts[key] += 1;
  }
  return counts;
}

// Single-pass replace on a plain-text string. applyCasePattern is used exactly as
// in the .txt worker path; this is the shared implementation formats call into.
// Replacement text is always literal (the callback return is not scanned for $1).
function replacePlainText(text, pairs, { caseSensitive, wholeWord, isRegex }) {
  const regex = buildMultiWordRegex(
    pairs.map((pair) => pair.word),
    { caseSensitive, wholeWord, isRegex }
  );
  regex.lastIndex = 0;
  let count = 0;
  const replaced = text.replace(regex, (matched) => {
    if (!matched) return matched;
    const pair = findPairForMatch(matched, pairs, caseSensitive, isRegex);
    if (!pair) return matched;
    count += 1;
    if (caseSensitive) return pair.replacement;
    return applyCasePattern(matched, pair.replacement);
  });
  return { text: replaced, count };
}

module.exports = {
  escapeRegex,
  buildSearchRegex,
  buildMultiWordRegex,
  findPairForMatch,
  escapeReplacementDollarSigns,
  applyCasePattern,
  countKey,
  emptyWordCounts,
  addWordCounts,
  countPlainText,
  replacePlainText,
};
