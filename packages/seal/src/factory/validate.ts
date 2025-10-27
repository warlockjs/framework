import { getSealConfig, type SealConfig } from "../config";
import type { SchemaContext, ValidationResult } from "../types";
import type { BaseValidator } from "../validators";

/**
 * Validate data against a schema
 */
export const validate = async <T extends BaseValidator>(
  schema: T,
  data: any, // Temporarily use any - will fix type inference
  configurations: SealConfig = getSealConfig(),
): Promise<ValidationResult> => {
  const context: SchemaContext = {
    allValues: data,
    parent: null,
    value: data,
    key: "",
    path: "",
    translateRule(ruleTranslation) {
      return configurations.translateRule?.(ruleTranslation) ?? "";
    },
    translateAttribute(attributeTranslation) {
      return configurations.translateAttribute?.(attributeTranslation) ?? "";
    },
    configurations,
  };

  return await schema.validate(data, context);
};
