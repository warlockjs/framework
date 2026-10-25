import { describe, expect, it } from "vitest";
import { v } from "../../../src/index";
import { wrapNullableStrict } from "../../../src/standard-schema/json-schema";

const NULL = { type: "null" };

describe("wrapNullableStrict per schema shape", () => {
  it("adds null to an enum that has no type", () => {
    expect(wrapNullableStrict({ enum: ["left", "right"] })).toEqual({
      enum: ["left", "right", null],
    });
  });

  it("adds null to both the enum and the type when a type is present", () => {
    expect(wrapNullableStrict({ type: "string", enum: ["a", "b"] })).toEqual({
      type: ["string", "null"],
      enum: ["a", "b", null],
    });
  });

  it("does not duplicate null in an enum or a type array", () => {
    expect(wrapNullableStrict({ type: ["string", "null"], enum: ["a", null] })).toEqual({
      type: ["string", "null"],
      enum: ["a", null],
    });
  });

  it("turns a const into anyOf with a null branch", () => {
    expect(wrapNullableStrict({ const: "items" })).toEqual({
      anyOf: [{ const: "items" }, NULL],
    });
  });

  it("keeps the type inside the const branch", () => {
    expect(wrapNullableStrict({ type: "string", const: "x", description: "d" })).toEqual({
      description: "d",
      anyOf: [{ const: "x", type: "string" }, NULL],
    });
  });

  it("appends a null branch to anyOf once", () => {
    const once = wrapNullableStrict({ anyOf: [{ type: "string" }, { type: "number" }] });

    expect(once).toEqual({ anyOf: [{ type: "string" }, { type: "number" }, NULL] });
    expect(wrapNullableStrict(once)).toEqual(once);
  });

  it("appends a null branch to oneOf once", () => {
    const once = wrapNullableStrict({ oneOf: [{ type: "string" }] });

    expect(once).toEqual({ oneOf: [{ type: "string" }, NULL] });
    expect(wrapNullableStrict(once)).toEqual(once);
  });

  it("wraps allOf in anyOf", () => {
    expect(wrapNullableStrict({ allOf: [{ type: "object" }] })).toEqual({
      anyOf: [{ allOf: [{ type: "object" }] }, NULL],
    });
  });

  it("wraps a $ref in anyOf", () => {
    expect(wrapNullableStrict({ $ref: "#/$defs/Side" })).toEqual({
      anyOf: [{ $ref: "#/$defs/Side" }, NULL],
    });
  });

  it("keeps a permissive empty schema permissive", () => {
    expect(wrapNullableStrict({})).toEqual({});
  });

  it("widens a plain type", () => {
    expect(wrapNullableStrict({ type: "string", minLength: 3 })).toEqual({
      type: ["string", "null"],
      minLength: 3,
    });
  });

  it("does not mutate its input", () => {
    const input = { enum: ["a"] };
    wrapNullableStrict(input);
    expect(input).toEqual({ enum: ["a"] });
  });
});

describe("openai-strict optional fields by validator", () => {
  const strict = (field: any) => v.object({ field }).toJsonSchema("openai-strict") as any;

  it("optional v.enum() is required and nullable", () => {
    const json = strict(v.enum(["left", "right"]).optional());

    expect(json.required).toEqual(["field"]);
    expect(json.properties.field).toEqual({ enum: ["left", "right", null] });
  });

  it("optional single literal becomes anyOf with null", () => {
    const json = strict(v.literal("items").optional());

    expect(json.required).toEqual(["field"]);
    expect(json.properties.field).toEqual({ anyOf: [{ const: "items" }, NULL] });
  });

  it("optional multi literal includes null in the enum", () => {
    expect(strict(v.literal("a", "b").optional()).properties.field).toEqual({
      enum: ["a", "b", null],
    });
  });

  it("optional string with in() lists null in type and enum", () => {
    expect(strict(v.string().in(["a", "b"]).optional()).properties.field).toEqual({
      type: ["string", "null"],
      enum: ["a", "b", null],
    });
  });

  it("optional number with in() lists null in type and enum", () => {
    expect(strict(v.number().in([1, 2]).optional()).properties.field).toEqual({
      type: ["number", "null"],
      enum: [1, 2, null],
    });
  });

  it("optional scalar enum includes null", () => {
    expect(strict(v.scalar().in(["x", "y"]).optional()).properties.field).toEqual({
      enum: ["x", "y", null],
    });
  });

  it("optional scalar without a value set gains a null branch", () => {
    expect(strict(v.scalar().optional()).properties.field).toEqual({
      oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, NULL],
    });
  });

  it("optional union gains a null branch", () => {
    expect(strict(v.union([v.string(), v.number()]).optional()).properties.field).toEqual({
      oneOf: [{ type: "string" }, { type: "number" }, NULL],
    });
  });

  it("optional discriminated union gains a null branch", () => {
    const union = v.discriminatedUnion("kind", [
      v.object({ kind: v.literal("a") }),
      v.object({ kind: v.literal("b") }),
    ]);

    const branches = strict(union.optional()).properties.field.oneOf;

    expect(branches).toHaveLength(3);
    expect(branches[2]).toEqual(NULL);
  });

  it("optional enum with a default stays nullable", () => {
    const json = strict(v.enum(["left", "right"]).optional().default("left"));

    expect(json.required).toEqual(["field"]);
    expect(json.properties.field.enum).toEqual(["left", "right", null]);
  });

  it("a required enum stays non-nullable", () => {
    expect(strict(v.enum(["left", "right"])).properties.field).toEqual({
      enum: ["left", "right"],
    });
  });

  it("nested in an array of objects", () => {
    const schema = v.object({
      items: v.array(v.object({ side: v.enum(["left", "right"]).optional() })),
    });
    const json = schema.toJsonSchema("openai-strict") as any;

    expect(json.properties.items.items.required).toEqual(["side"]);
    expect(json.properties.items.items.properties.side).toEqual({
      enum: ["left", "right", null],
    });
  });

  it("nested in an object", () => {
    const schema = v.object({
      injury: v.object({ side: v.literal("left").optional() }),
    });
    const json = schema.toJsonSchema("openai-strict") as any;

    expect(json.properties.injury.properties.side).toEqual({
      anyOf: [{ const: "left" }, NULL],
    });
  });

  it("optional array of enums widens the array type only", () => {
    expect(strict(v.array(v.enum(["a", "b"])).optional()).properties.field).toEqual({
      type: ["array", "null"],
      items: { enum: ["a", "b"] },
    });
  });
});

describe("nullable enums and literals per target", () => {
  it("openai-strict nullable enum includes null", () => {
    expect(v.enum(["a", "b"]).nullable().toJsonSchema("openai-strict")).toEqual({
      enum: ["a", "b", null],
    });
  });

  it("draft-2020-12 nullable enum includes null", () => {
    expect(v.enum(["a", "b"]).nullable().toJsonSchema("draft-2020-12")).toEqual({
      enum: ["a", "b", null],
    });
  });

  it("draft-2020-12 nullable literal becomes anyOf", () => {
    expect(v.literal("x").nullable().toJsonSchema("draft-2020-12")).toEqual({
      anyOf: [{ const: "x" }, NULL],
    });
  });

  it("openapi-3.0 nullable enum adds nullable and null", () => {
    expect(v.string().in(["a"]).nullable().toJsonSchema("openapi-3.0")).toEqual({
      type: "string",
      enum: ["a", null],
      nullable: true,
    });
  });

  it("draft-07 nullable enum wraps in oneOf", () => {
    expect(v.enum(["a", "b"]).nullable().toJsonSchema("draft-07")).toEqual({
      oneOf: [{ enum: ["a", "b"] }, NULL],
    });
  });
});
