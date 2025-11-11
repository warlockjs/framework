import { setKeyPath } from "../helpers";
import { arrayRule } from "../rules";
import type { SchemaContext, ValidationResult } from "../types";
import { BaseValidator } from "./base-validator";

/**
 * Tuple validator class - validates fixed-length arrays with position-specific types
 *
 * @example
 * ```ts
 * // RGB color tuple
 * v.tuple([v.number(), v.number(), v.number()])
 * // Valid: [255, 128, 0]
 * // Invalid: [255, 128] (too short)
 *
 * // Mixed types
 * v.tuple([v.string(), v.int(), v.boolean()])
 * // Valid: ["John", 25, true]
 * ```
 */
export class TupleValidator extends BaseValidator {
  public constructor(
    public validators: BaseValidator[],
    errorMessage?: string,
  ) {
    super();
    this.addRule(arrayRule, errorMessage);
  }

  /**
   * Check if value is an array type
   */
  public matchesType(value: any): boolean {
    return Array.isArray(value);
  }

  /**
   * Clone the validator
   */
  public override clone(): this {
    const cloned = super.clone();
    cloned.validators = this.validators.map(v => v.clone());
    return cloned;
  }

  /**
   * Validate tuple - check length then validate each position
   */
  public async validate(
    data: any,
    context: SchemaContext,
  ): Promise<ValidationResult> {
    const mutatedData = (await this.mutate(data, context)) || [];
    const result = await super.validate(data, context);

    if (result.isValid === false) return result;

    const errors: ValidationResult["errors"] = [];

    // Tuple-specific: length validation
    if (mutatedData.length !== this.validators.length) {
      errors.push({
        type: "tuple",
        input: context.key || "value",
        error: `Expected exactly ${this.validators.length} items, but got ${mutatedData.length}`,
      });
      return { isValid: false, errors, data: mutatedData };
    }

    // Validate each position with its specific validator in parallel
    const validationPromises = this.validators.map(async (validator, index) => {
      const childContext: SchemaContext = {
        ...context,
        parent: mutatedData,
        value: mutatedData[index],
        key: index.toString(),
        path: setKeyPath(context.path, index.toString()),
      };

      const childResult = await validator.validate(
        mutatedData[index],
        childContext,
      );

      // Update mutated data with validated result
      mutatedData[index] = childResult.data;

      // Collect errors from this element
      if (childResult.isValid === false) {
        errors.push(...childResult.errors);
      }
    });

    await Promise.all(validationPromises);

    return {
      isValid: errors.length === 0,
      errors,
      data: await this.startTransformationPipeline(mutatedData, context),
    };
  }
}
