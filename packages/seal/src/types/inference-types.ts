import type {
  AnyValidator,
  ArrayValidator,
  BaseValidator,
  BooleanValidator,
  ComputedValidator,
  DateValidator,
  FloatValidator,
  IntValidator,
  ManagedValidator,
  ObjectValidator,
  ScalarValidator,
  StringValidator,
} from "../validators";

/**
 * Infer the output type from a validator
 *
 * Note: All fields are typed as required (non-optional).
 * Actual requirement validation happens at runtime.
 * Fields marked with .omit() or .exclude() are excluded from the type.
 *
 * @example
 * ```ts
 * const schema = v.object({
 *   name: v.string().required(),
 *   email: v.string().email(),
 *   confirmEmail: v.string().sameAs("email").omit(),
 * });
 *
 * type User = Infer<typeof schema>;
 * // Result: { name: string; email: string }
 * // confirmEmail is omitted from type
 * ```
 */

export type Infer<T> =
  T extends ObjectValidator<infer S>
    ? {
        [K in keyof S]: Infer<S[K]>;
      }
    : T extends ArrayValidator
      ? T extends { validator: infer V extends BaseValidator }
        ? Array<Infer<V>>
        : never
      : T extends ComputedValidator<infer R>
        ? R
        : T extends ManagedValidator<infer R>
          ? R
          : T extends StringValidator
            ? string
            : T extends IntValidator
              ? number
              : T extends FloatValidator
                ? number
                : T extends BooleanValidator
                  ? boolean
                  : T extends DateValidator
                    ? Date
                    : T extends ScalarValidator
                      ? string | number | boolean
                      : T extends AnyValidator
                        ? any
                        : unknown;
