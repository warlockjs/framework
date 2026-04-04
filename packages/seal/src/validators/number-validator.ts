import { absMutator, ceilMutator, floorMutator, roundMutator, toFixedMutator } from "../mutators";
import {
  betweenNumbersRule,
  evenRule,
  greaterThanRule,
  lengthRule,
  lessThanRule,
  maxLengthRule,
  maxRule,
  minLengthRule,
  minRule,
  moduloRule,
  negativeRule,
  numberRule,
  oddRule,
  positiveRule,
} from "../rules";
import { PrimitiveValidator } from "./primitive-validator";

/**
 * Number validator class - base for Int and Float validators
 */
export class NumberValidator extends PrimitiveValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addMutableRule(numberRule, errorMessage);
  }

  /**
   * Check if value is a number type
   */
  public matchesType(value: any): boolean {
    return typeof value === "number" && !isNaN(value);
  }

  /**
   * Value must be equal or higher than the given number or field
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public min(min: number | string, errorMessage?: string) {
    return this.addRule(minRule, errorMessage, { min, scope: "global" });
  }

  /**
   * Value must be equal or less than the given number or field
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public max(max: number | string, errorMessage?: string) {
    return this.addRule(maxRule, errorMessage, { max, scope: "global" });
  }

  /**
   * Value must be >= sibling field value
   * @category Validation Rule
   */
  public minSibling(field: string, errorMessage?: string) {
    return this.addRule(minRule, errorMessage, { min: field, scope: "sibling" });
  }

  /**
   * Value must be <= sibling field value
   * @category Validation Rule
   */
  public maxSibling(field: string, errorMessage?: string) {
    return this.addRule(maxRule, errorMessage, { max: field, scope: "sibling" });
  }

  /**
   * Value must be strictly greater than the given number or field (>)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public greaterThan(value: number | string, errorMessage?: string) {
    return this.addRule(greaterThanRule, errorMessage, {
      value,
      scope: "global",
    });
  }

  /**
   * Value must be strictly less than the given number or field (<)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public lessThan(value: number | string, errorMessage?: string) {
    return this.addRule(lessThanRule, errorMessage, {
      value,
      scope: "global",
    });
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
    return this.addRule(greaterThanRule, errorMessage, {
      value: field,
      scope: "sibling",
    });
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
    return this.addRule(lessThanRule, errorMessage, {
      value: field,
      scope: "sibling",
    });
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
    return this.addRule(moduloRule, errorMessage, { value });
  }

  /**
   * Alias for modulo() - Value must be divisible by the given number
   */
  public divisibleBy(value: number, errorMessage?: string) {
    return this.modulo(value, errorMessage);
  }

  /**
   * Alias for modulo() - Value must be a multiple of the given number
   */
  public multipleOf(value: number, errorMessage?: string) {
    return this.modulo(value, errorMessage);
  }

  /**
   * Alias for modulo() - Value must be a multiple of the given number
   */
  public modulusOf(value: number, errorMessage?: string) {
    return this.modulo(value, errorMessage);
  }

  /** Accept only numbers higher than 0 */
  public positive(errorMessage?: string) {
    return this.addRule(positiveRule, errorMessage);
  }

  /** Accept only negative numbers */
  public negative(errorMessage?: string) {
    return this.addRule(negativeRule, errorMessage);
  }

  /** Accept only odd numbers */
  public odd(errorMessage?: string) {
    return this.addRule(oddRule, errorMessage);
  }

  /** Accept only even numbers */
  public even(errorMessage?: string) {
    return this.addRule(evenRule, errorMessage);
  }

  /**
   * Accept only numbers between the given two numbers or fields (Inclusive)
   * Smart detection: number or field name
   *
   * @category Validation Rule
   */
  public between(min: number | string, max: number | string, errorMessage?: string) {
    return this.addRule(betweenNumbersRule, errorMessage, {
      min,
      max,
      scope: "global",
    });
  }

  /**
   * Value must be between sibling field values
   * @category Validation Rule
   */
  public betweenSibling(minField: string, maxField: string, errorMessage?: string) {
    return this.addRule(betweenNumbersRule, errorMessage, {
      min: minField,
      max: maxField,
      scope: "sibling",
    });
  }

  // Enum and value membership methods are inherited from PrimitiveValidator.

  /**
   * Value (as a string) must be exactly this many characters.
   * Useful for fixed-format numeric codes (e.g. 4-digit PIN).
   */
  public length(length: number, errorMessage?: string) {
    return this.addRule(lengthRule, errorMessage, { length });
  }

  /** Value (as string representation) length must be ≥ min */
  public minLength(length: number, errorMessage?: string) {
    return this.addRule(minLengthRule, errorMessage, { minLength: length });
  }

  /** Value (as string representation) length must be ≤ max */
  public maxLength(length: number, errorMessage?: string) {
    return this.addRule(maxLengthRule, errorMessage, { maxLength: length });
  }

  // Mutators

  /**
   * Convert value to its absolute value
   */
  public abs() {
    return this.addMutator(absMutator);
  }

  /**
   * Round value up to the nearest integer
   */
  public ceil() {
    return this.addMutator(ceilMutator);
  }

  /**
   * Round value down to the nearest integer
   */
  public floor() {
    return this.addMutator(floorMutator);
  }

  /**
   * Round value to the nearest integer or specified decimals
   */
  public round(decimals = 0) {
    return this.addMutator(roundMutator, { decimals });
  }

  /**
   * Format number using fixed-point notation
   */
  public toFixed(decimals = 2) {
    return this.addMutator(toFixedMutator, { decimals });
  }
}
