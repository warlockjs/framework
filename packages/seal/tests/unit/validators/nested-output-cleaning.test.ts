import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import "../../../src/validators";

describe("nested output is cleaned once", () => {
  it("drops undefined values at every level", async () => {
    const schema = v.object({
      a: v.object({ b: v.object({ c: v.string().optional(), d: v.string() }) }),
    });
    const result = await validate(schema, { a: { b: { d: "x" } } });

    expect(result.isValid).toBe(true);
    expect(result.data).toEqual({ a: { b: { d: "x" } } });
    expect("c" in (result.data as any).a.b).toBe(false);
  });

  it("removes undefined values a nested transformer returns in a new object", async () => {
    const schema = v.object({
      inner: v
        .object({ n: v.number() })
        .addTransformer((data: any) => ({ ...data, extra: undefined })),
    });
    const result = await validate(schema, { inner: { n: 1 } });

    expect(result.data).toEqual({ inner: { n: 1 } });
    expect("extra" in (result.data as any).inner).toBe(false);
  });

  it("still enforces maxDepth across levels that were already cleaned", async () => {
    const schema = v.object({ a: v.object({ b: v.object({ c: v.object({ d: v.any() }) }) }) });
    const input = { a: { b: { c: { d: 1 } } } };

    expect((await validate(schema, input, { maxDepth: 10 })).isValid).toBe(true);

    const shallow = await validate(schema, input, { maxDepth: 2 });
    expect(shallow.isValid).toBe(false);
    expect(shallow.errors[0]?.type).toBe("maxDepth");
  });
});

describe("rules that answer without a promise", () => {
  it("run like async rules at runtime", async () => {
    const schema = v.string().addRule({
      name: "syncRule",
      defaultErrorMessage: "bad",
      validate: ((value: string) => ({ isValid: value === "ok", error: "bad" })) as any,
    } as any);

    expect((await validate(schema, "ok")).isValid).toBe(true);
    expect((await validate(schema, "no")).isValid).toBe(false);
  });
});
