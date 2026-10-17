/**
 * The input schemas of the `warlock mcp` tools, and the small validator that
 * checks arguments against them.
 *
 * The tools only take flat objects of strings, numbers, booleans, string
 * enums and string arrays, so a JSON Schema subset is enough and core needs no
 * validator dependency. The same object is what `tools/list` advertises.
 */

/** One property of a tool input. */
export type McpInputProperty =
  | { type: "string"; description: string; enum?: readonly string[] }
  | { type: "integer"; description: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description: string }
  | {
      type: "array";
      description: string;
      items: { type: "string"; enum?: readonly string[] };
    };

/** A tool's input schema: a closed object. */
export type McpInputSchema = {
  type: "object";
  properties: Record<string, McpInputProperty>;
  required?: readonly string[];
  additionalProperties: false;
};

/** Build an {@link McpInputSchema}. */
export function inputSchema(
  properties: Record<string, McpInputProperty>,
  required: readonly string[] = [],
): McpInputSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkProperty(name: string, property: McpInputProperty, value: unknown): string | null {
  switch (property.type) {
    case "string":
      if (typeof value !== "string") return `"${name}" must be a string`;
      if (property.enum && !property.enum.includes(value)) {
        return `"${name}" must be one of: ${property.enum.join(", ")}`;
      }
      return null;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `"${name}" must be an integer`;
      }
      if (property.minimum !== undefined && value < property.minimum) {
        return `"${name}" must be at least ${property.minimum}`;
      }
      if (property.maximum !== undefined && value > property.maximum) {
        return `"${name}" must be at most ${property.maximum}`;
      }
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : `"${name}" must be a boolean`;
    case "array": {
      if (!Array.isArray(value)) return `"${name}" must be an array of strings`;

      for (const item of value) {
        if (typeof item !== "string") return `"${name}" must be an array of strings`;
        if (property.items.enum && !property.items.enum.includes(item)) {
          return `"${name}" items must be one of: ${property.items.enum.join(", ")}`;
        }
      }

      return null;
    }
  }
}

/**
 * Check arguments against a schema. Returns the problems (empty when valid).
 * `undefined` / `null` arguments are read as `{}`.
 */
export function validateToolInput(schema: McpInputSchema, input: unknown): string[] {
  const value = input === undefined || input === null ? {} : input;

  if (!isRecord(value)) return ["arguments must be an object"];

  const issues: string[] = [];

  for (const name of schema.required ?? []) {
    if (value[name] === undefined) issues.push(`"${name}" is required`);
  }

  for (const [name, item] of Object.entries(value)) {
    const property = schema.properties[name];

    if (!property) {
      issues.push(`unknown argument "${name}"`);
      continue;
    }

    if (item === undefined) continue;

    const issue = checkProperty(name, property, item);

    if (issue) issues.push(issue);
  }

  return issues;
}

/** The Standard Schema result shape (spec v1). */
type StandardResult = { value: Record<string, unknown> } | { issues: { message: string }[] };

/**
 * The input as a Standard Schema (v1) with the Standard JSON Schema extension,
 * which is what `@warlock.js/ai` tools take: `~standard.validate` checks the
 * arguments, `~standard.jsonSchema.input()` returns the schema `tools/list`
 * advertises.
 */
export type StandardInputSchema = {
  "~standard": {
    version: 1;
    vendor: string;
    validate(value: unknown): StandardResult;
    jsonSchema: { input(options?: { target?: string }): McpInputSchema };
  };
};

/** Wrap a schema as a {@link StandardInputSchema}. */
export function toStandardSchema(schema: McpInputSchema): StandardInputSchema {
  return {
    "~standard": {
      version: 1,
      vendor: "warlock-mcp",
      validate(value) {
        const issues = validateToolInput(schema, value);

        if (issues.length > 0) return { issues: issues.map((message) => ({ message })) };

        return { value: isRecord(value) ? value : {} };
      },
      jsonSchema: { input: () => schema },
    },
  };
}
