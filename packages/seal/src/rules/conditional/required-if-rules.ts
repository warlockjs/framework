import { isEmpty } from "@mongez/supportive-is";
import { getFieldValue, invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Required if rule - field is required if another field equals a specific value
 * Supports both global and sibling scope
 */
export const requiredIfRule: SchemaRule<{
  field: string;
  value: any;
  scope?: "global" | "sibling";
}> = {
  name: "requiredIf",
  description: "The field is required if another field equals a specific value",
  sortOrder: -2,
  requiresValue: false,
  defaultErrorMessage: "The :input is required",
  async validate(value: any, context) {
    const { value: expectedValue } = this.context.options;
    const fieldValue = getFieldValue(this, context);

    // Field is required if the other field equals the expected value
    if (isEmpty(value) && fieldValue === expectedValue) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

/**
 * Required if empty rule - field is required if another field is empty
 * Supports both global and sibling scope
 */
export const requiredIfEmptyRule: SchemaRule<{
  field: string;
  scope?: "global" | "sibling";
}> = {
  name: "requiredIfEmpty",
  description: "The field is required if another field is empty",
  sortOrder: -2,
  requiresValue: false,
  defaultErrorMessage: "The :input is required",
  async validate(value: any, context) {
    const fieldValue = getFieldValue(this, context);

    // Field is required if the other field is empty
    if (isEmpty(value) && isEmpty(fieldValue)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

/**
 * Required if not empty rule - field is required if another field is not empty
 * Supports both global and sibling scope
 */
export const requiredIfNotEmptyRule: SchemaRule<{
  field: string;
  scope?: "global" | "sibling";
}> = {
  name: "requiredIfNotEmpty",
  description: "The field is required if another field is not empty",
  sortOrder: -2,
  requiresValue: false,
  defaultErrorMessage: "The :input is required",
  async validate(value: any, context) {
    const fieldValue = getFieldValue(this, context);

    // Field is required if the other field is not empty
    if (isEmpty(value) && !isEmpty(fieldValue)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

/**
 * Required if in rule - field is required if another field's value is in the given array
 * Supports both global and sibling scope
 */
export const requiredIfInRule: SchemaRule<{
  field: string;
  values: any[];
  scope?: "global" | "sibling";
}> = {
  name: "requiredIfIn",
  description:
    "The field is required if another field's value is in the given array",
  sortOrder: -2,
  requiresValue: false,
  defaultErrorMessage: "The :input is required",
  async validate(value: any, context) {
    const { values } = this.context.options;
    const fieldValue = getFieldValue(this, context);

    // Field is required if the other field's value is in the array
    if (isEmpty(value) && values.includes(fieldValue)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

/**
 * Required if not in rule - field is required if another field's value is NOT in the given array
 * Supports both global and sibling scope
 */
export const requiredIfNotInRule: SchemaRule<{
  field: string;
  values: any[];
  scope?: "global" | "sibling";
}> = {
  name: "requiredIfNotIn",
  description:
    "The field is required if another field's value is NOT in the given array",
  sortOrder: -2,
  requiresValue: false,
  defaultErrorMessage: "The :input is required",
  async validate(value: any, context) {
    const { values } = this.context.options;
    const fieldValue = getFieldValue(this, context);

    // Field is required if the other field's value is NOT in the array
    if (isEmpty(value) && !values.includes(fieldValue)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};
