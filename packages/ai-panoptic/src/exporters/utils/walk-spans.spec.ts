import { describe, expect, it } from "vitest";
import { makeSpan } from "../test-support/make-trace";
import { walkSpans } from "./walk-spans";

describe("walkSpans", () => {
  it("should yield a single leaf span", () => {
    const root = makeSpan({ spanId: "a" });

    const ids = [...walkSpans(root)].map((span) => span.spanId);

    expect(ids).toEqual(["a"]);
  });

  it("should yield depth-first pre-order: parent before children, in order", () => {
    const root = makeSpan({
      spanId: "a",
      children: [
        makeSpan({
          spanId: "b",
          children: [makeSpan({ spanId: "d" }), makeSpan({ spanId: "e" })],
        }),
        makeSpan({ spanId: "c" }),
      ],
    });

    const ids = [...walkSpans(root)].map((span) => span.spanId);

    expect(ids).toEqual(["a", "b", "d", "e", "c"]);
  });
});
