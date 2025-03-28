import { numberMutator } from "../mutators";
import {
  betweenRule,
  evenRule,
  floatRule,
  greaterThanOrEqualRule,
  greaterThanRule,
  intRule,
  lessThanOrEqualRule,
  lessThanRule,
  negativeRule,
  numberRule,
  oddRule,
  positiveRule,
} from "../rules";
import { BaseValidator } from "./base.validator";
import { ScalarValidator } from "./scalar.validator";

export class NumberValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(numberRule, errorMessage);
    this.addMutator(numberMutator);
  }

  /**
   * Value must be an integer
   */
  public integer(errorMessage?: string) {
    this.addRule(intRule, errorMessage);
    return this;
  }

  /**
   * Value must be a float
   */
  public float(errorMessage?: string) {
    this.addRule(floatRule, errorMessage);
    return this;
  }

  /**
   * Value must be positive
   */
  public positive(errorMessage?: string) {
    this.addRule(positiveRule, errorMessage);
    return this;
  }

  /**
   * Value must be negative
   */
  public negative(errorMessage?: string) {
    this.addRule(negativeRule, errorMessage);
    return this;
  }

  /**
   * Value must be even
   */
  public even(errorMessage?: string) {
    this.addRule(evenRule, errorMessage);
    return this;
  }

  /**
   * Value must be odd
   */
  public odd(errorMessage?: string) {
    this.addRule(oddRule, errorMessage);
    return this;
  }

  /**
   * Value must be greater than the given value
   */
  public greaterThan(value: number, errorMessage?: string) {
    const rule = this.addRule(greaterThanRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must be greater than or equal to the given value
   */
  public greaterThanOrEqual(value: number, errorMessage?: string) {
    const rule = this.addRule(greaterThanOrEqualRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must be less than the given value
   */
  public lessThan(value: number, errorMessage?: string) {
    const rule = this.addRule(lessThanRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must be less than or equal to the given value
   */
  public lessThanOrEqual(value: number, errorMessage?: string) {
    const rule = this.addRule(lessThanOrEqualRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must be between the given values
   */
  public between(min: number, max: number, errorMessage?: string) {
    const rule = this.addRule(betweenRule, errorMessage);
    rule.context.options.min = min;
    rule.context.options.max = max;
    return this;
  }

  // Scalar methods
  public enum: typeof ScalarValidator.prototype.enum =
    ScalarValidator.prototype.enum;
  public in: typeof ScalarValidator.prototype.in = ScalarValidator.prototype.in;
  public oneOf: typeof ScalarValidator.prototype.in =
    ScalarValidator.prototype.in;
  public unique: typeof ScalarValidator.prototype.unique =
    ScalarValidator.prototype.unique;
  public uniqueExceptCurrentUser: typeof ScalarValidator.prototype.uniqueExceptCurrentUser =
    ScalarValidator.prototype.uniqueExceptCurrentUser;
  public uniqueExceptCurrentId: typeof ScalarValidator.prototype.uniqueExceptCurrentId =
    ScalarValidator.prototype.uniqueExceptCurrentId;
  public exists: typeof ScalarValidator.prototype.exists =
    ScalarValidator.prototype.exists;
  public existsExceptCurrentUser: typeof ScalarValidator.prototype.existsExceptCurrentUser =
    ScalarValidator.prototype.existsExceptCurrentUser;
  public existsExceptCurrentId: typeof ScalarValidator.prototype.existsExceptCurrentId =
    ScalarValidator.prototype.existsExceptCurrentId;
  public allowsOnly: typeof ScalarValidator.prototype.allowsOnly =
    ScalarValidator.prototype.allowsOnly;
  public forbids: typeof ScalarValidator.prototype.forbids =
    ScalarValidator.prototype.forbids;
  public notIn: typeof ScalarValidator.prototype.forbids =
    ScalarValidator.prototype.forbids;
}
