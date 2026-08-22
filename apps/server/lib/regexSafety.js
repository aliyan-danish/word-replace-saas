// Regex-mode safety: static nested-quantifier reject, then compile with
// @adguard/re2-wasm (Google RE2 as WASM — no native addon). Never fall back to
// V8 RegExp for user patterns. Lookaheads/backrefs fail compile with a 400.

const { RE2 } = require('@adguard/re2-wasm');

const MAX_REGEX_PATTERN_LENGTH = 256;

class RegexValidationError extends Error {}

function re2Flags(caseSensitive) {
  return caseSensitive ? 'gu' : 'giu';
}

function skipQuantifier(source, index) {
  if (index >= source.length) return index;
  const ch = source[index];
  if (ch === '*' || ch === '+' || ch === '?') {
    index += 1;
    if (source[index] === '?') index += 1;
    return index;
  }
  if (ch === '{') {
    const end = source.indexOf('}', index);
    if (end === -1) return index + 1;
    index = end + 1;
    if (source[index] === '?') index += 1;
    return index;
  }
  return index;
}

function skipCharClass(source, index) {
  // index is on '['
  index += 1;
  if (source[index] === '^') index += 1;
  if (source[index] === ']') index += 1;
  while (index < source.length && source[index] !== ']') {
    if (source[index] === '\\') index += 2;
    else index += 1;
  }
  return index < source.length ? index + 1 : index;
}

// Star-height > 1: a group that already contains a quantifier is itself quantified.
// Catches (a+)+, (?:a+)*, (a{1,})+. Does not catch overlapping alts like (a|aa)+
// — those are allowed here; RE2 is the hang backstop.
function hasNestedQuantifiers(source) {
  let i = 0;
  const s = String(source);

  function parseUntil(stopChar) {
    let hasQuantifier = false;
    let nested = false;
    while (i < s.length && s[i] !== stopChar) {
      if (s[i] === '\\') {
        i += 2;
        continue;
      }
      if (s[i] === '[') {
        i = skipCharClass(s, i);
        const after = skipQuantifier(s, i);
        if (after !== i) {
          hasQuantifier = true;
          i = after;
        }
        continue;
      }
      if (s[i] === '(') {
        i += 1;
        if (s[i] === '?') {
          i += 1;
          if (s[i] === ':') i += 1;
          else if (s[i] === '=' || s[i] === '!') i += 1;
          else if (s[i] === '<' && (s[i + 1] === '=' || s[i + 1] === '!')) i += 2;
        }
        const inner = parseUntil(')');
        if (s[i] === ')') i += 1;
        const after = skipQuantifier(s, i);
        const groupQuantified = after !== i;
        i = after;
        if (inner.nested) nested = true;
        // Inner already had a quantifier and this group is quantified too —
        // including wrappers like ((a+))+ where the inner group itself is not.
        if (inner.hasQuantifier && groupQuantified) nested = true;
        if (groupQuantified || inner.hasQuantifier) hasQuantifier = true;
        continue;
      }
      i += 1;
      const after = skipQuantifier(s, i);
      if (after !== i) {
        hasQuantifier = true;
        i = after;
      }
    }
    return { hasQuantifier, nested };
  }

  return parseUntil(null).nested;
}

function hasLookaroundOrBackref(source) {
  const s = String(source);
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\') {
      const next = s[i + 1];
      if (next >= '1' && next <= '9') return true;
      i += 2;
      continue;
    }
    if (s[i] === '[') {
      i = skipCharClass(s, i);
      continue;
    }
    if (s[i] === '(' && s[i + 1] === '?') {
      const kind = s[i + 2];
      if (kind === '=' || kind === '!') return true;
      if (kind === '<' && (s[i + 3] === '=' || s[i + 3] === '!')) return true;
    }
    i += 1;
  }
  return false;
}

function mapRe2CompileError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/lookaround|lookahead|lookbehind|perl operator:\s*\(\?[=!<]|backreference|invalid escape sequence:\\[1-9]/i.test(msg)) {
    return 'Lookaheads, lookbehinds, and backreferences are not supported in regex mode.';
  }
  return `Invalid regular expression: ${msg}`;
}

function compileUserRegex(source, { caseSensitive }) {
  try {
    return new RE2(source, re2Flags(caseSensitive));
  } catch (err) {
    throw new RegexValidationError(mapRe2CompileError(err));
  }
}

function compileCombinedUserRegex(words, { caseSensitive }) {
  const unique = [];
  const seen = new Set();
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    unique.push(word);
  }
  unique.sort((a, b) => b.length - a.length);
  const combined = unique.map((word) => `(?:${word})`).join('|');
  return compileUserRegex(combined, { caseSensitive });
}

function validateRegexPatterns(words, { caseSensitive } = {}) {
  if (!Array.isArray(words) || words.length === 0) {
    return { error: 'Provide at least one non-empty search word.' };
  }
  for (const word of words) {
    if (typeof word !== 'string' || word.length === 0) {
      return { error: 'Every search word must be a non-empty string.' };
    }
    if (word.length > MAX_REGEX_PATTERN_LENGTH) {
      return {
        error: `Each regex pattern must be at most ${MAX_REGEX_PATTERN_LENGTH} characters.`,
      };
    }
    if (hasLookaroundOrBackref(word)) {
      return {
        error: 'Lookaheads, lookbehinds, and backreferences are not supported in regex mode.',
      };
    }
    if (hasNestedQuantifiers(word)) {
      return {
        error:
          'This regex pattern is not allowed because it uses nested quantifiers, which can cause catastrophic backtracking.',
      };
    }
    try {
      compileUserRegex(word, { caseSensitive: Boolean(caseSensitive) });
    } catch (err) {
      return { error: err instanceof RegexValidationError ? err.message : mapRe2CompileError(err) };
    }
  }
  try {
    compileCombinedUserRegex(words, { caseSensitive: Boolean(caseSensitive) });
  } catch (err) {
    return { error: err instanceof RegexValidationError ? err.message : mapRe2CompileError(err) };
  }
  return { ok: true };
}

module.exports = {
  MAX_REGEX_PATTERN_LENGTH,
  RegexValidationError,
  hasNestedQuantifiers,
  hasLookaroundOrBackref,
  compileUserRegex,
  compileCombinedUserRegex,
  validateRegexPatterns,
};
