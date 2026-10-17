import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Supported JSON Schema output targets per the Standard JSON Schema V1
 * spec. `openai-strict` is the richest for OpenAI structured outputs —
 * every property listed in `required`, optionals expressed as
 * `["T", "null"]`, `additionalProperties: false` everywhere. Other
 * targets produce standards-compliant but looser output.
 */
export type JsonSchemaTarget = "draft-2020-12" | "draft-07" | "openapi-3.0" | "openai-strict";

/**
 * Options for `extractJsonSchema`. `target` is forwarded to libraries that
 * implement the Standard JSON Schema V1 spec (Seal, and any future lib
 * that follows the spec). Libraries using their own top-level `.jsonSchema`
 * / `._jsonSchema` property ignore the target.
 */
export type ExtractJsonSchemaOptions = {
  target?: JsonSchemaTarget | (string & {});
  /**
   * Return the compact form of the schema — see {@link compactJsonSchema}.
   * `true` strips every annotation; an object passes
   * {@link CompactJsonSchemaOptions}.
   *
   * @example
   * extractJsonSchema(tool.input, { compact: true });
   */
  compact?: boolean | CompactJsonSchemaOptions;
};

/**
 * Best-effort JSON Schema extraction from a Standard Schema instance.
 *
 * Different libraries expose their JSON representation through different
 * paths:
 * - **Seal / Standard JSON Schema V1**: `["~standard"].jsonSchema.input({ target })`
 *   — nested under the spec object, takes a target switch. Default target
 *   is `"openai-strict"` since the primary consumer is OpenAI's native
 *   structured-output mechanism; pass `options.target` to override.
 * - **Zod / similar**: top-level `.jsonSchema` property. Zod v4 actually
 *   ships `toJSONSchema` as a module function, not a method, so it does
 *   NOT hit this probe — Zod users pass their converted schema via the
 *   `AgentExecuteOptions.responseSchema` escape hatch.
 *
 * Deliberately does NOT probe `toJSON` — that's a generic JavaScript
 * serialization hook (Seal's schemas have one that dumps internal rule
 * state) and matching it would return garbage disguised as a JSON Schema.
 *
 * Returns `undefined` when no path matches. The caller then either skips
 * native structured-output wiring or falls back to a schema-less
 * instruction.
 *
 * Shared across every SDK adapter package (OpenAI, Anthropic, Bedrock…)
 * so each provider converts schemas identically.
 *
 * @example
 * const schema = extractJsonSchema(mySealSchema);
 * // { type: "object", properties: { ... }, required: [ ... ], additionalProperties: false }
 *
 * @example
 * // Ask for a different target explicitly
 * const draft = extractJsonSchema(mySealSchema, { target: "draft-2020-12" });
 */
export function extractJsonSchema(
  schema: StandardSchemaV1<unknown> | undefined,
  options: ExtractJsonSchemaOptions = {},
): Record<string, unknown> | undefined {
  if (!schema) return undefined;

  const target = options.target ?? "openai-strict";

  // 1. Seal / Standard JSON Schema V1 pattern: ["~standard"].jsonSchema.input({ target })
  // 2. Top-level jsonSchema / _jsonSchema (Zod-like, property or method form)
  const extracted =
    extractFromSealPath(schema, target) ??
    extractFromCandidateKeys(schema as unknown as Record<string, unknown>);

  if (!extracted || !options.compact) {
    return extracted;
  }

  return compactJsonSchema(extracted, options.compact === true ? {} : options.compact);
}

/** Options for {@link compactJsonSchema}. */
export type CompactJsonSchemaOptions = {
  /**
   * Keep `description` keywords (still dropping titles, examples, defaults
   * and comments). Use it when property descriptions carry instructions
   * the model needs. Default `false`.
   */
  keepDescriptions?: boolean;
};

/**
 * Annotation keywords a compact schema drops. None of them constrains
 * what the model may send; they only explain it.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "examples",
  "example",
  "default",
  "$comment",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$schema",
]);

/** Keywords whose value is one sub-schema. */
const SCHEMA_KEYWORDS = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
] as const;

/** Keywords whose value is a list of sub-schemas. */
const SCHEMA_LIST_KEYWORDS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

/** Keywords whose value maps names to sub-schemas. */
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "$defs", "definitions"] as const;

/**
 * Shrink a JSON Schema for sending as a tool's input schema, without
 * changing what it accepts:
 *
 * - Drops annotation keywords at every level — `description`, `title`,
 *   `examples`, `example`, `default`, `$comment`, `deprecated`,
 *   `readOnly`, `writeOnly`, `$schema` (keep descriptions with
 *   `keepDescriptions: true`).
 * - Collapses an `anyOf` / `oneOf` whose every branch is a bare `const`
 *   (`{ const: "a" }` or `{ type: "string", const: "a" }`) into one
 *   `enum`.
 *
 * Validation keywords (`type`, `properties`, `required`, `enum`,
 * `pattern`, `format`, bounds, `additionalProperties`, …) are kept, so a
 * strict-mode provider accepts the compact schema exactly as it accepts
 * the full one. Property *names* are never touched. The tool's own
 * `description` is not part of its schema and is always sent.
 *
 * The trade-off: the model no longer sees per-field guidance, so give
 * fields self-explanatory names and put anything essential in the tool
 * description. Returns a new object; the input is not mutated.
 *
 * @example
 * compactJsonSchema({
 *   type: "object",
 *   description: "Search input",
 *   properties: { query: { type: "string", description: "What to search for", examples: ["cats"] } },
 *   required: ["query"],
 * });
 * // { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
 */
export function compactJsonSchema(
  schema: Record<string, unknown>,
  options: CompactJsonSchemaOptions = {},
): Record<string, unknown> {
  return compactNode(schema, options) as Record<string, unknown>;
}

function compactNode(node: unknown, options: CompactJsonSchemaOptions): unknown {
  if (!isRecord(node)) {
    return node;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATION_KEYWORDS.has(key) && !(key === "description" && options.keepDescriptions)) {
      continue;
    }

    if ((SCHEMA_KEYWORDS as ReadonlyArray<string>).includes(key)) {
      result[key] = Array.isArray(value)
        ? value.map((item) => compactNode(item, options))
        : compactNode(value, options);
      continue;
    }

    if ((SCHEMA_LIST_KEYWORDS as ReadonlyArray<string>).includes(key) && Array.isArray(value)) {
      result[key] = value.map((item) => compactNode(item, options));
      continue;
    }

    if ((SCHEMA_MAP_KEYWORDS as ReadonlyArray<string>).includes(key) && isRecord(value)) {
      const mapped: Record<string, unknown> = {};

      for (const [name, child] of Object.entries(value)) {
        mapped[name] = compactNode(child, options);
      }

      result[key] = mapped;
      continue;
    }

    result[key] = value;
  }

  return collapseConstUnion(result, "anyOf") ?? collapseConstUnion(result, "oneOf") ?? result;
}

/**
 * Turn `{ anyOf: [{ const: "a" }, { type: "string", const: "b" }] }` into
 * `{ type: "string", enum: ["a", "b"] }`. Returns `undefined` (leave the
 * node alone) unless every branch is a `const`, optionally with a `type`
 * shared by all branches.
 */
function collapseConstUnion(
  node: Record<string, unknown>,
  keyword: "anyOf" | "oneOf",
): Record<string, unknown> | undefined {
  const branches = node[keyword];

  if (!Array.isArray(branches) || branches.length === 0) {
    return undefined;
  }

  const values: unknown[] = [];
  let sharedType: unknown;

  for (const [index, branch] of branches.entries()) {
    if (!isRecord(branch) || !("const" in branch)) {
      return undefined;
    }

    const keys = Object.keys(branch).filter((key) => key !== "const" && key !== "type");

    if (keys.length > 0) {
      return undefined;
    }

    if (index === 0) {
      sharedType = branch.type;
    } else if (branch.type !== sharedType) {
      return undefined;
    }

    values.push(branch.const);
  }

  const rest: Record<string, unknown> = { ...node };
  delete rest[keyword];

  return {
    ...rest,
    ...(typeof sharedType === "string" && rest.type === undefined ? { type: sharedType } : {}),
    enum: values,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wrap a Standard Schema so `extractJsonSchema` (which every adapter
 * calls) yields its compact form, while validation is untouched — the
 * wrapper delegates `validate` to the original. Used by
 * {@link compactToolSchemas} and the agent's `toolSchemas: "compact"`.
 * Returns `undefined` for an absent schema.
 */
export function withCompactJsonSchema<TInput>(
  schema: StandardSchemaV1<TInput> | undefined,
  options: CompactJsonSchemaOptions = {},
): StandardSchemaV1<TInput> | undefined {
  if (!schema) {
    return undefined;
  }

  const jsonSchemaFor = (input: { target?: string } | undefined): Record<string, unknown> => {
    const extracted = extractJsonSchema(schema, {
      ...(input?.target ? { target: input.target } : {}),
      compact: options,
    });

    return extracted ?? { type: "object", properties: {} };
  };

  return {
    "~standard": {
      ...schema["~standard"],
      jsonSchema: { input: jsonSchemaFor, output: jsonSchemaFor },
    },
  } as StandardSchemaV1<TInput>;
}

/**
 * Probe the Standard JSON Schema V1 extension path on `schema["~standard"]`.
 * The spec defines `jsonSchema.input({ target, libraryOptions? })` as a
 * function returning a JSON Schema tailored to the requested target. We
 * pass the caller's target (default `"openai-strict"`) so the library
 * produces output ready for OpenAI's native structured-output mode
 * without additional post-processing.
 *
 * Calling `.input()` without a target would throw (or return garbage) per
 * the spec — a failure here returns `undefined` so the fallback probe
 * runs.
 */
function extractFromSealPath(
  schema: StandardSchemaV1<unknown>,
  target: string,
): Record<string, unknown> | undefined {
  const standardSlot = (schema as unknown as Record<string, unknown>)["~standard"];

  if (!standardSlot || typeof standardSlot !== "object") {
    return undefined;
  }

  const jsonSchemaSlot = (standardSlot as Record<string, unknown>)["jsonSchema"];

  if (!jsonSchemaSlot || typeof jsonSchemaSlot !== "object") {
    return undefined;
  }

  const inputFn = (jsonSchemaSlot as Record<string, unknown>)["input"];

  if (typeof inputFn !== "function") {
    return undefined;
  }

  try {
    const result = (inputFn as (options: { target: string }) => unknown).call(jsonSchemaSlot, {
      target,
    });

    if (result && typeof result === "object") {
      return result as Record<string, unknown>;
    }
  } catch {
    // fall through — library didn't support the target or threw otherwise
  }

  return undefined;
}

/**
 * Probe well-known top-level keys libraries use to expose their JSON
 * Schema. Supports both method form (rare) and property form (common).
 * Deliberately narrow — `toJSON` is NOT probed here because it's a
 * generic serialization hook that returns library-internal state for
 * many validators (Seal included), not a JSON Schema.
 */
function extractFromCandidateKeys(
  schemaRecord: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const candidateKeys = ["jsonSchema", "_jsonSchema"] as const;

  for (const key of candidateKeys) {
    const value = schemaRecord[key];

    if (typeof value === "function") {
      try {
        const result = (value as () => unknown).call(schemaRecord);

        if (result && typeof result === "object") {
          return result as Record<string, unknown>;
        }
      } catch {
        // try next candidate
      }

      continue;
    }

    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }

  return undefined;
}
