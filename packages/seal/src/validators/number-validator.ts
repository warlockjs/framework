import { numberMutator } from "../mutators";
import {
  betweenNumbersRule,
  evenRule,
  greaterThanRule,
  lessThanRule,
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

  /**
   * Value must be equal or higher than the given number or field
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public min(min: number | string, errorMessage?: string) {
    const rule = this.addRule(minRule, errorMessage);
    rule.context.options.min = min;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value must be equal or less than the given number or field
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public max(max: number | string, errorMessage?: string) {
    const rule = this.addRule(maxRule, errorMessage);
    rule.context.options.max = max;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value must be >= sibling field value
   * @category Validation Rule
   */
  public minSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(minRule, errorMessage);
    rule.context.options.min = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value must be <= sibling field value
   * @category Validation Rule
   */
  public maxSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(maxRule, errorMessage);
    rule.context.options.max = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value must be strictly greater than the given number or field (>)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public greaterThan(value: number | string, errorMessage?: string) {
    const rule = this.addRule(greaterThanRule, errorMessage);
    rule.context.options.value = value;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value must be strictly less than the given number or field (<)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public lessThan(value: number | string, errorMessage?: string) {
    const rule = this.addRule(lessThanRule, errorMessage);
    rule.context.options.value = value;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Alias for greaterThan() - shorter syntax
   * @category Validation Rule
   */
  public gt(value: number | string, errorMessage?: string) {
    return this.greaterThan(value, errorMessage);
  }

  /**
   * Alias for lessThan() - shorter syntax
   * @category Validation Rule
   */
  public lt(value: number | string, errorMessage?: string) {
    return this.lessThan(value, errorMessage);
  }

  /**
   * Value must be > sibling field value
   * @category Validation Rule
   */
  public greaterThanSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(greaterThanRule, errorMessage);
    rule.context.options.value = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Alias for greaterThanSibling() - shorter syntax
   * @category Validation Rule
   */
  public gtSibling(field: string, errorMessage?: string) {
    return this.greaterThanSibling(field, errorMessage);
  }

  /**
   * Value must be < sibling field value
   * @category Validation Rule
   */
  public lessThanSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(lessThanRule, errorMessage);
    rule.context.options.value = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Alias for lessThanSibling() - shorter syntax
   * @category Validation Rule
   */
  public ltSibling(field: string, errorMessage?: string) {
    return this.lessThanSibling(field, errorMessage);
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

  /**
   * Accept only numbers between the given two numbers or fields (Inclusive)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public between(
    min: number | string,
    max: number | string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenNumbersRule, errorMessage);
    rule.context.options.min = min;
    rule.context.options.max = max;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value must be between sibling field values
   * @category Validation Rule
   */
  public betweenSibling(
    minField: string,
    maxField: string,
    errorMessage?: string,
  ) {
    const rule = this.addRule(betweenNumbersRule, errorMessage);
    rule.context.options.min = minField;
    rule.context.options.max = maxField;
    rule.context.options.scope = "sibling";
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
