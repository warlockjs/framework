import { describe, expect, it } from "vitest";
import { v } from "../../../src/index";

describe("toJsonSchema generation", () => {
  describe("primitives", () => {
    it("maps string constraints to keywords", () => {
      expect(v.string().min(2).max(50).email().toJsonSchema("draft-2020-12")).toEqual({
        type: "string",
        minLength: 2,
        maxLength: 50,
        format: "email",
      });
    });

    it("maps number range to minimum/maximum and int to integer", () => {
      expect(v.number().min(0).max(100).toJsonSchema("draft-2020-12")).toEqual({
        type: "number",
        minimum: 0,
        maximum: 100,
      });

      expect(v.int().min(1).toJsonSchema("draft-2020-12")).toEqual({
        type: "integer",
        minimum: 1,
      });
    });

    it("maps greaterThan/lessThan to exclusive bounds (numeric form in 2020-12)", () => {
      expect(v.int().greaterThan(0).lessThan(10).toJsonSchema("draft-2020-12")).toEqual({
        type: "integer",
        exclusiveMinimum: 0,
        exclusiveMaximum: 10,
      });
    });

    it("encodes exclusive bounds as boolean flags in draft-07", () => {
      const schema = v.int().greaterThan(5).toJsonSchema("draft-07");
      expect(schema).toEqual({ type: "integer", minimum: 5, exclusiveMinimum: true });
    });

    it("maps boolean and date", () => {
      expect(v.boolean().toJsonSchema("draft-2020-12")).toEqual({ type: "boolean" });
      expect(v.date().toJsonSchema("draft-2020-12")).toEqual({
        type: "string",
        format: "date-time",
      });
    });

    it("derives date/time format from toDateOnly/toTimeOnly transformers", () => {
      expect(v.date().toDateOnly().toJsonSchema("draft-2020-12")).toEqual({
        type: "string",
        format: "date",
      });

      expect(v.date().toTimeOnly().toJsonSchema("draft-2020-12")).toEqual({
        type: "string",
        format: "time",
      });
    });
  });

  describe("literals and enums", () => {
    it("single literal → const, multiple → enum", () => {
      expect(v.literal("items").toJsonSchema("draft-2020-12")).toEqual({ const: "items" });
      expect(v.literal("a", "b").toJsonSchema("draft-2020-12")).toEqual({ enum: ["a", "b"] });
    });

    it("collapses scalar.in to an enum list", () => {
      expect(v.scalar().in(["x", "y"]).toJsonSchema("draft-2020-12")).toEqual({
        enum: ["x", "y"],
      });
    });
  });

  describe("containers", () => {
    it("array maps items + length bounds", () => {
      expect(v.array(v.string()).minLength(1).maxLength(5).toJsonSchema("draft-2020-12")).toEqual({
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 5,
      });
    });

    it("record maps to additionalProperties value schema", () => {
      expect(v.record(v.int()).toJsonSchema("draft-2020-12")).toEqual({
        type: "object",
        additionalProperties: { type: "integer" },
      });
    });

    it("union maps to oneOf (not anyOf)", () => {
      expect(v.union([v.string(), v.number()]).toJsonSchema("draft-2020-12")).toEqual({
        oneOf: [{ type: "string" }, { type: "number" }],
      });
    });

    it("tuple uses prefixItems + items:false in 2020-12", () => {
      expect(v.tuple([v.string(), v.int()]).toJsonSchema("draft-2020-12")).toEqual({
        type: "array",
        minItems: 2,
        maxItems: 2,
        prefixItems: [{ type: "string" }, { type: "integer" }],
        items: false,
      });
    });

    it("tuple uses items array + additionalItems:false in draft-07", () => {
      expect(v.tuple([v.string(), v.int()]).toJsonSchema("draft-07")).toEqual({
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: [{ type: "string" }, { type: "integer" }],
        additionalItems: false,
      });
    });

    it("object lists only non-optional fields in required and sets additionalProperties:false", () => {
      const schema = v.object({
        name: v.string(),
        age: v.int().optional(),
      });

      expect(schema.toJsonSchema("draft-2020-12")).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name"],
        additionalProperties: false,
      });
    });

    it("allowUnknown drops the additionalProperties:false guard", () => {
      const schema = v.object({ name: v.string() }).allowUnknown();
      const json = schema.toJsonSchema("draft-2020-12");
      expect(json.additionalProperties).toBeUndefined();
    });
  });

  describe("nullable per dialect", () => {
    it("2020-12 widens type to a [T, null] array", () => {
      expect(v.string().nullable().toJsonSchema("draft-2020-12")).toEqual({
        type: ["string", "null"],
      });
    });

    it("openapi-3.0 uses nullable:true", () => {
      expect(v.string().nullable().toJsonSchema("openapi-3.0")).toEqual({
        type: "string",
        nullable: true,
      });
    });

    it("draft-07 wraps in oneOf with a null branch", () => {
      expect(v.string().nullable().toJsonSchema("draft-07")).toEqual({
        oneOf: [{ type: "string" }, { type: "null" }],
      });
    });
  });

  describe("openai-strict", () => {
    it("lists every field in required and nullifies optional fields", () => {
      const schema = v.object({
        reply: v.string(),
        citations: v.array(v.string()).optional(),
      });

      expect(schema.toJsonSchema("openai-strict")).toEqual({
        type: "object",
        properties: {
          reply: { type: "string" },
          citations: { type: ["array", "null"], items: { type: "string" } },
        },
        required: ["reply", "citations"],
        additionalProperties: false,
      });
    });

    it("recurses into nested objects", () => {
      const schema = v.object({
        meta: v.object({ id: v.string() }),
      });

      const json = schema.toJsonSchema("openai-strict") as any;
      expect(json.properties.meta.additionalProperties).toBe(false);
      expect(json.properties.meta.required).toEqual(["id"]);
    });
  });

  describe("non-representable constructs", () => {
    it("any() → permissive empty schema", () => {
      expect(v.any().toJsonSchema("draft-2020-12")).toEqual({});
    });

    it("instanceof → permissive empty schema", () => {
      class Custom {}
      expect(v.instanceof(Custom).toJsonSchema("draft-2020-12")).toEqual({});
    });

    it("computed/managed throw — they have no input schema", () => {
      expect(() => v.computed(() => 1).toJsonSchema("draft-2020-12")).toThrow();
      expect(() => v.managed(() => 1).toJsonSchema("draft-2020-12")).toThrow();
    });

    it("object skips computed fields entirely", () => {
      const schema = v.object({
        title: v.string(),
        slug: v.computed((data: any) => data.title),
      });

      const json = schema.toJsonSchema("draft-2020-12") as any;
      expect(json.properties.slug).toBeUndefined();
      expect(json.properties.title).toEqual({ type: "string" });
    });
  });
});
