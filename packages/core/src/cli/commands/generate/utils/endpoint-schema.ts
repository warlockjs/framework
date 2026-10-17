/**
 * What the endpoint generator needs to know about a request schema, read
 * from the JSON Schema seal produces (`validator.toJsonSchema()`).
 *
 * Kept free of seal imports: it works on the plain JSON Schema object, so it
 * is unit-testable and survives seal's internals changing.
 */

/** The JSON Schema subset this module reads. */
export type JsonSchemaNode = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  contentMediaType?: string;
  contentEncoding?: string;
};

/** One top-level field of the request schema. */
export type EndpointField = {
  name: string;
  required: boolean;
  /** The resource cast for this field, or `undefined` when it has no plain JSON shape (a file). */
  cast?: string;
  /** A deterministic valid value, or `undefined` when JSON cannot carry one (a file). */
  sample?: unknown;
  /**
   * Whether the response echoes the sample unchanged, so a generated test can
   * compare it. Dates are parsed and re-cast, so they are not comparable.
   */
  comparable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The non-null JSON types a node allows, and whether `null` is one of them. */
function typesOf(node: JsonSchemaNode): { types: string[]; nullable: boolean } {
  const variants = node.anyOf ?? node.oneOf;

  if (variants) {
    const all = variants.map(typesOf);

    return {
      types: all.flatMap((entry) => entry.types),
      nullable: all.some((entry) => entry.nullable),
    };
  }

  const raw = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];

  return { types: raw.filter((type) => type !== "null"), nullable: raw.includes("null") };
}

function primaryNode(node: JsonSchemaNode): JsonSchemaNode {
  const variants = node.anyOf ?? node.oneOf;

  if (!variants) return node;

  return (
    variants.find((variant) => !typesOf(variant).types.every((type) => type === "null")) ?? node
  );
}

/** A file upload: JSON cannot carry it, so it has no sample and no cast. */
function isFileNode(node: JsonSchemaNode): boolean {
  return (
    node.format === "binary" ||
    node.contentEncoding === "binary" ||
    node.contentMediaType !== undefined
  );
}

const CASTS: Record<string, string> = {
  string: "string",
  integer: "int",
  number: "number",
  boolean: "boolean",
  array: "array",
  object: "object",
};

/** `"string"` or `"number"` when every enum value has that type. */
function enumValuesType(node: JsonSchemaNode): string | undefined {
  if (!node.enum || node.enum.length === 0) return undefined;
  if (node.enum.every((value) => typeof value === "string")) return "string";
  if (node.enum.every((value) => typeof value === "number")) return "number";

  return undefined;
}

/** The resource cast for a field, with `?` when the value may be null or absent. */
export function castForNode(node: JsonSchemaNode, required: boolean): string | undefined {
  const primary = primaryNode(node);

  if (isFileNode(primary)) return undefined;

  const { types, nullable } = typesOf(node);
  const enumType = enumValuesType(primary);
  const only = types.length === 1 ? types[0] : undefined;
  const base = enumType ?? (only === undefined ? undefined : CASTS[only]);

  if (base === undefined) return undefined;

  if (base === "string" && (primary.format === "date-time" || primary.format === "date")) {
    return nullable || !required ? "date?" : "date";
  }

  return nullable || !required ? `${base}?` : base;
}

/**
 * A deterministic value that satisfies `node`, or `undefined` when JSON cannot
 * express one. `seed` keeps values readable and stable between runs.
 */
export function sampleForNode(node: JsonSchemaNode, seed: string): unknown {
  const primary = primaryNode(node);

  if (isFileNode(primary)) return undefined;
  if (primary.const !== undefined) return primary.const;
  if (primary.enum && primary.enum.length > 0) return primary.enum[0];

  const { types } = typesOf(node);
  const type = types[0];

  switch (type) {
    case "string":
      return sampleString(primary, seed);
    case "integer":
      return sampleNumber(primary, true);
    case "number":
      return sampleNumber(primary, false);
    case "boolean":
      return true;
    case "array": {
      const count = primary.minItems ?? 0;
      const item = primary.items ? sampleForNode(primary.items, `${seed}-item`) : undefined;

      if (count > 0 && item === undefined) return undefined;

      return Array.from({ length: count }, () => item);
    }
    case "object":
      return sampleObject(primary, seed);
    default:
      return undefined;
  }
}

function sampleNumber(node: JsonSchemaNode, integer: boolean): number {
  const lower =
    node.minimum ?? (node.exclusiveMinimum !== undefined ? node.exclusiveMinimum + 1 : 1);
  let value = integer ? Math.ceil(lower) : lower;

  if (node.maximum !== undefined && value > node.maximum) value = node.maximum;

  return value;
}

function sampleString(node: JsonSchemaNode, seed: string): string {
  switch (node.format) {
    case "email":
      return `${seed.replace(/[^a-z0-9]/gi, "").toLowerCase() || "user"}@example.test`;
    case "uri":
    case "url":
      return `https://example.test/${seed}`;
    case "uuid":
      return "00000000-0000-4000-8000-000000000001";
    case "date-time":
      return "2026-01-01T00:00:00.000Z";
    case "date":
      return "2026-01-01";
    default:
      break;
  }

  const minLength = node.minLength ?? 1;
  let value = `${seed} sample`;

  while (value.length < minLength) value += " sample";

  return node.maxLength !== undefined ? value.slice(0, Math.max(node.maxLength, minLength)) : value;
}

function sampleObject(node: JsonSchemaNode, seed: string): Record<string, unknown> | undefined {
  const required = new Set(node.required ?? []);
  const result: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const value = sampleForNode(child, key);

    if (value === undefined) {
      if (required.has(key)) return undefined;
      continue;
    }

    result[key] = value;
  }

  void seed;

  return result;
}

/** Read the top-level fields of a request schema's JSON Schema. */
export function readEndpointFields(jsonSchema: unknown): EndpointField[] {
  if (!isRecord(jsonSchema)) return [];

  const node = jsonSchema as JsonSchemaNode;
  const required = new Set(node.required ?? []);

  return Object.entries(node.properties ?? {}).map(([name, child]) => {
    const isRequired = required.has(name);
    const cast = castForNode(child, isRequired);
    const sample = sampleForNode(child, name);
    const field: EndpointField = {
      name,
      required: isRequired,
      comparable:
        sample !== undefined &&
        cast !== undefined &&
        !cast.startsWith("date") &&
        !cast.startsWith("object"),
    };

    if (cast !== undefined) field.cast = cast;
    if (sample !== undefined) field.sample = sample;

    return field;
  });
}
