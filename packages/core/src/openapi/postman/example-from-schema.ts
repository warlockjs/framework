import type { OpenApiSchema } from "../types";
import { isRecord, primaryType, refName, resolveSchema, type SchemaComponents } from "./schema-refs";

const STRING_FORMAT_EXAMPLES: Record<string, string> = {
  email: "user@example.com",
  "date-time": "2024-01-01T00:00:00.000Z",
  date: "2024-01-01",
  time: "00:00:00",
  uri: "https://example.com",
  url: "https://example.com",
  iri: "https://example.com",
  uuid: "00000000-0000-4000-8000-000000000000",
  hostname: "example.com",
  ipv4: "127.0.0.1",
  ipv6: "::1",
};

function numberExample(schema: OpenApiSchema): number {
  if (typeof schema.minimum === "number" && schema.minimum > 0) {
    return schema.minimum;
  }

  if (typeof schema.maximum === "number" && schema.maximum < 0) {
    return schema.maximum;
  }

  return 0;
}

function stringExample(schema: OpenApiSchema): string {
  const format = typeof schema.format === "string" ? schema.format : undefined;

  return (format !== undefined ? STRING_FORMAT_EXAMPLES[format] : undefined) ?? "string";
}

function isNullBranch(branch: unknown, components: SchemaComponents): boolean {
  return isRecord(branch) && primaryType(resolveSchema(branch, components)) === "null";
}

function mergeExamples(parts: unknown[]): unknown {
  const objects = parts.filter(isRecord);

  if (objects.length === parts.length) {
    return Object.assign({}, ...objects);
  }

  return parts[parts.length - 1] ?? null;
}

/**
 * `undefined` marks a `$ref` cycle: the caller omits the property, or yields an empty array.
 */
function generate(schema: unknown, components: SchemaComponents, stack: readonly string[]): unknown {
  if (!isRecord(schema)) {
    return null;
  }

  const name = refName(schema);

  if (name !== undefined) {
    const target = components?.[name];

    if (stack.includes(name)) {
      return undefined;
    }

    return target ? generate(target, components, [...stack, name]) : null;
  }

  if ("example" in schema) {
    return schema.example;
  }

  if ("const" in schema) {
    return schema.const;
  }

  if ("default" in schema) {
    return schema.default;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }

  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = schema[key];

    if (Array.isArray(branches) && branches.length > 0) {
      const branch = branches.find((candidate) => !isNullBranch(candidate, components)) ?? branches[0];

      return generate(branch, components, stack);
    }
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return mergeExamples(schema.allOf.map((part) => generate(part, components, stack)));
  }

  switch (primaryType(schema)) {
    case "string":
      return stringExample(schema);
    case "number":
    case "integer":
      return numberExample(schema);
    case "boolean":
      return false;
    case "array": {
      const item = generate(schema.items, components, stack);

      return item === undefined ? [] : [item];
    }
    case "object": {
      const result: Record<string, unknown> = {};
      const properties = isRecord(schema.properties) ? schema.properties : {};

      for (const [key, property] of Object.entries(properties)) {
        const value = generate(property, components, stack);

        if (value !== undefined) {
          result[key] = value;
        }
      }

      return result;
    }
    default:
      return null;
  }
}

/**
 * A deterministic example value for a JSON Schema.
 *
 * Explicit `example`, `const`, `default`, `enum[0]` and `examples[0]` win, in that order;
 * otherwise a type sample is produced (format-aware strings, `0`, `false`, one array item,
 * every object property). `$ref`s resolve against `components`; a cyclic reference is cut
 * (the property is omitted, an array of it is empty). A nullable union yields its non-null
 * branch. A schema with no usable type is `null`.
 */
export function exampleFromSchema(schema: OpenApiSchema, components?: SchemaComponents): unknown {
  const value = generate(schema, components, []);

  return value === undefined ? null : value;
}
