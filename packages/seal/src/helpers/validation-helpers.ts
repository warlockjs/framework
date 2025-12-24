import { getSealConfig } from "../config";
import type { ContextualSchemaRule, RuleResult, SchemaContext } from "../types";

export const VALID_RULE: RuleResult = {
  isValid: true,
};

export const invalidRule = (rule: ContextualSchemaRule, context: SchemaContext): RuleResult => {
  const attributes = { ...rule.context.options, ...context.allValues };

  attributes.input = context.path || context.key || "data";
  attributes.path = context.path;
  attributes.key = context.key;
  attributes.value = context.value;

  const translator = getSealConfig().translateAttribute;

  if (translator) {
    for (const key in attributes) {
      // Special handling for the input attribute
      if (key === "input") {
        const translation =
          rule.context.attributesList?.input ||
          translator({
            attribute: rule.context.translatedAttributes.input || "input",
            context,
            rule,
          });

        if (translation !== "input") {
          attributes.input = translation;
          continue;
        }
      }

      const value = attributes[key];
      attributes[key] =
        rule.context.attributesList?.[value] ||
        rule.context.attributesList?.[key] ||
        translator?.({
          attribute: rule.context.translatedAttributes[key] || value,
          context,
          rule,
        }) ||
        value;
    }
  }

  const error =
    rule.context.errorMessage ||
    rule.errorMessage ||
    context.translateRule?.({ rule, context, attributes }) ||
    rule.defaultErrorMessage!;

  return {
    isValid: false,
    error,
    input: context.key,
    path: context.path,
  };
};
