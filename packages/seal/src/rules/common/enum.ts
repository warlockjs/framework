import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Enum rule - value must be one of the enum values
 */
export const enumRule: SchemaRule<{ enum: any }> = {
  name: "enum",
  defaultErrorMessage: "The :input must be one of the following values: :enum",
  async validate(value: any, context) {
    const enumObject = this.context.options.enum;
    const enumValues = Object.values(enumObject);

    if (enumValues.includes(value)) {
      return VALID_RULE;
    }

    this.context.options.enum = enumValues.join(", ");
    return invalidRule(this, context);
  },
};

/**
 * In rule - value must be in the given array
 */
export const inRule: SchemaRule<{ values: any[] }> = {
  name: "in",
  defaultErrorMessage:
    "The :input must be one of the following values: :values",
  async validate(value: any, context) {
    if (this.context.options.values.includes(value)) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Allowed values rule - value must be one of allowed values
 */
export const allowedValuesRule: SchemaRule<{ allowedValues: any[] }> = {
  name: "allowedValues",
  defaultErrorMessage: "The :input must be one of the allowed values",
  async validate(value: any, context) {
    if (this.context.options.allowedValues.includes(value)) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Not allowed values rule - value must not be in forbidden list
 */
export const notAllowedValuesRule: SchemaRule<{ notAllowedValues: any[] }> = {
  name: "notAllowedValues",
  defaultErrorMessage: "The :input contains a forbidden value",
  async validate(value: any, context) {
    if (!this.context.options.notAllowedValues.includes(value)) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};
