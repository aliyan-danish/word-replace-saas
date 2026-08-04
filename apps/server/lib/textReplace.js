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

// String.replace() treats $ specially in the replacement argument ($&, $1, $$, etc.).
// Doubling each $ ($ -> $$) makes the replacement insert literally, so a value like
// "$5" is written as "$5" rather than being interpreted as a replacement pattern.
function escapeReplacementDollarSigns(text) {
  return text.replace(/\$/g, '$$$$');
}

module.exports = { escapeRegex, buildSearchRegex, escapeReplacementDollarSigns };
