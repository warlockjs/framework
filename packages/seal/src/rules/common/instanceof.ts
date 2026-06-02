import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

/**
 * InstanceOf rule - value must be an instance of the given constructor.
 *
 * Uses the `instanceof` operator at runtime. Useful for class instances
 * not representable in JSON Schema (File, Buffer, custom domain classes).
 */
export const instanceofRule: SchemaRule<{ ctor: new (...args: any[]) => any; name: string }> = {
  name: "instanceof",
  defaultErrorMessage: "The :input must be an instance of :name",
  async validate(value: any, context) {
    if (value instanceof this.context.options.ctor) {
      return VALID_RULE;
    }

    this.context.translationParams.name = this.context.options.name;

    return invalidRule(this, context);
  },
};
