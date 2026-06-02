import { describe, expect, it } from "vitest";
import { sourceSlug } from "../../src/dev-server/loader/source-slug";

describe("sourceSlug", () => {
  it("uses the last three path segments without extension", () => {
    expect(sourceSlug("D:/proj/src/app/vectors/utils/locales.ts")).toBe(
      "vectors-utils-locales",
    );
  });

  it("normalizes Windows backslashes", () => {
    expect(sourceSlug("D:\\proj\\src\\app\\users\\user.model.ts")).toBe(
      "app-users-user-model",
    );
  });

  it("strips .ts/.tsx/.js/.mjs/.cts extensions (last 3 segments)", () => {
    expect(sourceSlug("/a/b/c/home.tsx")).toBe("b-c-home");
    expect(sourceSlug("/a/b/c/x.mjs")).toBe("b-c-x");
    expect(sourceSlug("/a/b/c/y.cts")).toBe("b-c-y");
  });

  it("lowercases and collapses non-alphanumerics to single dashes", () => {
    expect(sourceSlug("/X/Foo.Bar/Baz Qux.ts")).toBe("x-foo-bar-baz-qux");
  });

  it("caps length to keep paths sane on deep trees", () => {
    const long = "/" + "verylongsegment".repeat(10) + "/file.ts";
    expect(sourceSlug(long).length).toBeLessThanOrEqual(60);
  });

  it("never returns an empty slug", () => {
    expect(sourceSlug("/.ts")).toBe("src");
  });
});
