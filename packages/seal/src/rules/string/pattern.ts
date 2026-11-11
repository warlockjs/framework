import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Pattern rule - validates against regex pattern
 */
export const patternRule: SchemaRule<{ pattern: RegExp }> = {
  name: "pattern",
  defaultErrorMessage: "The :input does not match the required pattern",
  async validate(value: any, context) {
    const pattern = this.context.options.pattern;

    // A global or sticky regex resumes from `lastIndex`, so the same value
    // would pass and fail on alternate calls. Every check starts from 0 and
    // leaves the regex as it found it.
    pattern.lastIndex = 0;
    const matches = pattern.test(value);
    pattern.lastIndex = 0;

    if (matches) {
      return VALID_RULE;
    }

    this.context.translationParams.pattern = this.context.options.pattern.toString();
    return invalidRule(this, context);
  },
};
