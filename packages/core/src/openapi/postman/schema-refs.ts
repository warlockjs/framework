import type { OpenApiSchema } from "../types";

export type SchemaComponents = Record<string, OpenApiSchema> | undefined;

const REF_PREFIX = "#/components/schemas/";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Component name a `$ref` schema points at, or `undefined` for a schema that is not a local
 * component reference.
 */
export function refName(schema: OpenApiSchema): string | undefined {
  const ref = schema.$ref;

  return typeof ref === "string" && ref.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : undefined;
}

/**
 * Follow `$ref`s (with a hop limit, so a ref loop cannot hang) to the schema they name.
 * An unknown component resolves to `{}`.
 */
export function resolveSchema(schema: OpenApiSchema, components: SchemaComponents): OpenApiSchema {
  let current = schema;

  for (let hop = 0; hop < 32; hop++) {
    const name = refName(current);

    if (name === undefined) {
      return current;
    }

    current = components?.[name] ?? {};
  }

  return {};
}

/**
 * The effective JSON Schema type: `type`, or the first non-null member of a `type` array
 * (the 3.1 nullable form), or one inferred from `properties` / `items`.
 */
export function primaryType(schema: OpenApiSchema): string | undefined {
  const { type } = schema;

  if (typeof type === "string") {
    return type;
  }

  if (Array.isArray(type)) {
    const concrete = type.find((member): member is string => typeof member === "string" && member !== "null");

    return concrete ?? (type.includes("null") ? "null" : undefined);
  }

  if (isRecord(schema.properties)) {
    return "object";
  }

  if (isRecord(schema.items)) {
    return "array";
  }

  return undefined;
}
