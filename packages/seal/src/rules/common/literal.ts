import { invalidRule, resolveTranslation, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * Literal rule - value must be strictly equal to one of the literal values.
 *
 * Uses === (referential / strict equality), so distinguishes 1 from "1",
 * true from "true", etc. Mirrors `v.string().oneOf([...])` but at the
 * literal type level (TypeScript narrows to the union of literals).
 */
export const literalRule: SchemaRule<{ values: readonly (string | number | boolean)[] }> = {
  name: "literal",
  defaultErrorMessage: "The :input must be one of the following values: :values",
  async validate(value: any, context) {
    if (this.context.options.values.includes(value)) {
      return VALID_RULE;
    }

    this.context.translationParams.values = this.context.options.values
      .map(v =>
        resolveTranslation({ key: String(v), rawValue: String(v), rule: this, context }),
      )
      .join(", ");

    return invalidRule(this, context);
  },
};
