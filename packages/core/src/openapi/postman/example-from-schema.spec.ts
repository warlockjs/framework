import { describe, expect, it } from "vitest";
import { exampleFromSchema } from "./example-from-schema";

describe("exampleFromSchema", () => {
  it("samples primitives", () => {
    expect(exampleFromSchema({ type: "string" })).toBe("string");
    expect(exampleFromSchema({ type: "number" })).toBe(0);
    expect(exampleFromSchema({ type: "integer" })).toBe(0);
    expect(exampleFromSchema({ type: "boolean" })).toBe(false);
    expect(exampleFromSchema({ type: "null" })).toBeNull();
    expect(exampleFromSchema({})).toBeNull();
  });

  it("respects a positive minimum and a negative maximum", () => {
    expect(exampleFromSchema({ type: "integer", minimum: 5 })).toBe(5);
    expect(exampleFromSchema({ type: "number", maximum: -2 })).toBe(-2);
  });

  it.each([
    ["email", "user@example.com"],
    ["date-time", "2024-01-01T00:00:00.000Z"],
    ["date", "2024-01-01"],
    ["time", "00:00:00"],
    ["uri", "https://example.com"],
    ["uuid", "00000000-0000-4000-8000-000000000000"],
    ["hostname", "example.com"],
    ["ipv4", "127.0.0.1"],
    ["unknown-format", "string"],
  ])("samples a %s string", (format, expected) => {
    expect(exampleFromSchema({ type: "string", format })).toBe(expected);
  });

  it("prefers explicit example, const, default and enum values, in that order", () => {
    expect(exampleFromSchema({ type: "string", example: "e", const: "c", default: "d", enum: ["x"] })).toBe("e");
    expect(exampleFromSchema({ type: "string", const: "c", default: "d", enum: ["x"] })).toBe("c");
    expect(exampleFromSchema({ type: "string", default: "d", enum: ["x"] })).toBe("d");
    expect(exampleFromSchema({ enum: ["admin", "member"] })).toBe("admin");
    expect(exampleFromSchema({ type: "string", examples: ["first", "second"] })).toBe("first");
  });

  it("builds one array item and every object property, required or not", () => {
    expect(
      exampleFromSchema({
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
          nested: { type: "object", properties: { count: { type: "integer" } } },
          optional: { type: "boolean" },
        },
        required: ["tags"],
      }),
    ).toEqual({ tags: ["string"], nested: { count: 0 }, optional: false });
    expect(exampleFromSchema({ type: "array" })).toEqual([null]);
  });

  it("infers object and array from properties and items when type is missing", () => {
    expect(exampleFromSchema({ properties: { a: { type: "string" } } })).toEqual({ a: "string" });
    expect(exampleFromSchema({ items: { type: "number" } })).toEqual([0]);
  });

  it("resolves $ref against components", () => {
    const components = { Name: { type: "string", format: "email" } };

    expect(exampleFromSchema({ $ref: "#/components/schemas/Name" }, components)).toBe("user@example.com");
    expect(exampleFromSchema({ $ref: "#/components/schemas/Missing" }, components)).toBeNull();
  });

  it("cuts reference cycles: the property is omitted and an array of it is empty", () => {
    const components = {
      User: {
        type: "object",
        properties: {
          name: { type: "string" },
          parent: { $ref: "#/components/schemas/User" },
          friends: { type: "array", items: { $ref: "#/components/schemas/User" } },
        },
      },
    };

    expect(exampleFromSchema({ $ref: "#/components/schemas/User" }, components)).toEqual({
      name: "string",
      friends: [],
    });
  });

  it("does not mistake a repeated, non-cyclic reference for a cycle", () => {
    const components = {
      Point: { type: "object", properties: { x: { type: "number" } } },
      Line: {
        type: "object",
        properties: { from: { $ref: "#/components/schemas/Point" }, to: { $ref: "#/components/schemas/Point" } },
      },
    };

    expect(exampleFromSchema({ $ref: "#/components/schemas/Line" }, components)).toEqual({
      from: { x: 0 },
      to: { x: 0 },
    });
  });

  it("takes the non-null branch of a nullable union", () => {
    expect(exampleFromSchema({ type: ["integer", "null"] })).toBe(0);
    expect(exampleFromSchema({ type: ["null", "string"], format: "email" })).toBe("user@example.com");
    expect(exampleFromSchema({ anyOf: [{ type: "null" }, { type: "boolean" }] })).toBe(false);
    expect(exampleFromSchema({ oneOf: [{ type: "string" }, { type: "null" }] })).toBe("string");
  });

  it("merges allOf object parts", () => {
    expect(
      exampleFromSchema({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "integer" } } },
        ],
      }),
    ).toEqual({ a: "string", b: 0 });
  });

  it("is deterministic", () => {
    const schema = { type: "object", properties: { when: { type: "string", format: "date-time" } } };

    expect(exampleFromSchema(schema)).toEqual(exampleFromSchema(schema));
  });
});
