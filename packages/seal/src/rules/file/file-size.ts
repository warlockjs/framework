import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Max file size rule
 */
export const maxFileSizeRule: SchemaRule<{ maxFileSize: number }> = {
  name: "maxFileSize",
  defaultErrorMessage: "The :input must not exceed :maxFileSize",
  async validate(value: any, context) {
    if (value.size <= this.context.options.maxFileSize) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};

/**
 * Min file size rule
 */
export const minFileSizeRule: SchemaRule<{ minFileSize: number }> = {
  name: "minFileSize",
  defaultErrorMessage: "The :input must be at least :minFileSize",
  async validate(value: any, context) {
    if (value.size >= this.context.options.minFileSize) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};
