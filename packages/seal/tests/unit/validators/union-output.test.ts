import { describe, expect, it, vi } from "vitest";
import { v, validate } from "../../../src";

describe("union validated branch output", () => {
  it("keeps child transforms and computed fields without rerunning branches", async () => {
    const computed = vi.fn((data: { name: string }) => data.name.length);
    const schema = v
      .union([v.object({ name: v.string().trim(), length: v.computed(computed) }), v.string()])
      .refine((value) => {
        expect(value).toEqual({ name: "Ada", length: 3 });
        return undefined;
      });
    const result = await validate(schema, { name: " Ada " });
    expect(result.data).toEqual({ name: "Ada", length: 3 });
    expect(computed).toHaveBeenCalledTimes(1);
  });

  it("runs union transformers after branch transformers", async () => {
    const schema = v.union([v.string().trim()]).outputAs((value) => `${value}!`);
    expect((await validate(schema, " Ada ")).data).toBe("Ada!");
  });

  it("keeps an explicit undefined branch output", async () => {
    const schema = v.union([v.string().outputAs(() => undefined)]);
    const result = await validate(schema, "drop");
    expect(result.isValid).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("keeps concurrent validations independent on the same union", async () => {
    const schema = v.union([
      v.object({ name: v.string().trim(), count: v.int().default(1) }),
      v.string().uppercase(),
    ]);
    const results = await Promise.all([
      validate(schema, { name: " Ada " }),
      validate(schema, "bob"),
      validate(schema, { name: " Cy " }),
    ]);
    expect(results.map((result) => result.data)).toEqual([
      { name: "Ada", count: 1 },
      "BOB",
      { name: "Cy", count: 1 },
    ]);
  });

  it("preserves a value when a successful rule omits data", async () => {
    const schema = v.string().addRule({ name: "check", validate: async () => ({ isValid: true }) });
    expect((await validate(schema, "kept")).data).toBe("kept");
  });
});
