import { except } from "@mongez/reinforcements";
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

  /**
   * Check if value is an object type (plain object, not array or date)
   */
  public matchesType(value: any): boolean {
    return isPlainObject(value);
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

  /** Whether to allow unknown properties
   * Please note it will allow only unknown direct children keys, not nested children keys
   */
  public allowUnknown(allow = true) {
    this.shouldAllowUnknown = allow;
    return this;
  }

  /**
   * Create a copy of this object validator with the same configuration
   * Copies schema, rules, mutators, transformers, and object-specific settings
   *
   * @returns A new ObjectValidator instance with copied configuration
   *
   * @example
   * ```ts
   * const baseUser = v.object({ name: v.string() }).allowUnknown();
   * const userCopy = baseUser.clone();
   * // userCopy has the same schema and allowUnknown setting
   * ```
   */
  public override clone(): this {
    // Get cloned instance with all BaseValidator properties
    const cloned = super.clone();

    // Clone schema with deep copy of validators
    const newSchema: Schema = {};
    for (const key in this.schema) {
      newSchema[key] = this.schema[key].clone();
    }
    cloned.schema = newSchema;

    // Add ObjectValidator-specific properties
    cloned.shouldAllowUnknown = this.shouldAllowUnknown;
    cloned.allowedKeys = [...this.allowedKeys];

    return cloned;
  }

  /**
   * Extend this schema with additional fields
   * Clones the current validator and adds new fields to the schema
   * **Keeps original configuration** (allowUnknown, stripUnknown, etc.)
   *
   * If an ObjectValidator is provided, only its schema is used - its configuration is ignored.
   * This is useful for creating reusable field collections that can be added to different schemas.
   *
   * @param schemaOrValidator - Plain schema object or ObjectValidator to extend with
   * @returns A new ObjectValidator with merged schema and original configuration
   *
   * @example
   * ```ts
   * // Extend with plain schema
   * const baseUser = v.object({
   *   name: v.string().required(),
   *   email: v.string().email().required()
   * }).allowUnknown();
   *
   * const adminUser = baseUser.extend({
   *   role: v.string().in(['admin', 'superadmin']).required()
   * });
   * // adminUser has: name, email, role
   * // adminUser keeps: allowUnknown() from base ✅
   *
   * // Extend with ObjectValidator (only schema is used)
   * const auditFields = v.object({
   *   createdAt: v.date().required(),
   *   updatedAt: v.date().required()
   * }).stripUnknown(); // This config is ignored!
   *
   * const fullUser = baseUser.extend(auditFields);
   * // fullUser has: name, email, createdAt, updatedAt
   * // fullUser keeps: allowUnknown() from base (NOT stripUnknown from auditFields) ✅
   *
   * // Chain multiple extends
   * const complexSchema = baseUser
   *   .extend(auditFields)
   *   .extend({ metadata: v.object({}) });
   * ```
   */
  public extend(schemaOrValidator: Schema | ObjectValidator): this {
    // Clone current validator to preserve original
    const extended = this.clone();

    // Extract schema from parameter
    const schemaToAdd =
      schemaOrValidator instanceof ObjectValidator
        ? schemaOrValidator.schema
        : schemaOrValidator;

    // Merge schemas with cloned validators (later fields override earlier ones)
    for (const key in schemaToAdd) {
      extended.schema[key] = schemaToAdd[key].clone();
    }

    return extended;
  }

  /**
   * Merge with another ObjectValidator
   * Clones current validator, merges schemas, and **overrides configuration** with other validator's config
   *
   * Unlike extend(), merge() combines both schemas AND configurations.
   * The other validator's configuration (allowUnknown, stripUnknown, etc.) takes precedence.
   *
   * @param validator - Another ObjectValidator to merge with
   * @returns A new ObjectValidator with merged schema and configuration
   *
   * @example
   * ```ts
   * const baseUser = v.object({
   *   name: v.string().required()
   * }).allowUnknown();
   *
   * const timestamps = v.object({
   *   createdAt: v.date().required(),
   *   updatedAt: v.date().required()
   * }).stripUnknown();
   *
   * const merged = baseUser.merge(timestamps);
   * // merged has: name, createdAt, updatedAt
   * // merged config: stripUnknown() from timestamps (overrides allowUnknown) ✅
   *
   * // Chain multiple merges
   * const full = baseUser.merge(timestamps).merge(softDeleteSchema);
   * ```
   */
  public merge(validator: ObjectValidator): this {
    // Clone current validator
    const merged = this.clone();

    // Merge schemas with cloned validators (later fields override earlier ones)
    for (const key in validator.schema) {
      merged.schema[key] = validator.schema[key].clone();
    }

    // Override configuration with other validator's config
    merged.shouldAllowUnknown = validator.shouldAllowUnknown;
    merged.allowedKeys = [...merged.allowedKeys, ...validator.allowedKeys];

    // Append rules, mutators, transformers from other validator
    merged.rules.push(...validator.rules);
    merged.mutators.push(...validator.mutators);
    merged.dataTransformers.push(...validator.dataTransformers);

    // Merge attributes text (later wins)
    merged.attributesText = {
      ...merged.attributesText,
      ...validator.attributesText,
    };

    return merged;
  }

  /**
   * Create a new schema with only the specified fields
   * Clones the current validator and keeps only the selected fields
   * **Preserves all configuration** (allowUnknown, stripUnknown, etc.)
   *
   * @param keys - Field names to keep in the schema
   * @returns A new ObjectValidator with only the picked fields
   *
   * @example
   * ```ts
   * const fullUser = v.object({
   *   id: v.int().required(),
   *   name: v.string().required(),
   *   email: v.string().email().required(),
   *   password: v.string().required(),
   *   role: v.string()
   * }).allowUnknown();
   *
   * // For login - only need email and password
   * const loginSchema = fullUser.pick('email', 'password');
   * // loginSchema has: { email, password }
   * // loginSchema keeps: allowUnknown() ✅
   *
   * // For public profile
   * const publicSchema = fullUser.pick('id', 'name', 'role');
   * // publicSchema has: { id, name, role }
   * ```
   */
  public pick(...keys: string[]): this {
    // Clone current validator
    const picked = this.clone();

    // Create new schema with only picked keys
    const newSchema: Schema = {};
    for (const key of keys) {
      if (key in picked.schema) {
        newSchema[key] = picked.schema[key];
      }
    }

    picked.schema = newSchema;

    return picked;
  }

  /**
   * Create a new schema excluding the specified fields
   * Clones the current validator and removes the specified fields
   * **Preserves all configuration** (allowUnknown, stripUnknown, etc.)
   *
   * @param keys - Field names to exclude from the schema
   * @returns A new ObjectValidator without the excluded fields
   *
   * @example
   * ```ts
   * const fullUser = v.object({
   *   id: v.int().required(),
   *   name: v.string().required(),
   *   email: v.string().email().required(),
   *   password: v.string().required(),
   *   role: v.string()
   * }).allowUnknown();
   *
   * // For updates - exclude id
   * const updateSchema = fullUser.without('id');
   * // updateSchema has: { name, email, password, role }
   * // updateSchema keeps: allowUnknown() ✅
   *
   * // For public API - exclude sensitive fields
   * const publicSchema = fullUser.without('password', 'role');
   * // publicSchema has: { id, name, email }
   *
   * // Combine with other methods
   * const patchSchema = fullUser.without('id', 'password');
   * // patchSchema has: { name, email, role }
   * ```
   */
  public without(...keys: string[]): this {
    // Clone current validator
    const filtered = this.clone();

    // Create new schema excluding specified keys
    const newSchema: Schema = {};
    for (const key in filtered.schema) {
      if (!keys.includes(key)) {
        newSchema[key] = filtered.schema[key];
      }
    }

    filtered.schema = newSchema;

    return filtered;
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

    const transformedData = await this.startTransformationPipeline(
      cleanedData,
      context,
    );

    const output =
      this.shouldAllowUnknown === false
        ? transformedData
        : {
            ...transformedData,
            ...except(mutatedData, Object.keys(this.schema)),
          };

    return {
      isValid: errors.length === 0,
      errors,
      data: output,
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
