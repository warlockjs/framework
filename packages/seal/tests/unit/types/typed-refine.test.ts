import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { v, validate } from "../../../src";

describe("typed output refinements", () => {
  it("receives typed primitives and literal members", async () => {
    const string = v.string().refine((value) => {
      expectTypeOf(value).toEqualTypeOf<string>();
      return value.length < 2 ? "Too short" : undefined;
    });
    const number = v.int().refine((value) => {
      expectTypeOf(value).toEqualTypeOf<number>();
      return value > 10 ? "Too large" : undefined;
    });
    const literal = v.literal("yes", "no").refine((value) => {
      expectTypeOf(value).toEqualTypeOf<"yes" | "no">();
      return undefined;
    });
    expect((await validate(string, "x")).isValid).toBe(false);
    expect((await validate(number, 2)).isValid).toBe(true);
    expect((await validate(literal, "yes")).isValid).toBe(true);
  });

  it("receives defaults, catches, computed fields and transformed children", async () => {
    const schema = v
      .object({
        name: v.string().trim(),
        count: v.int().optional().default(2),
        rescued: v.int().catch(3),
        doubled: v.computed((data) => data.count * 2),
      })
      .refine((value) => {
        expectTypeOf(value.count).toEqualTypeOf<number>();
        expectTypeOf(value.rescued).toEqualTypeOf<number>();
        expectTypeOf(value.doubled).toEqualTypeOf<number>();
        expect(value).toEqual({ name: "Ada", count: 2, rescued: 3, doubled: 4 });
        return undefined;
      });
    expect((await validate(schema, { name: " Ada ", rescued: "bad" })).isValid).toBe(true);
  });

  it("receives successful array children with their output types", async () => {
    const schema = v.array(v.object({ count: v.int().default(2) })).refine((value) => {
      expectTypeOf(value).toEqualTypeOf<Array<{ count: number }>>();
      expect(value).toEqual([{ count: 2 }]);
      return undefined;
    });
    expect((await validate(schema, [{}])).isValid).toBe(true);
  });

  it("does not run after type or child failure with all errors enabled", async () => {
    const callback = vi.fn(() => undefined);
    for (const schema of [v.string(), v.object({ id: v.int() }), v.array(v.int())]) {
      const refined = schema.refine(callback);
      await validate(refined, 42, { firstErrorOnly: false });
      await validate(refined, { id: "bad" }, { firstErrorOnly: false });
      await validate(refined, ["bad"], { firstErrorOnly: false });
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("skips absent and nullable values", async () => {
    const callback = vi.fn(() => undefined);
    await validate(v.string().optional().refine(callback), undefined);
    await validate(v.string().nullable().refine(callback), null);
    expect(callback).not.toHaveBeenCalled();
  });

  it("keeps cloning immutable and respects refinement error order", async () => {
    const base = v.string();
    const schema = base.refine(async () => "First").refine(() => "Second");
    expect((await validate(base, "ok")).isValid).toBe(true);
    expect((await validate(schema, "ok")).errors.map((error) => error.error)).toEqual(["First"]);
    expect(
      (await validate(schema, "ok", { firstErrorOnly: false })).errors.map((error) => error.error),
    ).toEqual(["First", "Second"]);
  });

  it("refines tuple, record, lazy and discriminated union children once", async () => {
    const inner = v.object({ count: v.int().default(2) });
    const callback = vi.fn(() => undefined);
    const schemas = [
      [v.tuple([inner]).refine(callback), [{}]],
      [v.record(inner).refine(callback), { item: {} }],
      [v.lazy(() => inner).refine(callback), {}],
      [
        v
          .discriminatedUnion("type", [
            v.object({ type: v.literal("item"), count: v.int().default(2) }),
          ])
          .refine(callback),
        { type: "item" },
      ],
    ] as const;
    for (const [schema, input] of schemas) {
      expect((await validate(schema, input)).isValid).toBe(true);
    }
    expect(callback.mock.calls).toEqual([
      [[{ count: 2 }], expect.anything()],
      [{ item: { count: 2 } }, expect.anything()],
      [{ count: 2 }, expect.anything()],
      [{ type: "item", count: 2 }, expect.anything()],
    ]);
  });

  it("refines transformed scalar output with the field context", async () => {
    const callback = vi.fn((value: string, context: { path: string }) => {
      expect(value).toBe("Ada");
      expect(context.path).toBe("name");
      return undefined;
    });
    const schema = v.object({ name: v.string().trim().refine(callback) });
    expect((await validate(schema, { name: " Ada " })).isValid).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("catches a refinement failure on a leaf", async () => {
    const result = await validate(
      v
        .int()
        .refine(() => "Rejected")
        .catch(4),
      2,
    );
    expect(result.data).toBe(4);
    expect(result.isValid).toBe(true);
  });
});
