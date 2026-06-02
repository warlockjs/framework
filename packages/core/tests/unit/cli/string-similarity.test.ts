import { describe, expect, it } from "vitest";
import {
  findSimilar,
  levenshteinDistance,
  startsWithAny,
} from "../../../src/cli/string-similarity";

/**
 * Unit coverage for the fuzzy-match helpers behind "did you mean?" command
 * suggestions: Levenshtein edit distance, the threshold/sort/cap wrapper
 * `findSimilar`, and the case-insensitive prefix check `startsWithAny`.
 */
describe("levenshteinDistance", () => {
  it("is zero for identical strings", () => {
    expect(levenshteinDistance("build", "build")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(levenshteinDistance("Build", "build")).toBe(0);
  });

  it("counts a single substitution", () => {
    expect(levenshteinDistance("build", "guild")).toBe(1);
  });

  it("counts a single insertion/deletion", () => {
    expect(levenshteinDistance("dev", "deva")).toBe(1);
    expect(levenshteinDistance("seed", "see")).toBe(1);
  });

  it("equals the length when one string is empty", () => {
    expect(levenshteinDistance("", "migrate")).toBe(7);
    expect(levenshteinDistance("migrate", "")).toBe(7);
  });

  it("handles the classic kitten/sitting case", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});

describe("findSimilar", () => {
  it("returns the closest match for a typo", () => {
    const suggestions = findSimilar("biuld", ["build", "dev", "start", "test"]);

    expect(suggestions[0]).toEqual({ value: "build", distance: 2 });
  });

  it("excludes exact matches (distance 0)", () => {
    expect(findSimilar("build", ["build", "guild"])).toEqual([{ value: "guild", distance: 1 }]);
  });

  it("sorts results by ascending distance", () => {
    const suggestions = findSimilar("migrate", ["migrat", "migrated", "seed"]);

    const distances = suggestions.map((suggestion) => suggestion.distance);

    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("drops candidates beyond the max distance", () => {
    expect(findSimilar("a", ["abcd", "xyzw"], 2)).toEqual([]);
  });

  it("caps the number of results", () => {
    const suggestions = findSimilar("test", ["tost", "tester", "best", "rest", "nest"], 3, 2);

    expect(suggestions).toHaveLength(2);
  });

  it("returns an empty array when nothing is close enough", () => {
    expect(findSimilar("zzzzz", ["build", "dev"])).toEqual([]);
  });
});

describe("startsWithAny", () => {
  it("matches a prefix regardless of case", () => {
    expect(startsWithAny("Generate", ["gen"])).toBe(true);
  });

  it("returns true if any prefix matches", () => {
    expect(startsWithAny("migrate", ["seed", "mig"])).toBe(true);
  });

  it("returns false when no prefix matches", () => {
    expect(startsWithAny("build", ["dev", "seed"])).toBe(false);
  });

  it("returns false for an empty prefix list", () => {
    expect(startsWithAny("build", [])).toBe(false);
  });
});
