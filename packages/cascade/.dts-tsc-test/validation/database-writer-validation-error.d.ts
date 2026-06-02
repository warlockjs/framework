import type { ValidationResult } from "@warlock.js/seal";
/**
 * Error thrown when model validation fails during database write operations.
 *
 * Contains detailed information about all validation errors,
 * including field paths, error messages, and validation rules that failed.
 *
 * @example
 * ```typescript
 * try {
 *   const user = new User({ name: "", age: -5 });
 *   await user.save();
 * } catch (error) {
 *   if (error instanceof DatabaseWriterValidationError) {
 *     console.log(error.message); // "Validation failed"
 *     console.log(error.errors);
 *     // [
 *     //   { path: "name", error: "name is required", rule: "required" },
 *     //   { path: "age", error: "age must be at least 0", rule: "min" }
 *     // ]
 *   }
 * }
 * ```
 */
export declare class DatabaseWriterValidationError extends Error {
    /**
     * Array of validation errors from @warlock.js/seal.
     *
     * Each error contains:
     * - `path`: Dot-notation path to the field (e.g., "address.city")
     * - `error`: Human-readable error message
     * - `rule`: The validation rule that failed (e.g., "required", "email")
     * - Additional context depending on the rule
     */
    readonly errors: ValidationResult["errors"];
    /**
     * Create a new DatabaseWriterValidationError.
     *
     * @param message - Error message (typically "Validation failed")
     * @param errors - Array of validation errors from seal
     *
     * @example
     * ```typescript
     * const error = new DatabaseWriterValidationError("Validation failed", [
     *   { path: "email", error: "email must be valid", rule: "email" }
     * ]);
     * ```
     */
    constructor(message: string, errors: ValidationResult["errors"]);
    /**
     * Get a formatted string representation of all validation errors.
     *
     * Provides beautiful, colored terminal output with clear field-by-field breakdown.
     *
     * @returns Multi-line string with all errors, formatted for terminal
     *
     * @example
     * ```typescript
     * console.log(error.toString());
     * // ❌ Validation Error: UserModel
     * //
     * //   Field: email
     * //   Error: Email already exists
     * //   Value: "john@example.com"
     * ```
     */
    toString(): string;
    /**
     * Get validation errors for a specific field.
     *
     * @param fieldPath - Dot-notation path to the field
     * @returns Array of errors for that field
     *
     * @example
     * ```typescript
     * const emailErrors = error.getFieldErrors("email");
     * console.log(emailErrors);
     * // [{ path: "email", error: "email must be valid", rule: "email" }]
     * ```
     */
    getFieldErrors(fieldPath: string): ValidationResult["errors"];
    /**
     * Check if a specific field has validation errors.
     *
     * @param fieldPath - Dot-notation path to the field
     * @returns True if the field has errors
     *
     * @example
     * ```typescript
     * if (error.hasFieldError("email")) {
     *   console.log("Email is invalid");
     * }
     * ```
     */
    hasFieldError(fieldPath: string): boolean;
}
//# sourceMappingURL=database-writer-validation-error.d.ts.map