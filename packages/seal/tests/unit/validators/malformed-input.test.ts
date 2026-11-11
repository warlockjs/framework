import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

describe("number mutators leave non-numbers to the type rule", () => {
  it("abs/ceil/floor/round/toFixed refuse values that are not numbers", async () => {
    const schemas = [
      v.number().abs(),
      v.number().ceil(),
      v.int().floor(),
      v.number().round(),
      v.number().toFixed(2),
    ];

    for (const schema of schemas) {
      for (const value of ["abc", {}, [7], true]) {
        expect((await validate(schema, value)).isValid).toBe(false);
      }
    }
  });

  it("still converts numbers and numeric strings", async () => {
    expect((await validate(v.number().abs(), -5)).data).toBe(5);
    expect((await validate(v.number().abs(), "-5")).data).toBe(5);
    expect((await validate(v.int().floor(), "3.7")).data).toBe(3);
  });

  it("coerce() refuses arrays and still converts numeric strings", async () => {
    expect((await validate(v.number().coerce(), [7])).isValid).toBe(false);
    expect((await validate(v.number().coerce(), "7")).data).toBe(7);
  });

  it("the number rule refuses NaN and infinite values", async () => {
    expect((await validate(v.number(), NaN)).isValid).toBe(false);
    expect((await validate(v.number().optional(), NaN)).isValid).toBe(false);
    expect((await validate(v.number().optional(), Infinity)).isValid).toBe(false);
    expect((await validate(v.number().optional(), -Infinity)).isValid).toBe(false);
    // JSON.parse turns an out-of-range literal into Infinity
    expect((await validate(v.number().optional(), JSON.parse("1e999"))).isValid).toBe(false);
    expect((await validate(v.number().coerce().optional(), "1e999")).isValid).toBe(false);
  });
});

describe("inputs that used to throw", () => {
  it("urlDecode() keeps a malformed escape instead of throwing", async () => {
    const result = await validate(v.string().urlDecode(), "%E0%A4%A");

    expect(result.isValid).toBe(true);
    expect(result.data).toBe("%E0%A4%A");
    expect((await validate(v.string().urlDecode(), "a%20b")).data).toBe("a b");
  });

  it("deeply nested data under v.any() fails validation instead of throwing", async () => {
    let deep: unknown = 1;
    for (let index = 0; index < 20_000; index++) deep = [deep];

    const result = await validate(v.object({ x: v.any() }), { x: deep });

    expect(result.isValid).toBe(false);
    expect(result.errors[0]?.type).toBe("maxDepth");
  });

  it("deeply nested data with trim() fails validation instead of throwing", async () => {
    let deep: Record<string, unknown> = { leaf: " a " };
    for (let index = 0; index < 20_000; index++) deep = { next: deep };

    const result = await validate(v.object({ x: v.any() }).trim(), { x: deep });

    expect(result.isValid).toBe(false);
    expect(result.errors[0]?.type).toBe("maxDepth");
  });

  it("nesting within maxDepth is unchanged and the limit is configurable", async () => {
    let nested: unknown = { leaf: 1 };
    for (let index = 0; index < 100; index++) nested = { next: nested };

    expect((await validate(v.object({ x: v.any() }), { x: nested })).data).toEqual({ x: nested });

    const limited = await validate(v.object({ x: v.any() }), { x: nested }, { maxDepth: 10 });
    expect(limited.errors).toEqual([
      {
        type: "maxDepth",
        error: "The schema is nested too deeply (more than 10 levels)",
        input: "",
      },
    ]);
  });
});

describe("pattern() with a global or sticky regex", () => {
  it("gives the same answer on every call", async () => {
    const global = v.string().pattern(/^[a-z0-9-]+$/g);
    const sticky = v.string().pattern(/a/y);

    for (let call = 0; call < 3; call++) {
      expect((await validate(global, "my-slug")).isValid).toBe(true);
      expect((await validate(sticky, "a")).isValid).toBe(true);
      expect((await validate(sticky, "ba")).isValid).toBe(false);
    }
  });
});
