import { invalidRule, VALID_RULE } from "../../helpers";
import type { Schema, SchemaRule } from "../../types";

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
    const allowedKeys = [...Object.keys(schema), ...(this.context.options.allowedKeys || [])];

    const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));

    if (unknownKeys.length > 0) {
      (this.context.options as any).unknownKeys = unknownKeys.join(", ");
      console.log("Options", this.context.options);

      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};
