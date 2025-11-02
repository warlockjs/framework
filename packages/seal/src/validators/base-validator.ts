import { clone } from "@mongez/reinforcements";
import { isEmpty } from "@mongez/supportive-is";
import { VALID_RULE, invalidRule } from "../helpers";
import {
  equalRule,
  equalsFieldRule,
  forbiddenRule,
  notEqualsFieldRule,
  presentIfEmptyRule,
  presentIfInRule,
  presentIfNotEmptyRule,
  presentIfNotInRule,
  presentIfRule,
  presentRule,
  presentUnlessRule,
  presentWithAllRule,
  presentWithAnyRule,
  presentWithRule,
  presentWithoutAllRule,
  presentWithoutAnyRule,
  presentWithoutRule,
  requiredIfEmptyRule,
  requiredIfInRule,
  requiredIfNotEmptyRule,
  requiredIfNotInRule,
  requiredIfRule,
  requiredRule,
  requiredUnlessRule,
  requiredWithAllRule,
  requiredWithAnyRule,
  requiredWithRule,
  requiredWithoutAllRule,
  requiredWithoutAnyRule,
  requiredWithoutRule,
  whenRule,
} from "../rules";
import type {
  ContextualSchemaRule,
  ContextualizedMutator,
  ContextualizedTransformer,
  Mutator,
  SchemaContext,
  SchemaRule,
  SchemaRuleOptions,
  SimpleTransformerCallback,
  TransformerCallback,
  ValidationAttributesList,
  ValidationResult,
  WhenRuleOptions,
} from "../types";

/**
 * Base validator class - foundation for all validators
 */
export class BaseValidator {
  public rules: ContextualSchemaRule[] = [];
  public mutators: ContextualizedMutator[] = [];
  protected defaultValue: any;
  protected description?: string;
  protected shouldOmit = false;
  /**
   * Pipeline to transform the mutated/original data before returning it
   */
  protected dataTransformers: ContextualizedTransformer[] = [];

  /**
   * Attributes text to be replaced on translations
   * If the value is an object, it will be used as the attributes list for the rule
   * If the value is a string, it will be used as the attributes list for the rule
   */
  protected attributesText: ValidationAttributesList = {};

  /**
   * Get the default value
   */
  public getDefaultValue(): any {
    return this.defaultValue;
  }

  /**
   * Add transformer with optional options
   *
   * @param transform - The transformer callback function
   * @param options - Optional options to pass to the transformer
   *
   * @example
   * ```ts
   * // Without options
   * v.date().addTransformer(data => data.toISOString())
   *
   * // With options
   * v.date().addTransformer(
   *   (data, { options }) => dayjs(data).format(options.format),
   *   { format: 'YYYY-MM-DD' }
   * )
   * ```
   */
  public addTransformer(transform: TransformerCallback, options: any = {}) {
    this.dataTransformers.push({
      transform,
      options,
    });
    return this;
  }

  /**
   * Transform the output value - simple one-time transformation
   *
   * @param callback - Simple callback receiving data and context
   *
   * @example
   * ```ts
   * // Simple transformation
   * v.string().outputAs(data => data.toUpperCase())
   *
   * // With context
   * v.string().outputAs((data, context) => {
   *   console.log(`Transforming ${context.path}`);
   *   return data.toLowerCase();
   * })
   * ```
   */
  public outputAs(callback: SimpleTransformerCallback) {
    this.addTransformer((data, { context }) => callback(data, context));
    return this;
  }

  /**
   * Transform output to JSON string
   *
   * Works with any validator type (string, number, date, object, array, etc.)
   *
   * @param indent - Optional indentation for pretty printing (default: 0 for compact)
   *
   * @example
   * ```ts
   * // Compact JSON
   * v.object({ name: v.string() }).toJSON()
   * // Output: '{"name":"John"}'
   *
   * // Pretty-printed JSON
   * v.array(v.object({...})).toJSON(2)
   * // Output:
   * // [
   * //   {
   * //     "name": "John"
   * //   }
   * // ]
   *
   * // Works with any type
   * v.string().toJSON()  // '"hello"'
   * v.number().toJSON()  // '42'
   * v.date().toJSON()    // '"2024-10-26T00:00:00.000Z"'
   * ```
   *
   * @category Transformer
   */
  public toJSON(indent?: number) {
    this.addTransformer(
      (data, { options }) => JSON.stringify(data, null, options.indent),
      { indent: indent ?? 0 },
    );
    return this;
  }

  /**
   * Start data transformation pipeline
   * Context is passed at runtime, not stored
   */
  public async startTransformationPipeline(data: any, context: SchemaContext) {
    for (const transformer of this.dataTransformers) {
      data = await transformer.transform(data, {
        options: transformer.options,
        context,
      });
    }

    return data;
  }

  /**
   * Set attributes text to be replaced on translations
   * If the value is an object, it will be used as the attributes list for the rule
   * If the value is a string, it will be used as the attributes list for the rule
   *
   * @example
   * v.string().attributes({
   *   name: "Name",
   *   email: "Email",
   * });
   * // Example 2: Add custom attributes for matches
   * v.string().matches("confirmPassword").attributes({
   *   matches: {
   *     confirmPassword: "Confirm Password",
   *   },
   * });
   */
  public attributes(
    attributes: Record<string, string | Record<string, string>>,
  ) {
    this.attributesText = attributes;
    return this;
  }

  /**
   * Add description to the validator
   */
  public describe(description: string) {
    this.description = description;
    return this;
  }

  /**
   * @deprecated This method is no longer needed and does nothing.
   * Empty values are now automatically skipped for validation rules by default.
   * Only presence validators (required, present, etc.) will check empty values.
   * You can safely remove this call from your code.
   */
  public ignoreEmptyValue(_ignoreEmptyValue = true) {
    // No-op for backward compatibility
    return this;
  }

  /**
   * Omit this field from the validated data output
   *
   * Field will still be validated but not included in the final result.
   * Useful for confirmation fields, captcha, terms acceptance, etc.
   *
   * @example
   * ```ts
   * v.object({
   *   password: v.string().required(),
   *   confirmPassword: v.string().required().sameAs("password").omit(),
   *   acceptTerms: v.boolean().required().omit(),
   * });
   * // Output: { password: "..." }
   * // confirmPassword and acceptTerms validated but omitted
   * ```
   */
  public omit() {
    this.shouldOmit = true;
    return this;
  }

  /**
   * @alias omit
   */
  public exclude() {
    return this.omit();
  }

  /**
   * Check if this field should be omitted from the output
   */
  public isOmitted(): boolean {
    return this.shouldOmit;
  }

  /**
   * Value must be equal to the given value
   */
  public equal(value: any, errorMessage?: string) {
    const rule = this.addRule(equalRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /**
   * Value must be the same as another field's value
   */
  public sameAs(field: string, errorMessage?: string) {
    const rule = this.addRule(equalsFieldRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value must be the same as another sibling field's value
   */
  public sameAsSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(equalsFieldRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value must be different from another field's value
   */
  public differentFrom(field: string, errorMessage?: string) {
    const rule = this.addRule(notEqualsFieldRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value must be different from another sibling field's value
   */
  public differentFromSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(notEqualsFieldRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Add rule to the validator
   */
  public addRule<T extends SchemaRuleOptions = SchemaRuleOptions>(
    rule: SchemaRule<T>,
    errorMessage?: string,
  ): ContextualSchemaRule<T> {
    const newRule: ContextualSchemaRule<T> = {
      ...(clone(rule) as ContextualSchemaRule<T>),
      context: {
        errorMessage,
        options: {} as T,
        attributesList: {},
      },
    };

    if (errorMessage) {
      newRule.errorMessage = errorMessage;
    }

    if (rule.sortOrder === undefined) {
      newRule.sortOrder = this.rules.length + 1;
    }

    this.rules.push(newRule);
    return newRule;
  }

  /**
   * Use a custom or pre-built validation rule
   *
   * @param rule - The validation rule to apply
   * @param options - Rule options including errorMessage and any rule-specific options
   *
   * @example
   * ```ts
   * import { hexColorRule } from "@warlock.js/seal-plugins/colors";
   *
   * v.string().useRule(hexColorRule, { errorMessage: "Invalid color" });
   * ```
   *
   * @example
   * ```ts
   * // With rule options
   * v.string().useRule(myCustomRule, {
   *   customOption: true,
   *   errorMessage: "Custom validation failed"
   * });
   * ```
   */
  public useRule<T extends SchemaRuleOptions = SchemaRuleOptions>(
    rule: SchemaRule<T>,
    options?: T & { errorMessage?: string },
  ) {
    const { errorMessage, ...ruleOptions } = options || ({} as any);
    const ruleInstance = this.addRule(rule, errorMessage);

    // Assign rule-specific options
    if (Object.keys(ruleOptions).length > 0) {
      Object.assign(ruleInstance.context.options, ruleOptions);
    }

    return this;
  }

  /**
   * Define custom rule
   */
  public refine(
    callback: (
      value: any,
      context: SchemaContext,
    ) => Promise<string | undefined> | string | undefined,
  ) {
    this.addRule({
      name: "custom",
      async validate(value, context) {
        const result = await callback(value, context);
        if (result) {
          this.context.errorMessage = result;
          return invalidRule(this, context);
        }
        return VALID_RULE;
      },
    });
    return this;
  }

  /**
   * Add mutator to the validator
   */
  public addMutator(mutator: Mutator, options: any = {}) {
    this.mutators.push({
      mutate: mutator,
      context: {
        options,
        ctx: {} as any,
      },
    });
    return this;
  }

  /**
   * Set default value for the field
   */
  public default(value: any) {
    this.defaultValue = value;
    return this;
  }

  // ==================== UNCONDITIONAL STATES ====================

  /**
   * This value must be present and has a value
   */
  public required(errorMessage?: string) {
    this.addRule(requiredRule, errorMessage);
    return this;
  }

  /**
   * Value must be present but not necessarily has a value
   */
  public present(errorMessage?: string) {
    this.addRule(presentRule, errorMessage);
    return this;
  }

  /**
   * Mark the field as optional, so pass it if it has no value or has a value
   * Because this is the default behavior, this method is just syntactic sugar
   */
  public optional() {
    return this;
  }

  // ==================== REQUIRED: BASED ON FIELD PRESENCE ====================

  /**
   * Value is required if another field exists
   */
  public requiredWith(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredWithRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field exists
   */
  public requiredWithSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredWithRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required if another field is missing
   */
  public requiredWithout(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredWithoutRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field is missing
   */
  public requiredWithoutSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredWithoutRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== REQUIRED: BASED ON FIELD VALUE ====================

  /**
   * Value is required if another field equals a specific value
   */
  public requiredIf(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(requiredIfRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field equals a specific value
   */
  public requiredIfSibling(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(requiredIfRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required unless another field equals a specific value
   */
  public requiredUnless(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(requiredUnlessRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required unless another sibling field equals a specific value
   */
  public requiredUnlessSibling(
    field: string,
    value: any,
    errorMessage?: string,
  ) {
    const rule = this.addRule(requiredUnlessRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== REQUIRED: BASED ON FIELD EMPTY STATE ====================

  /**
   * Value is required if another field is empty
   */
  public requiredIfEmpty(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredIfEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field is empty
   */
  public requiredIfEmptySibling(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredIfEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required if another field is not empty
   */
  public requiredIfNotEmpty(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredIfNotEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field is not empty
   */
  public requiredIfNotEmptySibling(field: string, errorMessage?: string) {
    const rule = this.addRule(requiredIfNotEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required if another field's value is in the given array
   */
  public requiredIfIn(field: string, values: any[], errorMessage?: string) {
    const rule = this.addRule(requiredIfInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field's value is in the given array
   */
  public requiredIfInSibling(
    field: string,
    values: any[],
    errorMessage?: string,
  ) {
    const rule = this.addRule(requiredIfInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required if another field's value is NOT in the given array
   */
  public requiredIfNotIn(field: string, values: any[], errorMessage?: string) {
    const rule = this.addRule(requiredIfNotInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if another sibling field's value is NOT in the given array
   */
  public requiredIfNotInSibling(
    field: string,
    values: any[],
    errorMessage?: string,
  ) {
    const rule = this.addRule(requiredIfNotInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== REQUIRED: BASED ON MULTIPLE FIELDS (ALL) ====================

  /**
   * Value is required if all specified fields exist
   */
  public requiredWithAll(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if all specified sibling fields exist
   */
  public requiredWithAllSiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required if all specified fields are missing
   */
  public requiredWithoutAll(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithoutAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if all specified sibling fields are missing
   */
  public requiredWithoutAllSiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithoutAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== REQUIRED: BASED ON MULTIPLE FIELDS (ANY) ====================

  /**
   * Value is required if any of the specified fields exists
   */
  public requiredWithAny(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if any of the specified sibling fields exists
   */
  public requiredWithAnySiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Value is required if any of the specified fields is missing
   */
  public requiredWithoutAny(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithoutAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Value is required if any of the specified sibling fields is missing
   */
  public requiredWithoutAnySiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(requiredWithoutAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== PRESENT: BASED ON FIELD PRESENCE ====================

  /**
   * Field must be present if another field exists
   */
  public presentWith(field: string, errorMessage?: string) {
    const rule = this.addRule(presentWithRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field exists
   */
  public presentWithSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(presentWithRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present if another field is missing
   */
  public presentWithout(field: string, errorMessage?: string) {
    const rule = this.addRule(presentWithoutRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field is missing
   */
  public presentWithoutSibling(field: string, errorMessage?: string) {
    const rule = this.addRule(presentWithoutRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== PRESENT: BASED ON FIELD VALUE ====================

  /**
   * Field must be present if another field equals a specific value
   */
  public presentIf(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(presentIfRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field equals a specific value
   */
  public presentIfSibling(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(presentIfRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present unless another field equals a specific value
   */
  public presentUnless(field: string, value: any, errorMessage?: string) {
    const rule = this.addRule(presentUnlessRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present unless another sibling field equals a specific value
   */
  public presentUnlessSibling(
    field: string,
    value: any,
    errorMessage?: string,
  ) {
    const rule = this.addRule(presentUnlessRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.value = value;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== PRESENT: BASED ON FIELD EMPTY STATE ====================

  /**
   * Field must be present if another field is empty
   */
  public presentIfEmpty(field: string, errorMessage?: string) {
    const rule = this.addRule(presentIfEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field is empty
   */
  public presentIfEmptySibling(field: string, errorMessage?: string) {
    const rule = this.addRule(presentIfEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present if another field is not empty
   */
  public presentIfNotEmpty(field: string, errorMessage?: string) {
    const rule = this.addRule(presentIfNotEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field is not empty
   */
  public presentIfNotEmptySibling(field: string, errorMessage?: string) {
    const rule = this.addRule(presentIfNotEmptyRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present if another field's value is in the given array
   */
  public presentIfIn(field: string, values: any[], errorMessage?: string) {
    const rule = this.addRule(presentIfInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field's value is in the given array
   */
  public presentIfInSibling(
    field: string,
    values: any[],
    errorMessage?: string,
  ) {
    const rule = this.addRule(presentIfInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present if another field's value is NOT in the given array
   */
  public presentIfNotIn(field: string, values: any[], errorMessage?: string) {
    const rule = this.addRule(presentIfNotInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if another sibling field's value is NOT in the given array
   */
  public presentIfNotInSibling(
    field: string,
    values: any[],
    errorMessage?: string,
  ) {
    const rule = this.addRule(presentIfNotInRule, errorMessage);
    rule.context.options.field = field;
    rule.context.options.values = values;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== PRESENT: BASED ON MULTIPLE FIELDS (ALL) ====================

  /**
   * Field must be present if all specified fields exist
   */
  public presentWithAll(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if all specified sibling fields exist
   */
  public presentWithAllSiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present if all specified fields are missing
   */
  public presentWithoutAll(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithoutAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if all specified sibling fields are missing
   */
  public presentWithoutAllSiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithoutAllRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  // ==================== PRESENT: BASED ON MULTIPLE FIELDS (ANY) ====================

  /**
   * Field must be present if any of the specified fields exists
   */
  public presentWithAny(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if any of the specified sibling fields exists
   */
  public presentWithAnySiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Field must be present if any of the specified fields is missing
   */
  public presentWithoutAny(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithoutAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Field must be present if any of the specified sibling fields is missing
   */
  public presentWithoutAnySiblings(fields: string[], errorMessage?: string) {
    const rule = this.addRule(presentWithoutAnyRule, errorMessage);
    rule.context.options.fields = fields;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Mutate the data
   */
  public async mutate(data: any, context: SchemaContext) {
    let mutatedData = data;

    for (const mutator of this.mutators) {
      mutator.context.ctx = context;
      mutatedData = await mutator.mutate(mutatedData, mutator.context);
    }

    return mutatedData;
  }

  /**
   * Value is forbidden to be present
   */
  public forbidden(errorMessage?: string) {
    this.addRule(forbiddenRule, errorMessage);
    return this;
  }

  /**
   * Apply different validation rules based on another field's value (global scope)
   *
   * Use this when you need to apply completely different validators
   * based on another field's value (not just required/optional).
   *
   * @param field - Field name to check (can be nested with dot notation)
   * @param options - Validation options per field value
   *
   * @example
   * ```ts
   * // Different allowed values based on user type
   * v.object({
   *   userType: v.string().in(['admin', 'user']),
   *   role: v.string().when('userType', {
   *     is: {
   *       admin: v.string().in(['super', 'moderator']),
   *       user: v.string().in(['member', 'guest'])
   *     },
   *     otherwise: v.string().optional()
   *   })
   * })
   *
   * // Different validation rules based on type
   * v.object({
   *   contactType: v.string().in(['email', 'phone']),
   *   contact: v.string().when('contactType', {
   *     is: {
   *       email: v.string().email(),
   *       phone: v.string().pattern(/^\d{10}$/)
   *     }
   *   })
   * })
   * ```
   * @category Conditional Validation
   */
  public when(
    field: string,
    options: Omit<WhenRuleOptions, "field" | "scope">,
  ) {
    const rule = this.addRule(whenRule);
    rule.context.options.field = field;
    rule.context.options.is = options.is;
    rule.context.options.otherwise = options.otherwise;
    rule.context.options.scope = "global";
    return this;
  }

  /**
   * Apply different validation rules based on sibling field's value
   *
   * Use this for nested objects where you need to check a field
   * within the same parent object.
   *
   * @param siblingField - Sibling field name to check
   * @param options - Validation options per field value
   *
   * @example
   * ```ts
   * // Array of users with role-based permissions
   * v.array(v.object({
   *   userType: v.string().in(['admin', 'user']),
   *   permissions: v.string().whenSibling('userType', {
   *     is: {
   *       admin: v.string().in(['read', 'write', 'delete']),
   *       user: v.string().in(['read'])
   *     }
   *   })
   * }))
   * ```
   * @category Conditional Validation
   */
  public whenSibling(
    siblingField: string,
    options: Omit<WhenRuleOptions, "field" | "scope">,
  ) {
    const rule = this.addRule(whenRule);
    rule.context.options.field = siblingField;
    rule.context.options.is = options.is;
    rule.context.options.otherwise = options.otherwise;
    rule.context.options.scope = "sibling";
    return this;
  }

  /**
   * Set the label for the validator that will be matching the :input attribute
   */
  public label(label: string) {
    this.attributesText.input = label;
    return this;
  }

  /**
   * Validate the data
   */
  public async validate(
    data: any,
    context: SchemaContext,
  ): Promise<ValidationResult> {
    const mutatedData = await this.mutate(data ?? this.defaultValue, context);
    const errors: ValidationResult["errors"] = [];
    let isValid = true;
    const isFirstErrorOnly = context.configurations?.firstErrorOnly ?? true;

    for (const rule of this.rules) {
      if ((rule.requiresValue ?? true) && isEmpty(data)) continue;

      this.setRuleAttributesList(rule);

      const result = await rule.validate(mutatedData, context);

      if (result.isValid === false) {
        isValid = false;
        errors.push({
          type: rule.name,
          error: result.error,
          input: result.path ?? context.path,
        });

        if (isFirstErrorOnly) {
          break;
        }
      }
    }

    return {
      isValid,
      errors,
      data: await this.startTransformationPipeline(mutatedData, context),
    };
  }

  /**
   * Set rule attributes list
   */
  protected setRuleAttributesList(rule: ContextualSchemaRule) {
    rule.context.attributesList =
      typeof this.attributesText[rule.name] === "object"
        ? (this.attributesText[rule.name] as ValidationAttributesList)
        : this.attributesText;
  }
}
