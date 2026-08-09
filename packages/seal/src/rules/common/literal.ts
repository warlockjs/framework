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
  // Runs even on "empty" values. A literal set is an exact-match whitelist, so
  // there is no value it cannot safely be asked about — and `""` is one of the
  // values callers most want to pin (`alt=""` for a decorative image). Left at
  // the default, the empty string would skip this check entirely, which made
  // `v.literal("").optional()` accept `""`, `null` AND a missing key alike.
  requiresValue: false,
  defaultErrorMessage: "The :input must be one of the following values: :values",
  async validate(value: any, context) {
    // Absence is the required/present rule's question, not this one. Without
    // this, `requiresValue: false` above would make the literal check fire on a
    // missing key and defeat `.optional()`, which works by removing that rule.
    if (value === undefined) {
      return VALID_RULE;
    }

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
