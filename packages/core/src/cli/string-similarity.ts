/**
 * String similarity utilities for CLI command suggestions
 * Uses Levenshtein distance algorithm for fuzzy matching
 */

/**
 * Calculate the Levenshtein distance between two strings
 * Lower distance = more similar
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Distance (number of edits required to transform str1 to str2)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  const len1 = s1.length;
  const len2 = s2.length;

  // Create matrix
  const matrix: number[][] = Array.from({ length: len1 + 1 }, (_, i) =>
    Array.from({ length: len2 + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  // Fill matrix
  //
  // Every index below is in bounds by construction — the matrix is built
  // `len1 + 1` by `len2 + 1` immediately above. Under
  // `noUncheckedIndexedAccess` the compiler still types each read as possibly
  // undefined, and the rows are hoisted rather than defaulted: a `?? 0` in the
  // middle of a distance calculation would not fail, it would quietly return a
  // SHORTER distance and change which command the CLI suggests.
  for (let i = 1; i <= len1; i++) {
    const previousRow = matrix[i - 1];
    const currentRow = matrix[i];

    if (previousRow === undefined || currentRow === undefined) continue;

    for (let j = 1; j <= len2; j++) {
      const deletion = previousRow[j];
      const insertion = currentRow[j - 1];
      const substitution = previousRow[j - 1];

      if (deletion === undefined || insertion === undefined || substitution === undefined) {
        continue;
      }

      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;

      currentRow[j] = Math.min(deletion + 1, insertion + 1, substitution + cost);
    }
  }

  // `len1`/`len2` index the last row and column, both allocated above. Falling
  // back to the worst-case distance (the longer string's length) rather than 0
  // keeps an unreadable result looking MAXIMALLY dissimilar — a 0 would make
  // it look like a perfect match and promote it to the top suggestion.
  return matrix[len1]?.[len2] ?? Math.max(len1, len2);
}

/**
 * Suggestion result with similarity score
 */
export type Suggestion = {
  /** The suggested value */
  value: string;
  /** Distance score (lower = more similar) */
  distance: number;
};

/**
 * Find similar strings from a list
 *
 * @param input - The input string to find matches for
 * @param candidates - List of candidate strings
 * @param maxDistance - Maximum distance to consider (default: 3)
 * @param maxResults - Maximum number of results to return (default: 3)
 * @returns Array of suggestions sorted by similarity
 *
 * @example
 * ```typescript
 * findSimilar("biuld", ["build", "dev", "start", "test"])
 * // Returns: [{ value: "build", distance: 1 }]
 * ```
 */
export function findSimilar(
  input: string,
  candidates: string[],
  maxDistance: number = 3,
  maxResults: number = 3,
): Suggestion[] {
  const results: Suggestion[] = [];

  for (const candidate of candidates) {
    const distance = levenshteinDistance(input, candidate);

    if (distance <= maxDistance && distance > 0) {
      results.push({ value: candidate, distance });
    }
  }

  // Sort by distance (most similar first)
  results.sort((a, b) => a.distance - b.distance);

  return results.slice(0, maxResults);
}

/**
 * Check if a string starts with any of the given prefixes
 * Useful for command name matching
 */
export function startsWithAny(str: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => str.toLowerCase().startsWith(prefix.toLowerCase()));
}
