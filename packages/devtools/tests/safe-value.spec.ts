import { describe, expect, it } from "vitest";
import { toSafeValue } from "../src/safe-value";

describe("toSafeValue", () => {
  it("copies plain data unchanged", () => {
    const value = { a: 1, b: "two", c: [true, null, { d: 4 }] };

    expect(toSafeValue(value)).toEqual(value);
    expect(toSafeValue(value)).not.toBe(value);
  });

  it("marks a cycle instead of throwing", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;

    const safe = toSafeValue(node);

    expect(safe).toEqual({ name: "root", self: "[Circular]" });
    expect(() => JSON.stringify(safe)).not.toThrow();
  });

  it("keeps a shared, non-circular reference in both places", () => {
    const shared = { id: 1 };

    expect(toSafeValue({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it("serializes through toJSON, and names other class instances", () => {
    class Model {
      public toJSON() {
        return { id: 7 };
      }
    }
    class Socket {}

    expect(toSafeValue({ model: new Model(), socket: new Socket() })).toEqual({
      model: { id: 7 },
      socket: "[Socket]",
    });
  });

  it("turns dates, errors and bigints into JSON values and drops functions", () => {
    expect(
      toSafeValue({
        at: new Date("2026-09-29T00:00:00.000Z"),
        error: new TypeError("bad"),
        big: 10n,
        fn: () => undefined,
      }),
    ).toEqual({
      at: "2026-09-29T00:00:00.000Z",
      error: { name: "TypeError", message: "bad" },
      big: "10",
    });
  });

  it("bounds depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };

    expect(JSON.stringify(toSafeValue(deep))).toContain('"[Object]"');
  });
});
