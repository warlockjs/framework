import { describe, expect, it } from "vitest";
import { mapToStandardResult } from "../../../src/standard-schema/map-result";
import type { StandardSchemaV1 } from "../../../src/standard-schema/types";
import { v } from "../../../src/index";

/**
 * Helper that mimics how a Standard-Schema-aware library consumes a schema:
 * it reads the `~standard` member and calls its `validate`.
 */
function asStandard<T extends object>(schema: T): StandardSchemaV1 {
  return schema as unknown as StandardSchemaV1;
}

describe("Standard Schema bridge", () => {
  it("exposes a ~standard member with version + vendor", () => {
    const schema = v.object({ name: v.string() });
    const standard = asStandard(schema)["~standard"];

    expect(standard.version).toBe(1);
    expect(standard.vendor).toBe("seal");
  });

  it("returns { value } on success", async () => {
    const schema = v.object({ name: v.string().min(2) });
    const result = await asStandard(schema)["~standard"].validate({ name: "Hasan" });

    expect(result).toEqual({ value: { name: "Hasan" } });
  });

  it("returns { issues } with message + segmented path on failure", async () => {
    const schema = v.object({ name: v.string().min(2) });
    const result = await asStandard(schema)["~standard"].validate({ name: "x" });

    expect("issues" in result).toBe(true);

    if ("issues" in result) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain("at least 2");
      expect(result.issues[0].path).toEqual([{ key: "name" }]);
    }
  });

  it("splits nested dot-paths into multiple segments", () => {
    const mapped = mapToStandardResult({
      isValid: false,
      data: undefined,
      errors: [{ type: "string", error: "bad", input: "address.city" }],
    });

    expect("issues" in mapped).toBe(true);

    if ("issues" in mapped) {
      expect(mapped.issues[0].path).toEqual([{ key: "address" }, { key: "city" }]);
    }
  });

  it("omits path when the error has no input field", () => {
    const mapped = mapToStandardResult({
      isValid: false,
      data: undefined,
      errors: [{ type: "custom", error: "boom", input: "" }],
    });

    if ("issues" in mapped) {
      expect(mapped.issues[0].path).toBeUndefined();
    }
  });

  it("exposes jsonSchema.input / jsonSchema.output on ~standard", () => {
    const schema = v.object({ name: v.string() });
    const standard = asStandard(schema)["~standard"] as any;

    const input = standard.jsonSchema.input({ target: "draft-2020-12" });
    const output = standard.jsonSchema.output({ target: "draft-2020-12" });

    expect(input).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });

    expect(output).toEqual(input);
  });
});
