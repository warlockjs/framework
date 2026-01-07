import type { SchemaContext, ValidationResult } from "../types";
import { BaseValidator } from "./base-validator";

/**
 * Callback function for computed fields
 * Receives validated & mutated data and full schema context
 */
export type ComputedCallback<TResult = any> = (
  data: any,
  context: SchemaContext,
) => TResult | Promise<TResult>;

/**
 * Computed field validator
 *
 * Computes a value based on other validated fields in the schema.
 * The computed value is persisted and can optionally be validated.
 *
 * @example
 * ```ts
 * // Basic computed field
 * const schema = v.object({
 *   title: v.string().required(),
 *   slug: v.computed(data => slugify(data.title)),
 * });
 *
 * // With result validation
 * const schema = v.object({
 *   title: v.string().required(),
 *   slug: v.computed(
 *     data => slugify(data.title),
 *     v.string().minLength(3)
 *   ),
 * });
 *
 * // Async computation
 * const schema = v.object({
 *   image: v.string().url(),
 *   thumbnail: v.computed(async data => {
 *     return await generateThumbnail(data.image);
 *   }),
 * });
 * ```
 */
export class ComputedValidator<TResult = any> extends BaseValidator {
  /**
   * Create a new computed field validator
   *
   * @param callback - Function to compute the value from validated data
   * @param resultValidator - Optional validator to validate the computed result
   */
  public constructor(
    protected callback: ComputedCallback<TResult>,
    protected resultValidator?: BaseValidator,
  ) {
    super();
  }

  /**
   * Execute the callback and optionally validate the result
   */
  public async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
    try {
      // Execute the callback with validated data
      const result = await this.callback(data, context);

      // Optionally validate the computed result
      if (this.resultValidator) {
        const validation = await this.resultValidator.validate(result, context);

        if (!validation.isValid) {
          return {
            isValid: false,
            errors: validation.errors,
            data: undefined,
          };
        }

        return {
          isValid: true,
          errors: [],
          data: validation.data,
        };
      }

      // No validation - return computed result directly
      return {
        isValid: true,
        errors: [],
        data: result,
      };
    } catch (error) {
      // Handle callback execution errors
      return {
        isValid: false,
        errors: [
          {
            type: "computed",
            error: error instanceof Error ? error.message : "Computed field callback failed",
            input: context.path,
          },
        ],
        data: undefined,
      };
    }
  }

  /**
   * Clone this validator with all its configuration
   * Critical for ObjectValidator.clone(), extend(), merge(), etc.
   */
  public override clone(): this {
    const cloned = super.clone();

    // Copy ComputedValidator-specific properties
    cloned.callback = this.callback; // Functions are safe to copy by reference
    cloned.resultValidator = this.resultValidator?.clone(); // Deep clone validator

    return cloned;
  }

  /**
   * Computed fields don't have a specific type to match
   */
  public matchesType(value: any): boolean {
    return true; // Computed fields accept any input (they generate their own value)
  }
}
