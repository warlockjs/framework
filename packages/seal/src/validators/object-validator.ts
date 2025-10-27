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
      const validator = this.schema[key];
      const value = mutatedData?.[key] ?? validator.getDefaultValue();

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
function removeUndefinedValues(
  obj: any,
  visited = new WeakMap<object, any>(),
): any {
  // Handle primitives and null
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item, visited));
  }

  // Skip non-plain objects (class instances, Dates, Buffers, etc.)
  if (!isPlainObject(obj)) {
    return obj;
  }

  // Handle circular references - return already processed result
  if (visited.has(obj)) {
    return visited.get(obj);
  }

  // Process plain objects
  const result: any = {};
  visited.set(obj, result); // Mark as processing BEFORE recursion

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = removeUndefinedValues(value, visited);
    }
  }

  return result;
}
