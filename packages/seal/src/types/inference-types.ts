import type { StandardSchemaV1 } from "../standard-schema/types";
import type {
  AnyValidator,
  ArrayValidator,
  BaseValidator,
  BooleanValidator,
  ComputedValidator,
  DateValidator,
  DiscriminatedUnionValidator,
  FloatValidator,
  InstanceOfValidator,
  IntValidator,
  LazyValidator,
  LiteralValidator,
  ManagedValidator,
  ObjectValidator,
  ScalarValidator,
  StringValidator,
} from "../validators";
import type { Schema } from "./schema-types";

/**
 * Two inference shapes describe the two halves of the validation pipeline:
 *
 * - **`Infer.Input<T>`** — what the *caller* is allowed to send before
 *   validation runs. `.optional()`, `.default()`, and `.catch()` all make a
 *   key optional from the caller's perspective: any of them means "you don't
 *   have to supply this".
 *
 * - **`Infer.Output<T>`** — what `validData` contains *after* validation
 *   passes. Reflects runtime reality: `.default()` and `.catch()` guarantee a
 *   value, so fields with those brands are non-optional in the output even
 *   when chained with `.optional()`.
 *
 * **Bare `Infer<T>` defaults to `Infer.Input<T>`.** Use the explicit form
 * (`Infer.Output<T>`) when typing validated data — Cascade `Model<>` type
 * params, the right-hand-side of a `validate()` call, anywhere downstream
 * of validation that wants the post-default shape.
 *
 * @example
 * ```ts
 * const schema = v.object({
 *   name: v.string(),
 *   email: v.string().email().optional(),
 *   deletedAt: v.date().nullable(),
 *   status: v.string().optional().default("active"),
 * });
 *
 * type In  = Infer.Input<typeof schema>;
 * // {
 * //   name: string;
 * //   email?: string;
 * //   deletedAt: Date | null;
 * //   status?: string;            ← caller may omit; default fires
 * // }
 *
 * type Out = Infer.Output<typeof schema>;
 * // {
 * //   name: string;
 * //   email?: string;
 * //   deletedAt: Date | null;
 * //   status: string;             ← validData always has it
 * // }
 *
 * type Default = Infer<typeof schema>;
 * // equivalent to Infer.Input<typeof schema>
 * ```
 *
 * The walker reads four type-level brands that validators attach via their
 * chain methods:
 *
 * - `{ isOptional: true }` — set by `.optional()`
 * - `{ isNullable: true }` — set by `.nullable()`
 * - `{ hasDefault: true }` — set by `.default()`
 * - `{ hasCatch: true }` — set by `.catch()`
 *
 * Fields marked with `.omit()` / `.exclude()` are excluded from the inferred
 * type via the `ComputedValidator` / runtime omission path. Computed and
 * managed validators surface their declared `TResult` directly.
 */

/**
 * True when the validator's type carries a brand that guarantees a value
 * will always be present (`.default()` or `.catch()`).
 */
type IsGuaranteed<V> = V extends { hasDefault: true }
  ? true
  : V extends { hasCatch: true }
    ? true
    : false;

/**
 * Whether a field should appear as an optional key in the parent object's
 * *output* shape. Optional ONLY when explicitly `.optional()` AND not
 * guaranteed by `.default()` or `.catch()` — runtime always has a value
 * for guaranteed fields, so the output type marks them required.
 */
export type IsOutputOptionalKey<V> = V extends { isOptional: true }
  ? IsGuaranteed<V> extends true
    ? false
    : true
  : false;

/**
 * Whether a field should appear as an optional key in the parent object's
 * *input* shape. Optional whenever `.optional()`, `.default()`, or `.catch()`
 * is present — any of those means the caller doesn't have to supply a value
 * (it'll be filled, defaulted, or rescued).
 */
export type IsInputOptionalKey<V> = V extends
  | { isOptional: true }
  | { hasDefault: true }
  | { hasCatch: true }
  ? true
  : false;

/**
 * Apply `| null` widening when the validator type carries `{ isNullable: true }`.
 *
 * Designed to be applied INSIDE each Infer branch (after type-pattern matching)
 * rather than as a top-level wrapper, because top-level wrapping creates a
 * class-recursive evaluation in `ObjectValidator`'s base class type parameter.
 */
type WithNullable<V, T> = V extends { isNullable: true } ? T | null : T;

/**
 * Compute the inferred *output* object shape for a Schema.
 *
 * Exported so `ObjectValidator` can use this in its class definition without
 * going through the full `Infer.Output<>` walker — referencing the full
 * walker on the parent class's type parameter creates a recursive class-base
 * reference when combined with brand-checks.
 */
export type InferOutputObjectShape<S extends Schema> = {
  [K in keyof S as IsOutputOptionalKey<S[K]> extends true ? K : never]?: Infer.Output<S[K]>;
} & {
  [K in keyof S as IsOutputOptionalKey<S[K]> extends true ? never : K]: Infer.Output<S[K]>;
};

/**
 * Compute the inferred *input* object shape for a Schema. Mirror of
 * `InferOutputObjectShape` but uses `IsInputOptionalKey` — fields with
 * `.default()` or `.catch()` (or `.optional()`) are all marked optional in
 * the input shape.
 */
export type InferInputObjectShape<S extends Schema> = {
  [K in keyof S as IsInputOptionalKey<S[K]> extends true ? K : never]?: Infer.Input<S[K]>;
} & {
  [K in keyof S as IsInputOptionalKey<S[K]> extends true ? never : K]: Infer.Input<S[K]>;
};

/**
 * Bare `Infer<T>` defaults to `Infer.Input<T>`. Use `Infer.Output<T>` when
 * typing validated data (Cascade `Model<>` params, validate() returns).
 */
export type Infer<T> = Infer.Input<T>;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Infer {
  /**
   * Inferred *input* shape — what callers send before validation. Optional
   * keys whenever `.optional()`, `.default()`, or `.catch()` is present.
   */
  export type Input<T> =
    T extends LazyValidator<infer L>
      ? Input<L>
      : T extends DiscriminatedUnionValidator<any, infer Branches>
        ? Branches extends ReadonlyArray<infer B>
          ? B extends BaseValidator
            ? WithNullable<T, Input<B>>
            : never
          : never
        : T extends ObjectValidator<infer S>
          ? WithNullable<T, InferInputObjectShape<S>>
          : T extends ArrayValidator
            ? T extends { validator: infer V extends BaseValidator }
              ? WithNullable<T, Array<Input<V>>>
              : never
            : T extends LiteralValidator<infer V>
              ? WithNullable<T, V[number]>
              : T extends InstanceOfValidator<infer R>
                ? WithNullable<T, R>
                : T extends ComputedValidator<infer R>
                  ? R
                  : T extends ManagedValidator<infer R>
                    ? R
                    : T extends StandardSchemaV1<infer V, any>
                      ? WithNullable<T, V>
                      : T extends StringValidator
                        ? WithNullable<T, string>
                        : T extends IntValidator
                          ? WithNullable<T, number>
                          : T extends FloatValidator
                            ? WithNullable<T, number>
                            : T extends BooleanValidator
                              ? WithNullable<T, boolean>
                              : T extends DateValidator
                                ? WithNullable<T, Date>
                                : T extends ScalarValidator
                                  ? WithNullable<T, string | number | boolean>
                                  : T extends AnyValidator
                                    ? any
                                    : unknown;

  /**
   * Inferred *output* shape — what `validData` contains after validation.
   * Required keys whenever `.default()` or `.catch()` guarantees a value,
   * even when chained with `.optional()`.
   */
  export type Output<T> =
    T extends LazyValidator<infer L>
      ? Output<L>
      : T extends DiscriminatedUnionValidator<any, infer Branches>
        ? Branches extends ReadonlyArray<infer B>
          ? B extends BaseValidator
            ? WithNullable<T, Output<B>>
            : never
          : never
        : T extends ObjectValidator<infer S>
          ? WithNullable<T, InferOutputObjectShape<S>>
          : T extends ArrayValidator
            ? T extends { validator: infer V extends BaseValidator }
              ? WithNullable<T, Array<Output<V>>>
              : never
            : T extends LiteralValidator<infer V>
              ? WithNullable<T, V[number]>
              : T extends InstanceOfValidator<infer R>
                ? WithNullable<T, R>
                : T extends ComputedValidator<infer R>
                  ? R
                  : T extends ManagedValidator<infer R>
                    ? R
                    : // Catch validators carrying a precise Standard Schema output via
                      // intersection (e.g. `ScalarValidator & StandardSchemaV1<"a"|"b">`
                      // produced by `v.enum([...])`). Must come BEFORE the broad
                      // primitive branches below — otherwise `T extends StringValidator`
                      // would match first and widen `"a"|"b"` back to `string`.
                      T extends StandardSchemaV1<infer V, any>
                      ? WithNullable<T, V>
                      : T extends StringValidator
                        ? WithNullable<T, string>
                        : T extends IntValidator
                          ? WithNullable<T, number>
                          : T extends FloatValidator
                            ? WithNullable<T, number>
                            : T extends BooleanValidator
                              ? WithNullable<T, boolean>
                              : T extends DateValidator
                                ? WithNullable<T, Date>
                                : T extends ScalarValidator
                                  ? WithNullable<T, string | number | boolean>
                                  : T extends AnyValidator
                                    ? any
                                    : unknown;
}

/**
 * @deprecated Use `Infer.Input<T>` instead. Kept as an alias for one or two
 * minor versions to ease migration; removed thereafter.
 */
export type InferInput<T> = Infer.Input<T>;

/**
 * @deprecated Use `Infer.Output<T>` instead. Kept as an alias for one or two
 * minor versions to ease migration; removed thereafter.
 */
export type InferOutput<T> = Infer.Output<T>;

/**
 * @deprecated Use `InferOutputObjectShape<S>` instead. Kept for back-compat.
 */
export type InferObjectShape<S extends Schema> = InferOutputObjectShape<S>;

/**
 * @deprecated Use `IsOutputOptionalKey<V>` instead. Kept for back-compat.
 */
export type IsOptionalKey<V> = IsOutputOptionalKey<V>;
