import { describe, expect, it } from "vitest";
import { resolveMongoLikePattern } from "../../../../src/drivers/mongodb/mongodb-query-parser";

describe("resolveMongoLikePattern", () => {
  it("matches regex metacharacters literally", () => {
    const source = resolveMongoLikePattern("a.b*");

    expect(source).toBe("a\\.b\\*");
    expect(new RegExp(source, "i").test("a.b*")).toBe(true);
    expect(new RegExp(source, "i").test("axbb")).toBe(false);
  });

  it("treats % as any run and _ as one character, like pg", () => {
    expect(resolveMongoLikePattern("a%b")).toBe("a.*b");
    expect(resolveMongoLikePattern("a_b")).toBe("a.b");
    expect(new RegExp("^" + resolveMongoLikePattern("a_b") + "$").test("axb")).toBe(true);
    expect(new RegExp("^" + resolveMongoLikePattern("a_b") + "$").test("axxb")).toBe(false);
  });

  it("uses a RegExp argument verbatim", () => {
    expect(resolveMongoLikePattern(/^a+$/)).toBe("^a+$");
  });
});
