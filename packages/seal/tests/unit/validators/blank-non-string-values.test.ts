import { describe, expect, it } from "vitest";
import { validate, v } from "../../../src";

const nonStringValidators = [
  ["number", () => v.number()],
  ["int", () => v.int()],
  ["float", () => v.float()],
  ["boolean", () => v.boolean()],
  ["date", () => v.date()],
  ["literal", () => v.literal("draft")],
  ["enum", () => v.enum(["draft", "published"])],
  ["array", () => v.array(v.string())],
] as const;

describe("blank values for non-string validators", () => {
  it.each(nonStringValidators)("omits an optional %s field submitted as blank", async (_name, create) => {
    const result = await validate(v.object({ value: create().optional() }), { value: "" });

    expect(result).toMatchObject({ isValid: true, data: {} });
  });

  it.each(nonStringValidators)("normalizes a blank nullable %s field to null", async (_name, create) => {
    const result = await validate(v.object({ value: create().nullable() }), { value: "" });

    expect(result).toMatchObject({ isValid: true, data: { value: null } });
  });

  it.each(nonStringValidators)("reports required for a blank required %s field", async (_name, create) => {
    const result = await validate(v.object({ value: create().required() }), { value: "" });

    expect(result.isValid).toBe(false);
    expect(result.errors.map(error => error.type)).toContain("required");
  });

  it.each(nonStringValidators)("treats whitespace-only input as blank for %s", async (_name, create) => {
    const result = await validate(v.object({ value: create().optional() }), { value: "  " });

    expect(result).toMatchObject({ isValid: true, data: {} });
  });

  it("keeps blank optional strings as submitted", async () => {
    const result = await validate(v.object({ value: v.string().optional() }), { value: "" });

    expect(result).toMatchObject({ isValid: true, data: { value: "" } });
  });
});
