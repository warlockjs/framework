import { describe, expect, it } from "vitest";
import { compileLinearRegex, UnsupportedPatternError } from "./linear-regex";

/** Patterns covering the supported syntax, checked against the built-in engine. */
const PATTERNS = [
  "foo",
  "fo+",
  "^foo",
  "foo$",
  "^$",
  "a.c",
  "a|b|cd",
  "(ab)+c",
  "(?:ab|a)*b",
  "(?<word>\\w+)-\\d",
  "colou?r",
  "a{2}",
  "a{2,}b",
  "a{1,3}?b",
  "x{",
  "a}",
  "]",
  "\\bfoo\\b",
  "\\Bo\\B",
  "\\d+\\.\\d*",
  "\\D\\W\\S",
  "\\s+$",
  "[a-c]+",
  "[^a-c]",
  "[\\w-]+",
  "[\\d_.]",
  "[]",
  "[^]",
  "[\\b]",
  "[-a]",
  "\\x41\\u0062",
  "\\t|\\n",
  "\\.\\*\\+\\?\\(\\)",
  "\\0",
  "(a|)+b",
  "(a*)*$",
  "K",
  "é",
  "ſ",
  "[k-m]",
];

const TEXTS = [
  "",
  "foo",
  "a foo b",
  "food",
  "colour color colr",
  "aab aaab",
  "ab abc ababc",
  "x{ a} ]",
  "12.5 7.",
  "tab\there",
  "trailing   ",
  "KELVIN K kelvin",
  "É é",
  "ſ s S",
  "word-1",
  "b",
  "\u0008",
  "\0",
  "ABab",
];

describe("compileLinearRegex — same answers as the built-in engine", () => {
  for (const flags of ["", "i"]) {
    it(`matches like RegExp with flags "${flags}"`, () => {
      for (const pattern of PATTERNS) {
        const native = new RegExp(pattern, flags);
        const linear = compileLinearRegex(pattern, { ignoreCase: flags === "i" });

        for (const text of TEXTS) {
          expect(linear.test(text), `/${pattern}/${flags} on ${JSON.stringify(text)}`).toBe(
            native.test(text),
          );
        }
      }
    });
  }

  it("keeps the built-in syntax errors", () => {
    expect(() => compileLinearRegex("(a")).toThrow(SyntaxError);
    expect(() => compileLinearRegex("*a")).toThrow(SyntaxError);
  });

  it("refuses lookarounds and backreferences", () => {
    for (const pattern of ["a(?=b)", "a(?!b)", "(?<=a)b", "(?<!a)b", "(a)\\1", "(?<n>a)\\k<n>"]) {
      expect(() => compileLinearRegex(pattern), pattern).toThrow(UnsupportedPatternError);
    }
  });

  it("refuses a pattern that expands past maxStates", () => {
    expect(() => compileLinearRegex("(abc){2000}", { maxStates: 4000 })).toThrow(/more than 4000/);
  });
});

describe("compileLinearRegex — work stays linear on hostile input", () => {
  // Each pair takes seconds to forever with a backtracking engine. The
  // linear matcher visits at most (states × 2) per character, so the step
  // count is bounded by a small multiple of program size × line length.
  const cases: Array<[string, string]> = [
    ["((a)+)+$", `${"a".repeat(40)}!`],
    ["(a|a)+$", `${"a".repeat(40)}!`],
    ["(\\w|\\d)+$", `${"a".repeat(2000)}!`],
    ["\\d*\\d*\\d*\\d*\\d*\\D", "1".repeat(2000)],
    ["(a*)*b", "a".repeat(2000)],
    [`${"[^/]*".repeat(8)}Z`, "a".repeat(2000)],
  ];

  for (const [pattern, text] of cases) {
    it(`/${pattern}/ on ${text.length} characters`, () => {
      const regex = compileLinearRegex(pattern);

      expect(regex.test(text)).toBe(false);
      expect(regex.steps).toBeLessThanOrEqual(2 * regex.size * (text.length + 1));
    });
  }

  it("skips a line that lacks a literal the pattern requires without stepping", () => {
    const regex = compileLinearRegex("\\d*\\d*\\d*\\d*\\d*x");

    expect(regex.test("1".repeat(2000))).toBe(false);
    expect(regex.steps).toBe(0);
  });
});
