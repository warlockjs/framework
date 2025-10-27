import { isEmpty } from "@mongez/supportive-is";
import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Forbidden rule - value must not be present
 */
export const forbiddenRule: SchemaRule = {
  name: "forbidden",
  defaultErrorMessage: "The :input is forbidden",
  async validate(value: any, context) {
    if (!isEmpty(value)) {
      return invalidRule(this, context);
    }
    return VALID_RULE;
  },
};
