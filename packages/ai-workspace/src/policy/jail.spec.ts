import { describe, expect, it } from "vitest";
import { compileGlob, matchesAnyGlob } from "./jail";

describe("compileGlob", () => {
  it("matches the glob subset: *, ** and ?", () => {
    expect(compileGlob("src/*.ts").test("src/a.ts")).toBe(true);
    expect(compileGlob("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(compileGlob("src/**/*.ts").test("src/a/b/c.ts")).toBe(true);
    expect(compileGlob("src/**/*.ts").test("src/c.ts")).toBe(true);
    expect(compileGlob("**").test("any/depth/file")).toBe(true);
    expect(compileGlob("?.md").test("a.md")).toBe(true);
    expect(compileGlob("?.md").test("/.md")).toBe(false);
    expect(compileGlob("a.b").test("axb")).toBe(false);
    expect(compileGlob("(x)+[y]").test("(x)+[y]")).toBe(true);
  });

  it("compiles each glob once and reuses it", () => {
    expect(compileGlob(".env*")).toBe(compileGlob(".env*"));
  });

  it("answers wildcard-heavy globs without backtracking", () => {
    // As a regular expression, `*?` × 20 then `Z` needs exponential time on a
    // long name that does not end in Z.
    const name = "a".repeat(200);

    expect(matchesAnyGlob(name, [`${"*?".repeat(20)}Z`])).toBe(false);
    expect(matchesAnyGlob(name, [`${"*a".repeat(40)}*`])).toBe(true);
    expect(matchesAnyGlob(`${name}/x`, [`${"**".repeat(30)}y`])).toBe(false);
  });

  it("keeps the bare-name directory rule", () => {
    expect(matchesAnyGlob(".git/config", [".git"])).toBe(true);
    expect(matchesAnyGlob("src/.git", [".git"])).toBe(false);
  });
});
