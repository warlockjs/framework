import { describe, expect, expectTypeOf, it } from "vitest";
import { v, validate } from "../../../src";
import type { StandardSchemaV1 } from "../../../src/standard-schema/types";
import type { Infer } from "../../../src/types";

describe("union and record output types", () => {
  const entry = v.object({
    count: v.int().optional().default(1),
    rescued: v.int().catch(2),
    note: v.string().optional(),
  });
  type EntryInput = { count?: number; rescued?: number; note?: string };
  type EntryOutput = { count: number; rescued: number; note?: string };

  it("separates union input and output and returns the selected branch output", async () => {
    const schema = v.union([entry, v.string()]);
    expectTypeOf<Infer.Input<typeof schema>>().toEqualTypeOf<EntryInput | string>();
    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<EntryOutput | string>();
    expectTypeOf<StandardSchemaV1.InferInput<typeof schema>>().toEqualTypeOf<EntryInput | string>();
    expectTypeOf<StandardSchemaV1.InferOutput<typeof schema>>().toEqualTypeOf<
      EntryOutput | string
    >();
    const standard = await schema["~standard"].validate({ rescued: "bad" });
    if (standard.issues) throw new Error("expected valid output");
    expectTypeOf(standard.value).toEqualTypeOf<EntryOutput | string>();
    expect(standard.value).toEqual({ count: 1, rescued: 2 });
    const result = await validate(schema, { rescued: "bad" });
    if (!result.isValid) throw new Error("expected valid output");
    expectTypeOf(result.data).toEqualTypeOf<EntryOutput | string>();
    expect(result.data).toEqual(standard.value);
  });

  it("separates record input and output and returns child defaults and catches", async () => {
    const schema = v.record(entry);
    expectTypeOf<Infer.Input<typeof schema>>().toEqualTypeOf<Record<string, EntryInput>>();
    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<Record<string, EntryOutput>>();
    expectTypeOf<StandardSchemaV1.InferInput<typeof schema>>().toEqualTypeOf<
      Record<string, EntryInput>
    >();
    expectTypeOf<StandardSchemaV1.InferOutput<typeof schema>>().toEqualTypeOf<
      Record<string, EntryOutput>
    >();
    const standard = await schema["~standard"].validate({ first: { rescued: "bad" } });
    if (standard.issues) throw new Error("expected valid output");
    expectTypeOf(standard.value).toEqualTypeOf<Record<string, EntryOutput>>();
    expect(standard.value).toEqual({ first: { count: 1, rescued: 2 } });
  });

  it("infers key-constrained input/output without requiring every allowed key", async () => {
    const schema = v.record(v.literal("draft", "published"), entry);
    expectTypeOf<Infer.Input<typeof schema>>().toEqualTypeOf<
      Partial<Record<"draft" | "published", EntryInput>>
    >();
    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<
      Partial<Record<"draft" | "published", EntryOutput>>
    >();
    expectTypeOf<StandardSchemaV1.InferOutput<typeof schema>>().toEqualTypeOf<
      Partial<Record<"draft" | "published", EntryOutput>>
    >();
    const broad = v.record(v.string(), entry);
    expectTypeOf<Infer.Output<typeof broad>>().toEqualTypeOf<Record<string, EntryOutput>>();
    const result = await validate(schema, { draft: {} });
    if (!result.isValid) throw new Error("expected valid output");
    expectTypeOf(result.data).toEqualTypeOf<Partial<Record<"draft" | "published", EntryOutput>>>();
    expect(result.data).toEqual({ draft: { count: 1, rescued: 2 } });
  });

  it("keeps nested record/union outputs and nullable members", async () => {
    const schema = v.object({ entries: v.record(v.union([entry, v.literal("skip")]).nullable()) });
    expectTypeOf<Infer.Output<typeof schema>>().toEqualTypeOf<{
      entries: Record<string, EntryOutput | "skip" | null>;
    }>();
    const result = await validate(schema, { entries: { first: {}, second: "skip", third: null } });
    expect(result.data).toEqual({
      entries: { first: { count: 1, rescued: 2 }, second: "skip", third: null },
    });
  });

  it("refines the typed union output after defaults", async () => {
    const schema = v.union([entry, v.string()]).refine((value) => {
      expectTypeOf(value).toEqualTypeOf<EntryOutput | string>();
      expect(value).toEqual({ count: 1, rescued: 2 });
      return undefined;
    });
    expect((await validate(schema, {})).isValid).toBe(true);
  });

  it("reads output rather than input from any Standard Schema", () => {
    type External = StandardSchemaV1<{ raw: string }, { value: number }>;
    expectTypeOf<Infer.Input<External>>().toEqualTypeOf<{ raw: string }>();
    expectTypeOf<Infer.Output<External>>().toEqualTypeOf<{ value: number }>();
  });
});
