import { afterEach, describe, expect, it, vi } from "vitest";
import { describeMiss } from "./match";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeMiss", () => {
  it("shows the file lines closest to the missed text", () => {
    const content = "function total(items) {\n  return items.length;\n}\n";
    const hint = describeMiss(content, "  return items.size;", "  return items.count;");

    expect(hint).toBe("Closest text in the file (lines 2-2):\n2:   return items.length;");
  });

  it("keeps the earliest best line on a tie", () => {
    const content = "alpha beta\nalpha beta\n";

    expect(describeMiss(content, "alpha beta gamma", "x")).toContain("lines 1-1");
  });

  it("bounds the work for a huge oldString against a huge file", () => {
    const file = Array.from(
      { length: 20_000 },
      (_, index) => `const value${index % 300} = compute(item${index}, options);`,
    ).join("\n");
    const oldString = Array.from(
      { length: 2_000 },
      (_, index) => `const value${index % 300} = compute(item${index}, settings);`,
    ).join("\n");
    const tokenize = vi.spyOn(String.prototype, "match");

    const hint = describeMiss(file, oldString, "not in the file");

    // One tokenization per file line, and at most 64 of the 2,000 wanted lines.
    expect(tokenize.mock.calls.length).toBeLessThanOrEqual(20_000 + 64);
    expect(hint).toMatch(/^Closest text in the file/);
  });
});
