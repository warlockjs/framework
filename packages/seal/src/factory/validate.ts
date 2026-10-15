import { getSealConfig } from "../config";
import type { SchemaContext, TypedValidationResult, ValidatedOutput } from "../types";
import type { BaseValidator } from "../validators";
import type { ValidateOptions } from "./validators";

/**
 * Validate data against a schema.
 *
 * The result narrows on `isValid`: on success `data` is the schema's
 * `Infer.Output`, on failure it is `undefined`.
 */
export const validate = async <T extends BaseValidator>(
  schema: T,
  data: unknown,
  { context: extendedContext, ...configurations }: ValidateOptions = getSealConfig() || {},
): Promise<TypedValidationResult<ValidatedOutput<T>>> => {
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
    return { isValid: false, errors: result.errors, data: undefined };
  }

  return { isValid: true, errors: result.errors, data: result.data };
};
