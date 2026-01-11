import { invalidRule, VALID_RULE } from "../helpers";
import { numberMutator, stringMutator } from "../mutators";
import { allowedValuesRule, enumRule, inRule, notAllowedValuesRule } from "../rules";
import {
  acceptedIfPresentRule,
  acceptedIfRequiredRule,
  acceptedIfRule,
  acceptedRule,
  acceptedUnlessRule,
  acceptedWithoutRule,
  declinedIfPresentRule,
  declinedIfRequiredRule,
  declinedIfRule,
  declinedRule,
  declinedUnlessRule,
  declinedWithoutRule,
} from "../rules/scalar";

import { BaseValidator } from "./base-validator";

/**
 * Scalar validator class
 *
 * Core validator for scalar values (string, number, boolean)
 *
 * Database methods (unique, exists, etc.) are injected by the framework
 */
export class ScalarValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addRule(
      {
        name: "scalar",
        defaultErrorMessage: "The :input must be a scalar value",
        async validate(value, context) {
          if (["string", "number", "boolean"].includes(typeof value)) {
            return VALID_RULE;
          }
          return invalidRule(this, context);
        },
      },
      errorMessage,
    );
  }

  /**
   * Add matches type
   */
  public matchesType(value: any) {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }

  /**
   * Mutate the scalar value to be number
   */
  public asNumber() {
    this.addMutator(numberMutator);

    return this;
  }

  /**
   * Mutate the scalar value to be string
   */
  public asString() {
    this.addMutator(stringMutator);

    return this;
  }

  /**
   * Accepted value
   * The value will be valid if it equals 1 | "1" | true | "true" | "yes" | "y" | "on"
   */
  public accepted(errorMessage?: string) {
    this.addRule(acceptedRule, errorMessage);
    return this;
  }

  /**
   * Accepted value if another field's value equals to a specific value
   */
  public acceptedIf(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(acceptedIfRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    return this;
  }

  /**
   * Accepted value if another field's value is not equal to the given value
   */
  public acceptedUnless(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(acceptedUnlessRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    return this;
  }

  /**
   * Accepted value if another field is required
   */
  public acceptedIfRequired(field: string, errorMessage?: string) {
    const rule = this.addRule(acceptedIfRequiredRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /**
   * Accepted value if another field is present
   */
  public acceptedIfPresent(field: string, errorMessage?: string) {
    const rule = this.addRule(acceptedIfPresentRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /**
   * Accepted value if another field is missing
   */
  public acceptedWithout(field: string, errorMessage?: string) {
    const rule = this.addRule(acceptedWithoutRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /**
   * Declined value
   * The value will be valid if it equals 0 | "0" | false | "false" | "no" | "n" | "off"
   */
  public declined(errorMessage?: string) {
    this.addRule(declinedRule, errorMessage);
    return this;
  }

  /**
   * Declined value if another field's value equals to a specific value
   */
  public declinedIf(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(declinedIfRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    return this;
  }

  /**
   * Declined value if another field's value is not equal to the given value
   */
  public declinedUnless(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(declinedUnlessRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    return this;
  }

  /**
   * Declined value if another field is required
   */
  public declinedIfRequired(field: string, errorMessage?: string) {
    const rule = this.addRule(declinedIfRequiredRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /**
   * Declined value if another field is present
   */
  public declinedIfPresent(field: string, errorMessage?: string) {
    const rule = this.addRule(declinedIfPresentRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /**
   * Declined value if another field is missing
   */
  public declinedWithout(field: string, errorMessage?: string) {
    const rule = this.addRule(declinedWithoutRule, errorMessage);
    rule.context.options.field = field;
    return this;
  }

  /** Value must be one of the given values */
  public enum(values: any, errorMessage?: string) {
    const rule = this.addRule(enumRule, errorMessage);
    rule.context.options.enum = Object.values(values);
    return this;
  }

  /** Value must be one of the given values */
  public in(values: any[], errorMessage?: string) {
    const rule = this.addRule(inRule, errorMessage);
    rule.context.options.values = values;
    return this;
  }

  /** @alias in */
  public oneOf(values: any[], errorMessage?: string) {
    return this.in(values, errorMessage);
  }

  /** Add rule to check if the value is one of the allowed values */
  public allowsOnly(values: any[], errorMessage?: string) {
    const rule = this.addRule(allowedValuesRule, errorMessage);
    rule.context.options.allowedValues = values;
    return this;
  }

  /** Forbid the value from being one of the given values */
  public forbids(values: any[], errorMessage?: string) {
    const rule = this.addRule(notAllowedValuesRule, errorMessage);
    rule.context.options.notAllowedValues = values;
    return this;
  }

  /** @alias forbids */
  public notIn(values: any[], errorMessage?: string) {
    return this.forbids(values, errorMessage);
  }
}
