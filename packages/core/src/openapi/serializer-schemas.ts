import { buildDeclaredResponses } from "./response-schemas";
import { SchemaRegistry } from "./schema-registry";
import type { OpenApiSchema } from "./types";

const COMPONENT_REF_PREFIX = "#/components/schemas/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The default date output object (`iso`, `format`, `timestamp`, `humanTime`). */
function isDefaultDateSchema(schema: Record<string, unknown>): boolean {
  const properties = schema.properties;

  return (
    schema.type === "object" &&
    isRecord(properties) &&
    "iso" in properties &&
    "humanTime" in properties &&
    "timestamp" in properties
  );
}

/**
 * Turn an OpenAPI schema into one the response serializer can safely apply.
 *
 * A serializer drops every field a schema does not name, and throws on a
 * missing `required` field, so this keeps only what describes the shape:
 * `required` and `format` are removed, a free-form object keeps every key, and
 * a date field is left open because its output depends on `dateOptions()` and
 * `resource.dateOutput`. Component references point at `definitions`.
 */
function toSerializerSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toSerializerSchema);

  if (!isRecord(schema)) return schema;

  // a date output is shaped by per-field options the schema cannot know
  if (isDefaultDateSchema(schema)) return {};

  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "required" || key === "format") continue;

    if (key === "$ref" && typeof value === "string") {
      output[key] = value.replace(COMPONENT_REF_PREFIX, "#/definitions/");

      continue;
    }

    output[key] = toSerializerSchema(value);
  }

  if (output.type === "object" && output.properties === undefined) {
    output.additionalProperties = true;
  }

  if (Array.isArray(output.type) && output.type.includes("object") && !output.properties) {
    output.additionalProperties = true;
  }

  return output;
}

/**
 * Fastify `schema.response` entries for a route's declared `responseSchema`,
 * keyed by status code: each declared status becomes a JSON serializer schema
 * that keeps the declared fields and drops the rest.
 *
 * @returns `undefined` when no declared status has a usable body.
 */
export function buildSerializerSchemas(
  responseSchema: unknown,
): Record<string, OpenApiSchema> | undefined {
  const registry = new SchemaRegistry(undefined, () => undefined);
  const responses = buildDeclaredResponses(responseSchema, registry, () => undefined);
  const output: Record<string, OpenApiSchema> = {};

  for (const [status, response] of Object.entries(responses)) {
    const schema = response.content?.["application/json"]?.schema;

    if (!schema) continue;

    const converted = toSerializerSchema(schema) as OpenApiSchema;

    output[status] = {
      ...converted,
      definitions: toSerializerSchema(registry.schemas) as Record<string, OpenApiSchema>,
    };
  }

  return Object.keys(output).length > 0 ? output : undefined;
}
