import { getSealConfig } from "../config";
import type { SchemaContext, ValidationResult } from "../types";
import type { BaseValidator } from "../validators";
import { type ValidateOptions } from "./validators";

/**
 * Validate data against a schema
 */
export const validate = async <T extends BaseValidator>(
  schema: T,
  data: any, // Temporarily use any - will fix type inference
  { context: extendedContext, ...configurations }: ValidateOptions = getSealConfig() || {},
): Promise<ValidationResult> => {
  const context: SchemaContext = {
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
  };

  const result = await schema.validate(data, context);

  // A failed validation never hands back the input it just rejected.
  //
  // `object` used to return the raw input on failure while `discriminatedUnion`
  // returned `undefined` — the same call shape with two different contracts.
  // The object behaviour was the dangerous one: validating an outbound DTO
  // specifically to keep internal fields out of a response, then doing the
  // natural `const { data } = await v.validate(dto, record); reply.send(data)`,
  // shipped every field the schema existed to exclude. A guard that returns the
  // unsafe value on failure reads as safe and isn't.
  if (!result.isValid) {
    return { ...result, data: undefined };
  }

  return result;
};
