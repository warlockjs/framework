import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Min rule - value must be equal or greater than minimum
 */
export const minRule: SchemaRule<{ min: number }> = {
  name: "min",
  defaultErrorMessage: "The :input must be at least :min",
  async validate(value: any, context) {
    if (value >= this.context.options.min) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Max rule - value must be equal or less than maximum
 */
export const maxRule: SchemaRule<{ max: number }> = {
  name: "max",
  defaultErrorMessage: "The :input must equal to or less than :max",
  async validate(value: any, context) {
    if (value <= this.context.options.max) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Positive rule - value must be greater than 0
 */
export const positiveRule: SchemaRule = {
  name: "positive",
  defaultErrorMessage: "The :input must be a positive number",
  async validate(value: any, context) {
    if (value > 0) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Negative rule - value must be less than 0
 */
export const negativeRule: SchemaRule = {
  name: "negative",
  defaultErrorMessage: "The :input must be a negative number",
  async validate(value: any, context) {
    if (value < 0) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Odd rule - value must be an odd number
 */
export const oddRule: SchemaRule = {
  name: "odd",
  defaultErrorMessage: "The :input must be an odd number",
  async validate(value: any, context) {
    if (value % 2 !== 0) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Even rule - value must be an even number
 */
export const evenRule: SchemaRule = {
  name: "even",
  defaultErrorMessage: "The :input must be an even number",
  async validate(value: any, context) {
    if (value % 2 === 0) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Modulo rule - value must be divisible by given number
 */
export const moduloRule: SchemaRule<{ value: number }> = {
  name: "modulo",
  defaultErrorMessage: "The :input must be divisible by :value",
  async validate(value: any, context) {
    if (value % this.context.options.value === 0) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Between rule - value must be between the given two numbers (Inclusive)
 */
export const betweenNumbersRule: SchemaRule<{ min: number; max: number }> = {
  name: "betweenNumbers",
  defaultErrorMessage: "The :input must be between :min and :max",
  async validate(value: any, context) {
    if (
      value >= this.context.options.min &&
      value <= this.context.options.max
    ) {
      (this.context.options as any).betweenNumbers =
        `${this.context.options.min} and ${this.context.options.max}`;
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};
