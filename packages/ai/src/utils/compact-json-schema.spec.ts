import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { compactJsonSchema, extractJsonSchema, withCompactJsonSchema } from "./json-schema";

const FULL = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Search",
  description: "Search input",
  properties: {
    // A property literally named "description" must survive.
    description: { type: "string", description: "Free text", examples: ["cats"] },
    sort: {
      description: "Sort order",
      anyOf: [
        { type: "string", const: "asc" },
        { type: "string", const: "desc" },
      ],
    },
    filters: {
      type: "array",
      default: [],
      items: { type: "object", properties: { field: { type: "string", title: "Field" } } },
    },
  },
  required: ["description"],
  additionalProperties: false,
};

describe("compactJsonSchema", () => {
  it("strips annotations at every level and keeps validation keywords", () => {
    expect(compactJsonSchema(FULL)).toEqual({
      type: "object",
      properties: {
        description: { type: "string" },
        sort: { type: "string", enum: ["asc", "desc"] },
        filters: {
          type: "array",
          items: { type: "object", properties: { field: { type: "string" } } },
        },
      },
      required: ["description"],
      additionalProperties: false,
    });
  });

  it("keeps descriptions when asked", () => {
    const compact = compactJsonSchema(FULL, { keepDescriptions: true });

    expect(compact.description).toBe("Search input");
    expect(compact).not.toHaveProperty("title");
  });

  it("leaves unions that are not pure const branches alone", () => {
    const schema = { anyOf: [{ const: "a" }, { type: "number", minimum: 1 }] };

    expect(compactJsonSchema(schema)).toEqual(schema);
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(FULL);

    compactJsonSchema(FULL);

    expect(FULL).toEqual(copy);
  });
});

describe("compact schema extraction", () => {
  const schema = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => FULL, output: () => FULL },
    },
  } as unknown as StandardSchemaV1<unknown>;

  it("extractJsonSchema returns the compact form on request", () => {
    expect(extractJsonSchema(schema, { compact: true })).toEqual(compactJsonSchema(FULL));
    expect(extractJsonSchema(schema)).toBe(FULL);
  });

  it("withCompactJsonSchema serializes compactly but validates with the original", () => {
    const wrapped = withCompactJsonSchema(schema);

    expect(extractJsonSchema(wrapped)).toEqual(compactJsonSchema(FULL));
    expect(wrapped?.["~standard"].validate).toBe(schema["~standard"].validate);
    expect(withCompactJsonSchema(undefined)).toBeUndefined();
  });
});
