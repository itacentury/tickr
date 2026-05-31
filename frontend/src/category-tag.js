/**
 * Inline category tag parser.
 *
 * Recognises an optional trailing `#Name` or `#"Name with spaces"` token
 * on an item input string. Pure functions only — no DOM, no state.
 */

const QUOTED_TRAILING = /\s+#"([^"]+)"\s*$/;
// Bare names exclude `"` so unclosed quoted forms (`#"Foo`) stay literal
// instead of being mis-parsed as a bareword with a leading quote.
const BARE_TRAILING = /\s+#([^\s"]+)\s*$/;

/**
 * Strip a trailing category tag and return the cleaned text plus the raw
 * category name (whitespace-trimmed) the user typed.
 *
 * @param {string} input - Raw input value.
 * @returns {{ cleanText: string, categoryName: string | null }}
 */
export function parseCategoryTag(input) {
  const trimmed = input.trim();
  if (!trimmed) return { cleanText: "", categoryName: null };

  const quoted = trimmed.match(QUOTED_TRAILING);
  if (quoted) {
    return {
      cleanText: trimmed.slice(0, quoted.index).trimEnd(),
      categoryName: quoted[1].trim(),
    };
  }

  const bare = trimmed.match(BARE_TRAILING);
  if (bare) {
    return {
      cleanText: trimmed.slice(0, bare.index).trimEnd(),
      categoryName: bare[1].trim(),
    };
  }

  return { cleanText: trimmed, categoryName: null };
}

/**
 * Detect an active autocomplete trigger: an unfinished `#prefix` (or bare `#`)
 * at the end of the input, used while the user is still typing.
 *
 * Returns null when no trigger is present (e.g. cursor mid-text, no `#`, or
 * the `#token` is already followed by whitespace — meaning it has been
 * "committed" and a new word is being typed).
 *
 * @param {string} input - Raw input value.
 * @returns {{ prefix: string, start: number } | null}
 *   `prefix` is what the user typed after `#` (may be empty), `start` is the
 *   index of the `#` character — useful when replacing the token on selection.
 */
export function detectTrigger(input) {
  const match = input.match(/(^|\s)#([^\s"]*)$/);
  if (!match) return null;
  const hashIndex = match.index + match[1].length;
  return { prefix: match[2], start: hashIndex };
}

/**
 * Build the canonical tag string for a category name, quoting if needed.
 *
 * @param {string} name - The exact category name.
 * @returns {string} `#Name` or `#"Name with spaces"`.
 */
export function formatTag(name) {
  return /\s/.test(name) ? `#"${name}"` : `#${name}`;
}
