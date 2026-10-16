import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Tiny, dependency-free [Standard Schema](https://standardschema.dev)
 * builders for the tools' input validation. The package pins only
 * `@warlock.js/ai` as a required runtime peer and keeps every heavy
 * dependency optional, so rather than pull in a schema library we
 * hand-roll the few shapes the tools need — exactly the pattern
 * `@warlock.js/ai`'s own `tool()` tests use. Each builder returns a
 * `StandardSchemaV1`, which is what `tool({ input })` validates against
 * before calling `execute`.
 *
 * These intentionally cover only the primitive cases the bundled tools
 * require (`string`, an optional string drawn from a fixed set, an
 * optional string-to-string record, and an opaque passthrough value),
 * plus an `object` of fields. They are not a general-purpose validator.
 */

/** The vendor tag stamped on every issue these builders produce. */
const VENDOR = "ai-tools";

/**
 * A single field validator inside {@link objectSchema}: given a value,
 * return either the coerced value or a list of issues. Field validators
 * receive the raw property and the property name (for issue messages).
 */
export type FieldValidator<T> = (
  value: unknown,
  key: string,
) => { value: T } | { issues: StandardSchemaV1.Issue[] };

/** Required string field — rejects anything that is not a string. */
export function stringField(): FieldValidator<string> {
  return (value, key) => {
    if (typeof value === "string") {
      return { value };
    }

    return { issues: [{ message: `"${key}" must be a string`, path: [key] }] };
  };
}

/**
 * Optional string field constrained to a fixed set of allowed values.
 * Accepts `undefined` (the property absent or explicitly undefined) or
 * one of `allowed`; rejects any other string and every non-string type.
 * Used for `method` so an out-of-vocabulary verb is a clean validation
 * error rather than reaching the handler.
 *
 * @param allowed - The exhaustive set of permitted string literals.
 */
export function optionalStringEnumField<T extends string>(
  allowed: readonly T[],
): FieldValidator<T | undefined> {
  return (value, key) => {
    if (value === undefined) {
      return { value: undefined };
    }

    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
      return { value: value as T };
    }

    return {
      issues: [
        {
          message: `"${key}" must be one of: ${allowed.join(", ")}`,
          path: [key],
        },
      ],
    };
  };
}

/**
 * Optional string-to-string record field — accepts `undefined` or a flat
 * object whose every value is a string, and rejects arrays, non-objects,
 * and any record with a non-string value. Used for per-call `headers`.
 */
export function optionalStringRecordField(): FieldValidator<Record<string, string> | undefined> {
  return (value, key) => {
    if (value === undefined) {
      return { value: undefined };
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {
        issues: [
          { message: `"${key}" must be an object of string values when provided`, path: [key] },
        ],
      };
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, string> = {};

    for (const recordKey of Object.keys(source)) {
      const entry = source[recordKey];

      if (typeof entry !== "string") {
        return {
          issues: [
            {
              message: `"${key}.${recordKey}" must be a string`,
              path: [key, recordKey],
            },
          ],
        };
      }

      result[recordKey] = entry;
    }

    return { value: result };
  };
}

/**
 * Opaque passthrough field — accepts any value (including `undefined`)
 * verbatim, performing no validation. Used for a request `body` whose
 * shape the tool deliberately does not constrain: an object is later
 * JSON-serialized, a string is sent as-is.
 */
export function passthroughField(): FieldValidator<unknown> {
  return (value) => ({ value });
}

/** The per-key field validator map describing an object schema's shape. */
type ObjectShape<T> = {
  [K in keyof T]-?: FieldValidator<T[K]>;
};

/**
 * Build a {@link StandardSchemaV1} for a flat object whose every property
 * is validated by a {@link FieldValidator}. The input must be a non-null
 * object; each declared field is validated and the (possibly coerced)
 * values are collected into the typed result. All field issues are merged
 * so the caller sees every problem at once.
 *
 * `T` is constrained to `object` rather than `Record<string, unknown>` so
 * the tool IO `interface`s (which carry no implicit string index
 * signature) satisfy it directly — only the declared keys in `shape` are
 * ever read, so a string index signature is never required.
 *
 * @example
 * const schema = objectSchema<{ url: string; method?: HttpMethod }>({
 *   url: stringField(),
 *   method: optionalStringEnumField(["GET", "POST"]),
 * });
 */
export function objectSchema<T extends object>(shape: ObjectShape<T>): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: VENDOR,
      validate(input) {
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
          return { issues: [{ message: "input must be an object" }] };
        }

        const source = input as Record<string, unknown>;
        const issues: StandardSchemaV1.Issue[] = [];
        const result: Record<string, unknown> = {};

        for (const key of Object.keys(shape) as (keyof T)[]) {
          const field = shape[key];
          const present = (key as string) in source;
          const outcome = field(source[key as string], key as string);

          if ("issues" in outcome) {
            issues.push(...outcome.issues);

            continue;
          }

          // Carry through any key that resolved to a defined value. A
          // passthrough field can legitimately resolve to `undefined`
          // even when the property was present (e.g. an explicit
          // `body: undefined`); only suppress keys that were absent so
          // optional-absent fields stay absent.
          if (outcome.value !== undefined || present) {
            result[key as string] = outcome.value;
          }
        }

        if (issues.length > 0) {
          return { issues };
        }

        return { value: result as T };
      },
    },
  };
}
