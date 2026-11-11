import { createRootContext } from "../helpers/root-context";
import { isPlainObject } from "@mongez/supportive-is";
import { setKeyPath } from "../helpers";
import { forbiddenKeyRule, isForbiddenKey, maxKeysRule, resolveSealLimit } from "../helpers/limits";
import { validateItems } from "../helpers/validate-items";
import { objectRule, plainObjectRule } from "../rules";
import type { SchemaContext, ValidationResult } from "../types";
import { BaseValidator } from "./base-validator";
import { applyNullable, getRuleOptions } from "../standard-schema/json-schema";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";

/**
 * Record validator class - validates objects with dynamic keys and consistent value types
 *
 * @example
 * ```ts
 * // Translations object
 * v.record(v.string())
 * // Valid: { en: "Hello", ar: "مرحبا", fr: "Bonjour" }
 *
 * // User preferences
 * v.record(v.union([v.string(), v.number(), v.boolean()]))
 * // Valid: { theme: "dark", fontSize: 16, notifications: true }
 * ```
 */
export class RecordValidator extends BaseValidator {
  public valueValidator: BaseValidator;
  public keyValidator?: BaseValidator;

  public constructor(valueValidator: BaseValidator, errorMessage?: string);
  public constructor(
    keyValidator: BaseValidator,
    valueValidator: BaseValidator,
    errorMessage?: string,
  );
  public constructor(first: BaseValidator, second?: BaseValidator | string, errorMessage?: string) {
    super();
    if (!(first instanceof BaseValidator)) {
      throw new TypeError(
        "v.record(): expected a value validator or a key validator followed by a value validator",
      );
    }
    if (second !== undefined && typeof second !== "string" && !(second instanceof BaseValidator)) {
      throw new TypeError(
        "v.record(): second argument must be a value validator or an error message",
      );
    }
    if (errorMessage !== undefined && typeof errorMessage !== "string") {
      throw new TypeError("v.record(): error message must be a string");
    }
    this.keyValidator = second instanceof BaseValidator ? first : undefined;
    this.valueValidator = second instanceof BaseValidator ? second : first;
    this.addMutableRule(
      this.keyValidator ? { ...plainObjectRule, name: "object" } : objectRule,
      typeof second === "string" ? second : errorMessage,
    );
  }

  /**
   * Validate it as plain object
   */
  public plainObject(errorMessage?: string) {
    return this.addRule(plainObjectRule, errorMessage);
  }

  /**
   * The record must not hold more than the given number of keys.
   *
   * Without it, the `maxRecordKeys` limit of `configureSeal()` applies
   * (10,000 by default). Pass `Infinity` to lift the cap for this schema.
   *
   * @example
   * ```ts
   * v.record(v.string()).maxKeys(50)
   * ```
   */
  public maxKeys(count: number, errorMessage?: string) {
    return this.addRule(maxKeysRule, errorMessage, { maxKeys: count });
  }

  /**
   * Check if value is a plain object type
   */
  public matchesType(value: any): boolean {
    return isPlainObject(value);
  }

  /**
   * Clone the validator
   */
  public override clone(): this {
    const cloned = super.clone();
    cloned.valueValidator = this.valueValidator.clone();
    cloned.keyValidator = this.keyValidator?.clone();
    return cloned;
  }

  /** @inheritdoc */
  protected override copyMutated(value: unknown): unknown {
    // Without mutators the rules have always shared the container's object.
    return this.mutators.length > 0 && isPlainObject(value) ? { ...(value as object) } : value;
  }

  /**
   * Validate record - iterate all keys and validate each value
   *
   * Absent input (and absent without `.default()`) propagates as `data: undefined`
   * so the parent ObjectValidator can omit the key. Without this, optional record
   * fields would silently materialise as `{}` in the validated output.
   */
  public async validate(
    data: any,
    context: SchemaContext = createRootContext(data),
  ): Promise<ValidationResult> {
    // Apply default when absent, then mutate. Mirrors BaseValidator's
    // `valueForRules = data ?? this.getDefaultValue()` so `.default({...})`
    // works on records too.
    const valueForRules = data ?? this.getDefaultValue();
    const mutatedData = await this.mutate(valueForRules, context);

    const result = await this.validateRules(data, context, {
      source: valueForRules,
      value: mutatedData,
    });

    if (result.isValid === false) return result;

    // Nothing to iterate for absent (no default) or null (nullable) inputs —
    // propagate so the parent ObjectValidator can omit the key.
    if (mutatedData === undefined || mutatedData === null) return result;

    // Defensive: type rule (objectRule) should have failed for non-objects.
    if (!isPlainObject(mutatedData)) return result;

    const keys = Object.keys(mutatedData);

    // Default key cap for schemas without their own `.maxKeys()`.
    if (!this.rules.some((rule) => rule.name === "maxKeys")) {
      const maxKeys = resolveSealLimit(context, "maxRecordKeys");

      if (keys.length > maxKeys) {
        const capErrors = await this.checkRule(maxKeysRule, mutatedData, context, { maxKeys });

        if (capErrors) return { isValid: false, errors: capErrors, data: undefined };
      }
    }

    // A `__proto__` key would replace the output's prototype when written back.
    if (keys.some(isForbiddenKey)) {
      const keyErrors = await this.checkRule(forbiddenKeyRule, mutatedData, context, {});

      if (keyErrors) return { isValid: false, errors: keyErrors, data: undefined };
    }

    // Values are validated in bounded batches; collection stops once the
    // `maxErrors` limit is reached.
    const errors = await validateItems(keys.length, context, async (index, report) => {
      const key = keys[index] as string;
      const childContext: SchemaContext = {
        ...context,
        parent: mutatedData,
        value: mutatedData[key],
        key,
        path: setKeyPath(context.path, key),
      };

      if (this.keyValidator) {
        // Keys are checked as supplied; transforms never rename properties.
        const keyResult = await this.keyValidator.validate(key, { ...childContext, value: key });
        if (!keyResult.isValid) report(keyResult.errors);
      }
      const childResult = await this.valueValidator.validate(mutatedData[key], childContext);

      // Update mutated data with validated result
      mutatedData[key] = childResult.data;

      // Collect errors from this value
      if (childResult.isValid === false) report(childResult.errors);
    });

    return this.refineResult(
      {
        isValid: errors.length === 0,
        errors,
        data: await this.startTransformationPipeline(mutatedData, context),
      },
      context,
    );
  }

  /**
   * @inheritdoc
   *
   * Generates `{ type: "object", additionalProperties: <valueSchema> }` —
   * the standard JSON Schema for a dictionary/map with homogeneous values.
   *
   * @example
   * ```ts
   * v.record(v.string()).toJsonSchema("draft-2020-12")
   * // → { type: "object", additionalProperties: { type: "string" } }
   *
   * v.record(v.union([v.string(), v.number()])).toJsonSchema("draft-2020-12")
   * // → { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] } }
   * ```
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    const schema: JsonSchemaResult = {
      type: "object",
      additionalProperties: this.valueValidator.toJsonSchema(target),
    };

    if (this.keyValidator) schema.propertyNames = this.keyValidator.toJsonSchema(target);

    const maxKeysOpts = getRuleOptions(this.rules, "maxKeys");
    if (typeof maxKeysOpts?.maxKeys === "number" && Number.isFinite(maxKeysOpts.maxKeys)) {
      schema.maxProperties = maxKeysOpts.maxKeys;
    }

    if (this.isNullable) applyNullable(schema, target);

    return schema;
  }
}
