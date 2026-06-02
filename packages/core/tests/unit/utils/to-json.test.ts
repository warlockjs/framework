import { describe, expect, it } from "vitest";
import { toJson } from "../../../src/utils/to-json";

describe("toJson", () => {
  it("returns scalar values unchanged", async () => {
    expect(await toJson(5)).toBe(5);
    expect(await toJson("hello")).toBe("hello");
    expect(await toJson(true)).toBe(true);
  });

  it("returns falsy values unchanged", async () => {
    expect(await toJson(0)).toBe(0);
    expect(await toJson("")).toBe("");
    expect(await toJson(null)).toBe(null);
    expect(await toJson(undefined)).toBe(undefined);
  });

  it("invokes and awaits a toJSON method", async () => {
    const model = {
      toJSON() {
        return Promise.resolve({ id: 1, name: "Hasan" });
      },
    };

    expect(await toJson(model)).toEqual({ id: 1, name: "Hasan" });
  });

  it("recurses into arrays, resolving nested toJSON calls", async () => {
    const list = [{ toJSON: () => ({ id: 1 }) }, { toJSON: () => ({ id: 2 }) }];

    expect(await toJson(list)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("resolves a Set into an array", async () => {
    expect(await toJson(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it("recurses into plain object values", async () => {
    const value = {
      user: { toJSON: () => ({ id: 7 }) },
      tags: [{ toJSON: () => "a" }],
      count: 3,
    };

    expect(await toJson(value)).toEqual({
      user: { id: 7 },
      tags: ["a"],
      count: 3,
    });
  });

  it("uses the native toJSON of a Date, yielding its ISO string", async () => {
    // Date has its own toJSON(), so it takes the toJSON branch before the
    // plain-object / non-plain-object checks.
    const date = new Date("2024-01-01T00:00:00.000Z");

    expect(await toJson(date)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("leaves a non-plain object without toJSON untouched", async () => {
    class Point {
      public constructor(
        public x: number,
        public y: number,
      ) {}
    }

    const point = new Point(1, 2);

    expect(await toJson(point)).toBe(point);
  });
});
