import { clone } from "@mongez/reinforcements";
import { requiredRule, whenRule } from "../rules";
import type {
  ContextualSchemaRule,
  ContextualizedMutator,
  Mutator,
  SchemaContext,
  SchemaRule,
  SchemaRuleOptions,
  ValidationResult,
  WhenRuleOptions,
} from "../types";
import { VALID_RULE, invalidRule } from "../utils";

export class BaseValidator {
  public rules: ContextualSchemaRule[] = [];
  public mutators: ContextualizedMutator[] = [];
  protected defaultValue: any;
  protected description?: string;

  /**
   * Add description to the validator
   */
  public describe(description: string) {
    this.description = description;
    return this;
  }

  /**
   * Add rule to the schema
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
   * Add mutator to the schema
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

  /**
   * Value must be present but not necessarily has a value
   */
  public present(errorMessage?: string) {
    this.addRule(requiredRule, errorMessage);
    return this;
  }

  /**
   * This value must be present and has a value
   */
  public required(errorMessage?: string) {
    this.addRule(requiredRule, errorMessage);
    return this;
  }

  /**
   * Apply conditional validation rules based on another field value
   */
  public when(field: string, options: Omit<WhenRuleOptions, "field">) {
    const rule = this.addRule(whenRule);

    rule.context.options.field = field;
    rule.context.options.is = options.is;
    rule.context.options.otherwise = options.otherwise;

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
      if ((rule.requiresValue ?? true) && data === undefined) continue;

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
      data: mutatedData,
    };
  }
}
