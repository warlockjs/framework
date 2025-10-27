import { numberMutator } from "../mutators";
import {
  betweenNumbersRule,
  evenRule,
  maxRule,
  minRule,
  moduloRule,
  negativeRule,
  numberRule,
  oddRule,
  positiveRule,
} from "../rules";
import { BaseValidator } from "./base-validator";
import { ScalarValidator } from "./scalar-validator";
import { StringValidator } from "./string-validator";

/**
 * Number validator class - base for Int and Float validators
 */
export class NumberValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addRule(numberRule, errorMessage);
    this.addMutator(numberMutator);
  }

  /** Value must be equal or higher than the given number */
  public min(min: number, errorMessage?: string) {
    const rule = this.addRule(minRule, errorMessage);
    rule.context.options.min = min;
    return this;
  }

  /** Value must be equal or less than the given number */
  public max(max: number, errorMessage?: string) {
    const rule = this.addRule(maxRule, errorMessage);
    rule.context.options.max = max;
    return this;
  }

  /** Value must be a modulo of the given number */
  public modulo(value: number, errorMessage?: string) {
    const rule = this.addRule(moduloRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /** Accept only numbers higher than 0 */
  public positive(errorMessage?: string) {
    this.addRule(positiveRule, errorMessage);
    return this;
  }

  /** Accept only negative numbers */
  public negative(errorMessage?: string) {
    this.addRule(negativeRule, errorMessage);
    return this;
  }

  /** Accept only odd numbers */
  public odd(errorMessage?: string) {
    this.addRule(oddRule, errorMessage);
    return this;
  }

  /** Accept only even numbers */
  public even(errorMessage?: string) {
    this.addRule(evenRule, errorMessage);
    return this;
  }

  /** Accept only numbers between the given two numbers (Inclusive) */
  public between(min: number, max: number, errorMessage?: string) {
    const rule = this.addRule(betweenNumbersRule, errorMessage);
    rule.context.options.min = min;
    rule.context.options.max = max;
    return this;
  }

  // Enum and value checking methods from ScalarValidator
  public enum = ScalarValidator.prototype.enum;
  public in = ScalarValidator.prototype.in;
  public oneOf = ScalarValidator.prototype.in;
  public allowsOnly = ScalarValidator.prototype.allowsOnly;
  public forbids = ScalarValidator.prototype.forbids;
  public notIn = ScalarValidator.prototype.forbids;

  // Length methods from StringValidator
  public length = StringValidator.prototype.length;
  public minLength = StringValidator.prototype.minLength;
  public maxLength = StringValidator.prototype.maxLength;

  // Database methods - injected by framework
  // When using @warlock.js/core/v, these methods are available:
  // unique, exists
}
