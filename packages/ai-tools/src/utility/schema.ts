import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Tiny, dependency-free [Standard Schema](https://standardschema.dev)
 * builders for the utility tools' input validation. This package pins
 * only `@warlock.js/ai` as a runtime peer, so rather than pull in a
 * schema library we hand-roll the few field shapes the calculator and
 * date-time tools need — the same approach `@warlock.js/ai`'s own
 * `tool()` tests use. Each builder returns a {@link StandardSchemaV1},
 * which is what `tool({ input })` validates against before calling
 * `execute`.
 *
 * These intentionally cover only the primitive cases the UTILITY tools
 * require (`string`, `optional string`, `optional number`, and a
 * `literal union` enum). They are not a general-purpose validator.
 */

/** The vendor tag stamped on every issue these builders produce. */
const VENDOR = "ai-tools";

/**
 * A single field validator inside {@link objectSchema}: given a value,
 * return either the coerced value or a list of issues. Field validators
 * receive the raw property and the property name (for issue messages).
 */
type FieldValidator<T> = (
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
 * Optional string field — accepts `undefined` (the property absent or
 * explicitly undefined) or a string, and rejects every other type.
 */
export function optionalStringField(): FieldValidator<string | undefined> {
  return (value, key) => {
    if (value === undefined) {
      return { value: undefined };
    }

    if (typeof value === "string") {
      return { value };
    }

    return {
      issues: [{ message: `"${key}" must be a string when provided`, path: [key] }],
    };
  };
}

/**
 * Optional finite-number field — accepts `undefined` or a finite number,
 * rejecting `NaN`/`Infinity` and non-number types.
 */
export function optionalNumberField(): FieldValidator<number | undefined> {
  return (value, key) => {
    if (value === undefined) {
      return { value: undefined };
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return { value };
    }

    return {
      issues: [{ message: `"${key}" must be a finite number when provided`, path: [key] }],
    };
  };
}

/**
 * Required literal-union field — accepts only one of `allowed`, rejecting
 * everything else. Used for discriminators like the date-time `op`.
 *
 * @param allowed - The closed set of permitted string literals.
 */
export function literalField<T extends string>(allowed: readonly T[]): FieldValidator<T> {
  return (value, key) => {
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
 * const schema = objectSchema<{ expression: string }>({
 *   expression: stringField(),
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
          const outcome = field(source[key as string], key as string);

          if ("issues" in outcome) {
            issues.push(...outcome.issues);

            continue;
          }

          // Only carry through keys that resolved to a defined value, so
          // optional-absent fields stay absent rather than becoming
          // explicit `undefined` properties.
          if (outcome.value !== undefined) {
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
