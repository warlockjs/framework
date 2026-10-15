import { describe, expect, it } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";
import { findSpanById } from "./find-span-by-id";

describe("findSpanById", () => {
  it("returns the root when its id matches", () => {
    const trace = makeTrace({ traceId: "t1" });

    expect(findSpanById(trace.root, "t1")).toBe(trace.root);
  });

  it("finds a direct child", () => {
    const child = makeSpan({ spanId: "c1", traceId: "t1" });
    const trace = makeTrace({ traceId: "t1", children: [child] });

    expect(findSpanById(trace.root, "c1")).toBe(child);
  });

  it("finds a deeply nested descendant", () => {
    const grandchild = makeSpan({ spanId: "g1", traceId: "t1" });
    const child = makeSpan({ spanId: "c1", traceId: "t1", children: [grandchild] });
    const trace = makeTrace({ traceId: "t1", children: [child] });

    expect(findSpanById(trace.root, "g1")).toBe(grandchild);
  });

  it("returns undefined for an id that doesn't exist", () => {
    const trace = makeTrace({ traceId: "t1" });

    expect(findSpanById(trace.root, "missing")).toBeUndefined();
  });
});
