import type { StandardJSONSchemaV1 } from "./types";

/**
 * Supported JSON Schema generation targets.
 */
export type JsonSchemaTarget = StandardJSONSchemaV1.Target;

/**
 * The result shape for a generated JSON Schema.
 */
export type JsonSchemaResult = Record<string, unknown>;

/**
 * Apply nullable to a JSON Schema object based on the target dialect.
 *
 * - draft-2020-12  : `type` becomes an array: `["string", "null"]`
 * - openai-strict  : same as draft-2020-12 (type array form)
 * - draft-07       : wraps in `oneOf: [{ ...schema }, { type: "null" }]`
 * - openapi-3.0    : adds `nullable: true` alongside the existing type
 *
 * Mutates the schema in-place.
 *
 * @example
 * ```ts
 * const schema = { type: "string" };
 * applyNullable(schema, "draft-2020-12");
 * // → { type: ["string", "null"] }
 * ```
 */
export function applyNullable(schema: JsonSchemaResult, target: JsonSchemaTarget): void {
  if (target === "openapi-3.0") {
    schema.nullable = true;

    // `nullable: true` alone does not admit null when an enum is present
    if (Array.isArray(schema.enum) && !schema.enum.includes(null)) {
      schema.enum = [...schema.enum, null];
    }

    return;
  }

  if (target === "draft-2020-12" || target === "openai-strict") {
    const wrapped = wrapNullableStrict(schema);

    for (const key of Object.keys(schema)) {
      delete schema[key];
    }

    Object.assign(schema, wrapped);
    return;
  }

  // draft-07: oneOf wrapping
  const copy = { ...schema };
  for (const key of Object.keys(schema)) {
    delete schema[key];
  }
  schema.oneOf = [copy, { type: "null" }];
}

const NULL_BRANCH = { type: "null" } as const;

function hasNullBranch(branches: unknown[]): boolean {
  return branches.some(
    (branch) => typeof branch === "object" && branch !== null && (branch as any).type === "null",
  );
}

/**
 * Wrap a field schema as nullable for OpenAI strict mode.
 *
 * OpenAI strict requires optional fields to be expressed as a nullable type
 * rather than being omitted from the `required` array. This helper wraps a
 * given schema into its nullable equivalent, whatever its shape:
 *
 * - `type`            : the type becomes an array with `"null"`
 * - `enum`            : `null` is added to the enum (and to `type` when present)
 * - `const`           : becomes `anyOf: [{ const }, { type: "null" }]`
 * - `anyOf` / `oneOf` : a `{ type: "null" }` branch is appended once
 * - `allOf` / `$ref`  : wrapped in `anyOf` with a null branch
 *
 * Unlike `applyNullable()` (which mutates in-place), this returns a new
 * schema object to avoid side effects when wrapping child schemas.
 *
 * @example
 * ```ts
 * wrapNullableStrict({ type: "string", minLength: 3 })
 * // → { type: ["string", "null"], minLength: 3 }
 *
 * wrapNullableStrict({ enum: ["left", "right"] })
 * // → { enum: ["left", "right", null] }
 *
 * wrapNullableStrict({ const: "items" })
 * // → { anyOf: [{ const: "items" }, { type: "null" }] }
 *
 * wrapNullableStrict({ oneOf: [...] })
 * // → { oneOf: [..., { type: "null" }] }
 * ```
 */
export function wrapNullableStrict(schema: JsonSchemaResult): JsonSchemaResult {
  // Union shapes: append the null branch, once
  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = schema[key];

    if (Array.isArray(branches)) {
      if (hasNullBranch(branches)) return schema;

      return { ...schema, [key]: [...branches, { ...NULL_BRANCH }] };
    }
  }

  // Permissive `{}` already accepts null
  if (Object.keys(schema).length === 0) {
    return schema;
  }

  if (Array.isArray(schema.enum)) {
    const output: JsonSchemaResult = {
      ...schema,
      enum: schema.enum.includes(null) ? schema.enum : [...schema.enum, null],
    };

    if (schema.type !== undefined) {
      const baseType = schema.type as string | string[];
      const types = Array.isArray(baseType) ? baseType : [baseType];
      output.type = types.includes("null") ? types : [...types, "null"];
    }

    return output;
  }

  if (schema.const !== undefined) {
    if (schema.const === null) return schema;

    const { const: constant, type, ...rest } = schema;
    const branch: JsonSchemaResult =
      type === undefined ? { const: constant } : { const: constant, type };

    return { ...rest, anyOf: [branch, { ...NULL_BRANCH }] };
  }

  if (schema.type === undefined) {
    // `$ref`, `allOf`, `not` and any other typeless shape: wrap as a whole
    const { description, title, default: defaultValue, ...inner } = schema;
    const output: JsonSchemaResult = { anyOf: [inner, { ...NULL_BRANCH }] };

    if (description !== undefined) output.description = description;
    if (title !== undefined) output.title = title;
    if (defaultValue !== undefined) output.default = defaultValue;

    return output;
  }

  // Standard case: wrap type into array with null
  const baseType = schema.type as string | string[];
  const types = Array.isArray(baseType) ? baseType : [baseType];

  return {
    ...schema,
    type: types.includes("null") ? types : [...types, "null"],
  };
}

/**
 * Find the first rule matching the given name in a rules array,
 * and return its options bag.
 */
export function getRuleOptions(
  rules: Array<{ name: string; context: { options: Record<string, unknown> } }>,
  ruleName: string,
): Record<string, unknown> | undefined {
  const rule = rules.find((r) => r.name === ruleName);
  return rule?.context?.options as Record<string, unknown> | undefined;
}
