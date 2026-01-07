import { humanizeSize, invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Max file size rule
 */
export const maxFileSizeRule: SchemaRule<{ maxSize: number }> = {
  name: "maxFileSize",
  defaultErrorMessage: "The :input must not exceed :maxSize",
  async validate(value: any, context) {
    const size = typeof value.size === "function" ? await value.size() : value.size;

    if (size <= this.context.options.maxSize) {
      return VALID_RULE;
    }

    const ruleContext = {
      ...this.context,
      options: {
        ...this.context.options,
        maxSize: humanizeSize(this.context.options.maxSize) as unknown as number,
      },
    };

    return invalidRule(
      {
        ...this,
        context: ruleContext,
      },
      context,
    );
  },
};

/**
 * Min file size rule
 */
export const minFileSizeRule: SchemaRule<{ minSize: number }> = {
  name: "minFileSize",
  defaultErrorMessage: "The :input must be at least :minSize",
  async validate(value: any, context) {
    const size = typeof value.size === "function" ? await value.size() : value.size;

    if (size >= this.context.options.minSize) {
      return VALID_RULE;
    }

    const ruleContext = {
      ...this.context,
      options: {
        ...this.context.options,
        minSize: humanizeSize(this.context.options.minSize) as unknown as number,
      },
    };

    return invalidRule(
      {
        ...this,
        context: ruleContext,
      },
      context,
    );
  },
};
