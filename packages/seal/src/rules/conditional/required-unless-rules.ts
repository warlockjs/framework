import { isEmpty } from "@mongez/supportive-is";
import { getFieldValue, invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Required unless rule - field is required unless another field equals a specific value
 * Supports both global and sibling scope
 */
export const requiredUnlessRule: SchemaRule<{
  field: string;
  value: any;
  scope?: "global" | "sibling";
}> = {
  name: "requiredUnless",
  description:
    "The field is required unless another field equals a specific value",
  sortOrder: -2,
  requiresValue: false,
  defaultErrorMessage: "The :input is required",
  async validate(value: any, context) {
    const { value: expectedValue } = this.context.options;
    const fieldValue = getFieldValue(this, context);

    // Field is required unless the other field equals the expected value
    if (isEmpty(value) && fieldValue !== expectedValue) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};
