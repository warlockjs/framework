/** JSON Schema assertions used by the pinned Oxlint rule schema snapshot. */
export type Schema =
  | boolean
  | {
      $ref?: string;
      type?: string | string[];
      enum?: unknown[];
      const?: unknown;
      allOf?: Schema[];
      anyOf?: Schema[];
      oneOf?: Schema[];
      not?: Schema;
      properties?: Record<string, Schema>;
      patternProperties?: Record<string, Schema>;
      additionalProperties?: Schema;
      required?: string[];
      items?: Schema | Schema[];
      additionalItems?: Schema;
      minItems?: number;
      maxItems?: number;
      uniqueItems?: boolean;
      minimum?: number;
      maximum?: number;
      exclusiveMinimum?: number;
      exclusiveMaximum?: number;
      multipleOf?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
export type RuleSchemas = {
  rules: Record<string, Schema>;
  config: Record<string, Schema>;
  definitions: Record<string, Schema>;
  typeAware: string[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Conservative validation before copying literal rule options into Oxc config. */
export function matchesSchema(
  value: unknown,
  schema: Schema,
  definitions: Record<string, Schema>,
): boolean {
  if (typeof schema === "boolean") return schema;
  if (schema.$ref) {
    const target = definitions[schema.$ref.replace("#/definitions/", "")];
    if (target === undefined || !matchesSchema(value, target, definitions)) return false;
  }
  const matches = (candidate: Schema) => matchesSchema(value, candidate, definitions);
  if (schema.allOf && !schema.allOf.every(matches)) return false;
  if (schema.anyOf && !schema.anyOf.some(matches)) return false;
  if (schema.oneOf && schema.oneOf.filter(matches).length !== 1) return false;
  if (schema.not !== undefined && matches(schema.not)) return false;
  if (schema.enum && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value)))
    return false;
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (
      !types.includes(type) &&
      !(types.includes("integer") && typeof value === "number" && Number.isInteger(value))
    )
      return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (
      schema.uniqueItems &&
      new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length
    )
      return false;
    const items = schema.items;
    if (
      items !== undefined &&
      !value.every((entry, index) => {
        const item = Array.isArray(items)
          ? (items[index] ?? schema.additionalItems ?? true)
          : items;
        return matchesSchema(entry, item, definitions);
      })
    )
      return false;
  }
  if (isRecord(value)) {
    if (schema.required?.some((key) => !(key in value))) return false;
    for (const [key, entry] of Object.entries(value)) {
      const property = schema.properties?.[key];
      const patterns = Object.entries(schema.patternProperties ?? {}).filter(([pattern]) =>
        new RegExp(pattern).test(key),
      );
      if (property !== undefined && !matchesSchema(entry, property, definitions)) return false;
      if (!patterns.every(([, pattern]) => matchesSchema(entry, pattern, definitions)))
        return false;
      if (
        property === undefined &&
        patterns.length === 0 &&
        schema.additionalProperties !== undefined &&
        !matchesSchema(entry, schema.additionalProperties, definitions)
      )
        return false;
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return false;
    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) return false;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return false;
  }
  return true;
}
