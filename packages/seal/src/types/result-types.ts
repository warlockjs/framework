/**
 * Validation result
 */
export type ValidationResult = {
  /** Whether validation passed */
  isValid: boolean;
  /** Validated and potentially mutated data */
  data: any;
  /** List of validation errors */
  errors: {
    /** Rule type that failed */
    type: string;
    /** Error message */
    error: string;
    /** Input field name */
    input: string;
  }[];
};

/**
 * What `validate()` returns: a result narrowed by `isValid`.
 *
 * On success `data` is the schema's validated output; on failure it is always
 * `undefined` (a failed validation never hands back the input it rejected).
 *
 * @example
 * ```ts
 * const result = await validate(schema, input);
 *
 * if (!result.isValid) return result.errors;
 *
 * result.data; // Infer.Output<typeof schema>
 * ```
 */
export type TypedValidationResult<TData> =
  | { isValid: true; data: TData; errors: ValidationResult["errors"] }
  | { isValid: false; data: undefined; errors: ValidationResult["errors"] };
