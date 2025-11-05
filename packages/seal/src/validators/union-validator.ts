import { unionRule } from "../rules";
import { BaseValidator } from "./base-validator";

/**
 * Union validator class - validates value against multiple validator types
 *
 * Tries each validator in order until one passes. If a validator's matchesType()
 * returns false, it's skipped for optimization. First validator that both matches
 * the type and passes validation wins.
 *
 * @example
 * ```ts
 * // Accept email or username
 * const identifier = v.union([
 *   v.string().email(),
 *   v.string().alphanumeric().min(3).max(20)
 * ]);
 *
 * // Accept different types
 * const customValue = v.union([
 *   v.string().required(),
 *   v.number().required(),
 *   v.boolean().required(),
 *   v.file().required()
 * ]);
 * ```
 */
export class UnionValidator extends BaseValidator {
  /**
   * Set the validators to try for union validation
   *
   * @param validators - Array of validators to try
   * @param errorMessage - Optional custom error message if all validators fail
   * @returns This validator for chaining
   *
   * @example
   * ```ts
   * new UnionValidator()
   *   .union([v.string(), v.number()], 'Must be string or number');
   * ```
   */
  public union(validators: BaseValidator[], errorMessage?: string) {
    const rule = this.addRule(unionRule, errorMessage);
    rule.context.options.validators = validators;
    return this;
  }
}
