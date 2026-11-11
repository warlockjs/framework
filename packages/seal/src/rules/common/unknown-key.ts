import { invalidRule, VALID_RULE } from "../../helpers";
import type { Schema, SchemaRule } from "../../types";

/** How many unknown keys the error message lists before summarising the rest */
const MAX_LISTED_UNKNOWN_KEYS = 10;

/**
 * Unknown key rule - validates that object doesn't have unknown keys
 */
export const unknownKeyRule: SchemaRule<{
  schema: Schema;
  allowedKeys: string[];
}> = {
  name: "unknownKeys",
  defaultErrorMessage: "The :input contains unknown keys: :unknownKeys",
  async validate(value: any, context) {
    const schema = this.context.options.schema;
    const allowedKeys = new Set([
      ...Object.keys(schema),
      ...(this.context.options.allowedKeys || []),
    ]);

    const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));

    if (unknownKeys.length > 0) {
      // The message names a bounded number of keys, however many were sent.
      const listed = unknownKeys.slice(0, MAX_LISTED_UNKNOWN_KEYS).join(", ");
      const hidden = unknownKeys.length - MAX_LISTED_UNKNOWN_KEYS;

      this.context.translationParams.unknownKeys =
        hidden > 0 ? `${listed} and ${hidden} more` : listed;

      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};
