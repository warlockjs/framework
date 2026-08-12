import path from "node:path";
import { describe, expect, it } from "vitest";
import { Path } from "../../../src/utils/normalized-path";

/**
 * `Path` is a thin wrapper over node:path that forces forward slashes so the
 * framework holds one canonical separator on every platform.
 *
 * It lived under `dev-server/` and was moved to `utils/` once measurement
 * showed production modules importing it from there — which put the whole
 * dev-server directory into every consumer's module graph.
 */
describe("Path.normalize", () => {
  it("converts backslashes to forward slashes", () => {
    expect(Path.normalize("a\\b\\c.ts")).toBe("a/b/c.ts");
  });

  it("leaves forward-slash paths untouched", () => {
    expect(Path.normalize("a/b/c.ts")).toBe("a/b/c.ts");
  });

  it("handles mixed separators", () => {
    expect(Path.normalize("a\\b/c\\d.ts")).toBe("a/b/c/d.ts");
  });
});

describe("Path.join", () => {
  it("joins segments and normalizes the result", () => {
    expect(Path.join("a", "b", "c.ts")).toBe("a/b/c.ts");
  });

  it("collapses redundant segments like node:path does", () => {
    expect(Path.join("a", "..", "b")).toBe("b");
  });
});

describe("Path.dirname / basename / extname", () => {
  it("dirname normalizes its output", () => {
    expect(Path.dirname("a\\b\\c.ts")).toBe("a/b");
  });

  it("basename returns the file name", () => {
    expect(Path.basename("a/b/c.ts")).toBe("c.ts");
  });

  it("basename strips a supplied extension", () => {
    expect(Path.basename("a/b/c.ts", ".ts")).toBe("c");
  });

  it("extname returns the extension", () => {
    expect(Path.extname("a/b/c.ts")).toBe(".ts");
  });
});

describe("Path.toRelative / toAbsolute", () => {
  it("toRelative produces a cwd-relative forward-slash path", () => {
    const absolute = path.resolve(process.cwd(), "src", "app", "main.ts");

    expect(Path.toRelative(absolute)).toBe("src/app/main.ts");
  });

  it("toAbsolute resolves against cwd and normalizes", () => {
    const expected = Path.normalize(path.resolve(process.cwd(), "src/app/main.ts"));

    expect(Path.toAbsolute("src/app/main.ts")).toBe(expected);
  });

  it("toRelative then toAbsolute is a round-trip", () => {
    const absolute = Path.normalize(path.resolve(process.cwd(), "src/x/y.ts"));

    expect(Path.toAbsolute(Path.toRelative(absolute))).toBe(absolute);
  });
});
