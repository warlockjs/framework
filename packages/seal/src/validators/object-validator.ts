import { isPlainObject } from "@mongez/supportive-is";
import { setKeyPath } from "../helpers";
import { objectTrimMutator, stripUnknownMutator } from "../mutators";
import { objectRule, unknownKeyRule } from "../rules";
import type { Schema, SchemaContext, ValidationResult } from "../types";
import { BaseValidator } from "./base-validator";

/**
 * Object validator class
 */
export class ObjectValidator extends BaseValidator {
  protected shouldAllowUnknown = false;
  protected allowedKeys: string[] = [];

  public constructor(
    public schema: Schema,
    errorMessage?: string,
  ) {
    super();
    this.addRule(objectRule, errorMessage);
  }

  /** Strip unknown keys from the data */
  public stripUnknown() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const validator = this;
    this.addMutator(stripUnknownMutator, {
      get allowedKeys() {
        return validator.allowedKeys;
      },
    });
    return this;
  }

  /** Add list of allowed keys that could be in the data but not necessarily validated */
  public allow(...keys: string[]) {
    this.allowedKeys.push(...keys);
    return this;
  }

  /** Trim values of the object properties */
  public trim(recursive = true) {
    this.addMutator(objectTrimMutator, { recursive });
    return this;
  }

  /** Whether to allow unknown properties */
  public allowUnknown(allow = true) {
    this.shouldAllowUnknown = allow;
    return this;
  }

  /** Mutate the data */
  public mutate(data: any, context: SchemaContext) {
    if (!isPlainObject(data)) return data;
    return super.mutate({ ...data }, context);
  }

  /** Validate the data */
  public async validate(
    data: any,
    context: SchemaContext,
  ): Promise<ValidationResult> {
    context.schema = this.schema;
    const mutatedData = await this.mutate(data, context);

    // Check for unknown properties
    if (this.shouldAllowUnknown === false) {
      const rule = this.addRule(unknownKeyRule);
      rule.context.options.allowedKeys = this.allowedKeys;
      rule.context.options.schema = this.schema;
      this.setRuleAttributesList(rule);
    }

    const result = await super.validate(mutatedData, context);
    if (result.isValid === false) return result;
    if (data === undefined) return result;

    // Validate object properties
    const errors: ValidationResult["errors"] = [];
    const finalData: any = {};

    const validationPromises = Object.keys(this.schema).map(async key => {
      const value = mutatedData?.[key];
      const validator = this.schema[key];

      if (key in data || validator.getDefaultValue() !== undefined) {
        const childContext: SchemaContext = {
          ...context,
          parent: mutatedData,
          value,
          key,
          path: setKeyPath(context.path, key),
        };

        const childResult = await validator.validate(value, childContext);

        // Only include in final data if not omitted
        if (childResult.data !== undefined && !validator.isOmitted()) {
          finalData[key] = childResult.data;
        }

        if (childResult.isValid === false) {
          errors.push(...childResult.errors);
        }
      }
    });

    await Promise.all(validationPromises);

    // Remove undefined values
    const cleanedData = removeUndefinedValues(finalData);

    return {
      isValid: errors.length === 0,
      errors,
      data: await this.startTransformationPipeline(cleanedData, context),
    };
  }
}

/** Recursively remove undefined values from an object */
function removeUndefinedValues(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item));
  }

  if (obj !== null && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = removeUndefinedValues(value);
      }
    }
    return result;
  }

  return obj;
}
