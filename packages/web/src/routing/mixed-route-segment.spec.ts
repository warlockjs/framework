import { describe, expect, it } from "vitest";
import {
  compareMixedSegments,
  namedWildcardOfPath,
  parseMixedSegment,
  routerPathOf,
  withNamedWildcardParam,
} from "./mixed-route-segment";

describe("parseMixedSegment", () => {
  it("splits text and params in order", () => {
    expect(parseMixedSegment(":type-for-:purpose")).toEqual({
      type: "mixed",
      parts: [
        { type: "param", name: "type" },
        { type: "text", value: "-for-" },
        { type: "param", name: "purpose" },
      ],
    });
  });

  it("refuses adjacent params, a bare colon and characters outside the supported text", () => {
    expect(parseMixedSegment(":a:b").type).toBe("invalid");
    expect(parseMixedSegment("x-:").type).toBe("invalid");
    expect(parseMixedSegment(":a/b").type).toBe("invalid");
    expect(parseMixedSegment(":a(d)").type).toBe("invalid");
  });
});

describe("named terminal wildcard", () => {
  it("is registered as the router's own `*` and gets its name back as a param", () => {
    expect(namedWildcardOfPath("/files/*rest")).toBe("rest");
    expect(routerPathOf("/files/*rest")).toBe("/files/*");
    expect(routerPathOf("/files/*")).toBe("/files/*");
    expect(routerPathOf("*")).toBe("*");
    expect(routerPathOf("/users/:id")).toBe("/users/:id");
    expect(withNamedWildcardParam("/files/*rest", { "*": "a/b" })).toEqual({
      "*": "a/b",
      rest: "a/b",
    });
    expect(withNamedWildcardParam("/files/*", { "*": "a/b" })).toEqual({ "*": "a/b" });
  });
});

describe("compareMixedSegments", () => {
  it("puts the segment with more leading, then trailing, then total static text first", () => {
    const parts = (segment: string) => {
      const parsed = parseMixedSegment(segment);
      return parsed.type === "mixed" ? parsed.parts : [];
    };

    expect(compareMixedSegments(parts("x-for-:b"), parts(":a-for-:b"))).toBeLessThan(0);
    expect(compareMixedSegments(parts(":a-for-z"), parts(":a-for-:b"))).toBeLessThan(0);
    expect(compareMixedSegments(parts(":c-for-:d"), parts(":a-:b"))).toBeLessThan(0);
    expect(compareMixedSegments(parts(":a-:b"), parts(":c-:d"))).toBe(0);
  });
});
