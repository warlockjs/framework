import { getSealConfig } from "../config";
import type { ValidateOptions } from "../factory/validators";
import type { SchemaContext } from "../types";

/**
 * Build the root `SchemaContext` for validating `data`.
 *
 * Used by the `validate()` factory and by a validator's own `validate(data)`
 * when it is called without a context, so both entry points see the same
 * `allValues`, `parent` and translators — which conditional rules
 * (`requiredIf`, `requiredWith`, …) depend on.
 */
export const createRootContext = (
  data: unknown,
  { context: extendedContext, ...configurations }: ValidateOptions = getSealConfig() || {},
): SchemaContext => ({
  allValues: data,
  parent: null,
  value: data,
  key: "",
  path: "",
  context: extendedContext,
  rootContext: extendedContext,
  translateRule(ruleTranslation) {
    return configurations.translateRule?.(ruleTranslation) ?? "";
  },
  translateAttribute(attributeTranslation) {
    return configurations.translateAttribute?.(attributeTranslation) ?? "";
  },
  configurations,
});
