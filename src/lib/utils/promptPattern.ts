const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Compile a PS1-like prompt pattern into a RegExp for extracting the directory.
 *
 * Placeholders:
 *   \h — hostname  (matches \S+)
 *   \u — username  (matches \S+)
 *   \d — directory (captured group, matches .+? non-greedy) — exactly one required
 *   \p — prompt terminator (matches [$#%>])
 *
 * All other characters are treated as literals (regex-escaped).
 * Whitespace in the pattern matches \s+ (flexible spacing).
 * The regex is anchored to end-of-line with \s*$.
 */
export function compilePromptPattern(pattern: string): RegExp | null {
  const dCount = (pattern.match(/\\d/g) || []).length;
  if (dCount !== 1) return null;

  let regex = '';
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === 'h' || next === 'u') {
        regex += '\\S+';
        i += 2;
        continue;
      }
      if (next === 'd') {
        regex += '(.+?)';
        i += 2;
        continue;
      }
      if (next === 'p') {
        regex += '[$#%>]';
        i += 2;
        continue;
      }
      // Unrecognized escape — treat backslash as literal
      regex += '\\\\';
      i++;
      continue;
    }

    if (/\s/.test(pattern[i])) {
      regex += '\\s+';
      while (i < pattern.length && /\s/.test(pattern[i])) i++;
      continue;
    }

    // Literal character — escape if regex-special
    regex += pattern[i].replace(REGEX_SPECIAL, '\\$&');
    i++;
  }

  regex += '\\s*$';

  try {
    return new RegExp(regex);
  } catch {
    return null;
  }
}

let cachedPatterns: string[] = [];
let compiledPatterns: RegExp[] = [];

/**
 * Get compiled RegExps from user prompt patterns, with caching.
 * Recompiles only when the pattern array contents change.
 */
export function getCompiledPatterns(patterns: string[]): RegExp[] {
  if (
    patterns.length !== cachedPatterns.length ||
    patterns.some((p, i) => p !== cachedPatterns[i])
  ) {
    cachedPatterns = [...patterns];
    compiledPatterns = patterns
      .map(compilePromptPattern)
      .filter((r): r is RegExp => r !== null);
  }
  return compiledPatterns;
}
