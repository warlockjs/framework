import { describe, expect, it, vi } from "vitest";
import { v, validate } from "../../../src";

describe("object refinement composition", () => {
  it("merges both refinement lists in order after child defaults", async () => {
    const calls: string[] = [];
    const left = v.object({ x: v.int().default(1) }).refine((value) => {
      calls.push(`left:${value.x}`);
      return "Left rejected";
    });
    const right = v.object({ y: v.int().default(2) }).refine((value) => {
      calls.push(`right:${value.y}`);
      return "Right rejected";
    });
    const result = await validate(left.merge(right), {}, { firstErrorOnly: false });
    expect(calls).toEqual(["left:1", "right:2"]);
    expect(result.errors.map((error) => error.error)).toEqual(["Left rejected", "Right rejected"]);
    calls.length = 0;
    await validate(left, {});
    expect(calls).toEqual(["left:1"]);
  });

  it("keeps receiver refinements through clone and field-selection paths", async () => {
    const callback = vi.fn(() => "Rejected");
    const schema = v.object({ x: v.int(), y: v.int().optional() }).refine(callback);
    const variants = [
      schema.clone(),
      schema.clone(["x"]),
      schema.pick("x"),
      schema.without("y"),
      schema.extend({ z: v.int().optional() }),
      schema.partial("y"),
      schema.requiredFields("x"),
    ];
    for (const variant of variants) expect((await validate(variant, { x: 1 })).isValid).toBe(false);
    expect(callback).toHaveBeenCalledTimes(variants.length);
  });

  it("extends fields without importing the other object's refinements", async () => {
    const callback = vi.fn(() => "Other rejected");
    const extended = v.object({ x: v.int() }).extend(v.object({ y: v.int() }).refine(callback));
    expect((await validate(extended, { x: 1, y: 2 })).isValid).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  });

  it("still validates refinements on omitted child fields", async () => {
    const schema = v.object({
      hidden: v
        .int()
        .refine(() => "Rejected")
        .omit(),
    });
    expect((await validate(schema, { hidden: 1 })).isValid).toBe(false);
  });

  it("does not rescue container rule failures with catch", async () => {
    expect((await validate(v.array(v.int()).minLength(2).catch([]), [1])).isValid).toBe(false);
    expect(
      (await validate(v.object({ x: v.int() }).catch({ x: 1 }), { x: 1, unknown: true })).isValid,
    ).toBe(false);
  });

  it("refines a successful empty string default", async () => {
    const callback = vi.fn((value: string) => (value.length < 3 ? "Too short" : undefined));
    expect((await validate(v.string().default("").refine(callback), undefined)).isValid).toBe(
      false,
    );
    expect(callback).toHaveBeenCalledWith("", expect.anything());
  });
});
