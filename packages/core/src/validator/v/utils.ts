import type { ContextualSchemaRule, RuleResult, SchemaContext } from "./types";

export const VALID_RULE: RuleResult = {
  isValid: true,
};

export const invalidRule = (
  rule: ContextualSchemaRule,
  context: SchemaContext,
): RuleResult => {
  const attributes = { ...rule.context.options, ...context.allValues };

  attributes.input = context.key;
  attributes.path = context.path;

  const error =
    rule.context.errorMessage ||
    rule.errorMessage ||
    context.translator(rule.name, attributes)!;

  return {
    isValid: false,
    error,
    input: context.key,
    path: context.path,
  };
};

export const setKeyPath = (path: string, key: string) => {
  if (!path) return key;

  return `${path}.${key}`;
};
