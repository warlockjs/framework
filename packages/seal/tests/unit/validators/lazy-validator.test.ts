import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import type { ObjectValidator } from "../../../src/validators/object-validator";

describe("LazyValidator", () => {
  it("validates a self-referencing (recursive) schema", async () => {
    const category: ObjectValidator<any> = v.object({
      name: v.string(),
      children: v.array(v.lazy(() => category)).optional(),
    });

    const tree = {
      name: "root",
      children: [
        { name: "a", children: [{ name: "a1" }] },
        { name: "b" },
      ],
    };

    const result = await validate(category, tree);
    expect(result.isValid).toBe(true);
    expect(result.data.children[0].children[0].name).toBe("a1");
  });

  it("surfaces validation errors from deep within the recursion", async () => {
    const category: ObjectValidator<any> = v.object({
      name: v.string().min(2),
      children: v.array(v.lazy(() => category)).optional(),
    });

    const result = await validate(category, {
      name: "root",
      children: [{ name: "x" }],
    });

    expect(result.isValid).toBe(false);
    expect(result.errors[0].type).toBe("minLength");
  });

  it("memoizes the thunk — it resolves at most once", async () => {
    let calls = 0;
    const inner = v.string();

    const lazy = v.lazy(() => {
      calls += 1;
      return inner;
    });

    await validate(lazy, "first");
    await validate(lazy, "second");

    expect(calls).toBe(1);
  });

  it("delegates matchesType and toJsonSchema to the resolved validator", () => {
    const lazy = v.lazy(() => v.int().min(1));

    expect(lazy.matchesType(5)).toBe(true);
    expect(lazy.matchesType("nope")).toBe(false);
    expect(lazy.toJsonSchema("draft-2020-12")).toEqual({ type: "integer", minimum: 1 });
  });

  it("clone resets the memo so the clone resolves independently", async () => {
    const lazy = v.lazy(() => v.string().min(2));
    const cloned = lazy.clone();

    expect(cloned).not.toBe(lazy);
    expect((await validate(cloned, "ok")).isValid).toBe(true);
    expect((await validate(cloned, "x")).isValid).toBe(false);
  });
});
