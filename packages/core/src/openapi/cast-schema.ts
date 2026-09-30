import type { OpenApiSchema } from "./types";

/**
 * JSON Schema of the DEFAULT date output of a resource field (`iso`, `format`, `timestamp`
 * and `humanTime` on; `timezone`, `locale` and `offset` off), matching `BaseCastOutput<"date">`.
 */
const DEFAULT_DATE_SCHEMA: OpenApiSchema = {
  type: "object",
  properties: {
    iso: { type: "string", format: "date-time" },
    format: { type: "string" },
    timestamp: { type: "number" },
    humanTime: { type: "string" },
  },
  required: ["iso", "format", "timestamp", "humanTime"],
};

function baseCastSchema(base: string): OpenApiSchema | undefined {
  switch (base) {
    case "string":
    case "localized":
      return { type: "string" };
    case "url":
    case "uploadsUrl":
    case "storageUrl":
      return { type: "string", format: "uri" };
    case "number":
    case "float":
      return { type: "number" };
    case "int":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "object":
      return { type: "object" };
    case "array":
      return { type: "array" };
    case "date":
      return structuredClone(DEFAULT_DATE_SCHEMA);
    default:
      return undefined;
  }
}

/**
 * Make a schema accept `null` too, the 3.1 way: `type: [T, "null"]`. A schema without a plain
 * `type` (a `$ref`, `{}`) is wrapped in `anyOf` with `{ type: "null" }`.
 */
export function makeNullable(schema: OpenApiSchema): OpenApiSchema {
  if (typeof schema.type === "string") {
    return { ...schema, type: [schema.type, "null"] };
  }

  if (Array.isArray(schema.type)) {
    return schema.type.includes("null") ? schema : { ...schema, type: [...schema.type, "null"] };
  }

  return { anyOf: [schema, { type: "null" }] };
}

/**
 * JSON Schema of a resource cast string, suffixes included (`"string"`, `"number?"`,
 * `"string[]"`, `"date[]?"`). `?` means "always present, value or null"; `[]` wraps the base
 * in an array, and with `?` it is the array that may be null.
 *
 * @returns `undefined` for a cast this mapper does not know.
 */
export function castToJsonSchema(cast: string): OpenApiSchema | undefined {
  let base = cast;
  let nullable = false;
  let isArray = false;

  if (base.endsWith("?")) {
    nullable = true;
    base = base.slice(0, -1);
  }

  if (base.endsWith("[]")) {
    isArray = true;
    base = base.slice(0, -2);
  }

  const baseSchema = baseCastSchema(base);

  if (!baseSchema) {
    return undefined;
  }

  const shaped: OpenApiSchema = isArray ? { type: "array", items: baseSchema } : baseSchema;

  return nullable ? makeNullable(shaped) : shaped;
}
