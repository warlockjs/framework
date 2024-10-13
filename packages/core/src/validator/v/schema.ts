import { trans } from "@mongez/localization";
import { clone } from "@mongez/reinforcements";
import { isPlainObject } from "@mongez/supportive-is";
import { type BaseModel } from "@warlock.js/cascade";
import {
  dateMutator,
  flipArrayMutator,
  lowercaseMutator,
  numberMutator,
  objectTrimMutator,
  sortArrayMutator,
  stringMutator,
  stripUnknownMutator,
  uniqueArrayMutator,
  uppercaseMutator,
} from "./mutators";
import {
  arrayRule,
  booleanRule,
  dateRule,
  emailRule,
  enumRule,
  equalRule,
  existsRule,
  fileRile,
  floatRule,
  imageRule,
  intRule,
  lengthRule,
  matchesRule,
  maxFileSizeRule,
  maxLengthRule,
  maxRule,
  maxWidthRule,
  minFileSizeRule,
  minHeightRule,
  minLengthRule,
  minRule,
  minWidthRule,
  numberRule,
  objectRule,
  patternRule,
  positiveRule,
  requiredIfAbsentRule,
  requiredIfEmptyRule,
  requiredIfFieldRule,
  requiredRule,
  requiredWithRule,
  scalarRule,
  stringRule,
  uniqueArrayRule,
  uniqueRule,
  unknownKeyRule,
  urlRule,
  type ExistsRuleOptions,
  type UniqueRuleOptions,
} from "./rules";
import type {
  ContextualSchemaRule,
  ContextualizedMutator,
  Mutator,
  Schema,
  SchemaContext,
  SchemaRule,
  ValidationResult,
} from "./types";
import { setKeyPath } from "./utils";

export class BaseValidator {
  public rules: ContextualSchemaRule[] = [];
  public mutators: ContextualizedMutator[] = [];
  protected defaultValue: any;

  public addRule(rule: SchemaRule, errorMessage?: string) {
    const newRule: ContextualSchemaRule = {
      ...clone(rule),
      context: {
        errorMessage,
        options: {},
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

  public default(value: any) {
    this.defaultValue = value;

    return this;
  }

  public present(errorMessage?: string) {
    this.addRule(requiredRule, errorMessage);

    return this;
  }

  public required(errorMessage?: string) {
    this.addRule(requiredRule, errorMessage);

    return this;
  }

  public requiredWith(input: string, errorMessage?: string) {
    const rule = this.addRule(requiredWithRule, errorMessage);

    rule.context.options.input = input;

    return this;
  }

  public requiredIfAbsent(input: string, errorMessage?: string) {
    const rule = this.addRule(requiredIfAbsentRule, errorMessage);

    rule.context.options.input = input;

    return this;
  }

  public requiredIfEmpty(input: string, errorMessage?: string) {
    const rule = this.addRule(requiredIfEmptyRule, errorMessage);

    rule.context.options.input = input;

    return this;
  }

  public requiredIfField(input: string, value: any, errorMessage?: string) {
    const rule = this.addRule(requiredIfFieldRule, errorMessage);

    rule.context.options.field = input;
    rule.context.options.value = value;

    return this;
  }

  public async mutate(data: any, context: SchemaContext) {
    let mutatedData = data;

    for (const mutator of this.mutators) {
      mutator.context.ctx = context;
      mutatedData = await mutator.mutate(mutatedData, mutator.context);
    }

    return mutatedData;
  }

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

export class AnyValidator extends BaseValidator {
  //
}

export class ObjectValidator extends BaseValidator {
  /**
   * Whether to allow unknown properties
   *
   * @default false
   */
  protected shouldAllowUnknown = false;

  /**
   * Allowed keys that could be in the data but not necessarily validated
   */
  protected allowedKeys: string[] = [];

  public constructor(
    public schema: Schema,
    errorMessage?: string,
  ) {
    super();

    this.addRule(objectRule, errorMessage);
  }

  public stripUnknown() {
    this.addMutator(stripUnknownMutator, {
      get allowedKeys() {
        return this.allowedKeys;
      },
    });

    return this;
  }

  /**
   * Add list of allowed keys that could be in the data but not necessarily validated
   */
  public allow(...keys: string[]) {
    this.allowedKeys.push(...keys);

    return this;
  }

  /**
   * Trim values of the object properties
   */
  public trim(recursive = true) {
    this.addMutator(objectTrimMutator, { recursive });

    return this;
  }

  public allowUnknown(allow = true) {
    this.shouldAllowUnknown = allow;

    return this;
  }

  public mutate(data: any, context: SchemaContext) {
    if (!isPlainObject(data)) return data;

    return super.mutate({ ...data }, context);
  }

  public async validate(
    data: any,
    context: SchemaContext,
  ): Promise<ValidationResult> {
    context.schema = this.schema;

    const mutatedData = await this.mutate(data, context);

    // now we need to check if the object has unknown properties
    if (this.shouldAllowUnknown === false) {
      const rule = this.addRule(unknownKeyRule);
      rule.context.options.allowedKeys = this.allowedKeys;
      rule.context.options.schema = this.schema;
    }

    const result = await super.validate(mutatedData, context);

    if (result.isValid === false) return result;

    // now we need to validate the object properties
    const errors: ValidationResult["errors"] = [];

    const validationPromises = Object.keys(this.schema).map(async key => {
      const value = mutatedData[key];
      const validator = this.schema[key];

      const childContext: SchemaContext = {
        ...context,
        parent: mutatedData,
        value,
        key,
        path: setKeyPath(context.path, key),
      };

      const childResult = await validator.validate(value, childContext);

      mutatedData[key] = childResult.data;

      if (childResult.isValid === false) {
        errors.push(...childResult.errors);
      }
    });

    await Promise.all(validationPromises);

    return {
      isValid: errors.length === 0,
      errors,
      data: mutatedData,
    };
  }
}

export class ArrayValidator extends AnyValidator {
  public constructor(
    public validator: BaseValidator,
    errorMessage?: string,
  ) {
    super();

    this.addRule(arrayRule, errorMessage);
  }

  // Start of mutators
  //   Mutators methods should start with `m` prefix

  /**
   * Reverse array order
   */
  public flip() {
    return this.addMutator(flipArrayMutator);
  }

  /**
   * Reverse array order
   */
  public reverse() {
    return this.addMutator(flipArrayMutator);
  }

  /**
   * Make it has only unique values
   */
  public onlyUnique() {
    return this.addMutator(uniqueArrayMutator);
  }

  /**
   * Sort array
   *
   * If key is passed, it will sort by the key value
   * @supports dot notation
   */
  public sort(direction: "asc" | "desc" = "asc", key?: string) {
    this.addMutator(sortArrayMutator, { direction, key });

    return this;
  }

  // End of mutators

  //   Start of rules

  public minLength(length: number, errorMessage?: string) {
    const rule = this.addRule(minLengthRule, errorMessage);

    rule.context.options.minLength = length;

    return this;
  }

  public maxLength(length: number, errorMessage?: string) {
    const rule = this.addRule(maxLengthRule, errorMessage);

    rule.context.options.maxLength = length;

    return this;
  }

  public length(length: number, errorMessage?: string) {
    const rule = this.addRule(lengthRule, errorMessage);

    rule.context.options.length = length;

    return this;
  }

  /**
   * Array must have unique values
   */
  public unique() {
    this.addRule(uniqueArrayRule);

    return this;
  }

  public mutate(data: any, context: SchemaContext) {
    if (!Array.isArray(data)) return data;

    return super.mutate([...data], context);
  }

  public async validate(
    data: any,
    context: SchemaContext,
  ): Promise<ValidationResult> {
    const mutatedData = await this.mutate(data, context);
    const result = await super.validate(data, context);

    if (result.isValid === false) return result;

    const errors: ValidationResult["errors"] = [];

    for (let index = 0; index < mutatedData.length; index++) {
      const value = mutatedData[index];

      const childContext: SchemaContext = {
        ...context,
        parent: mutatedData,
        value,
        key: index.toString(),
        path: setKeyPath(context.path, index.toString()),
      };

      const childResult = await this.validator.validate(value, childContext);

      mutatedData[index] = childResult.data;

      if (childResult.isValid === false) {
        errors.push(...childResult.errors);
      }

      if (context.configurations?.firstErrorOnly && errors.length) {
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      data: mutatedData,
    };
  }
}

export class StringValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(stringRule, errorMessage);

    this.addMutator(stringMutator);
  }

  public lowercase() {
    this.addMutator(lowercaseMutator);

    return this;
  }

  public uppercase() {
    this.addMutator(uppercaseMutator);

    return this;
  }

  public email(errorMessage?: string) {
    this.addRule(emailRule, errorMessage);

    return this;
  }

  public url(errorMessage?: string) {
    this.addRule(urlRule, errorMessage);

    return this;
  }

  public matches(field: string, errorMessage?: string) {
    const rule = this.addRule(matchesRule, errorMessage);

    rule.context.options.field = field;

    return this;
  }

  public pattern(pattern: string, errorMessage?: string) {
    const rule = this.addRule(patternRule, errorMessage);

    rule.context.options.pattern = pattern;

    return this;
  }

  public minLength(length: number, errorMessage?: string) {
    const rule = this.addRule(minLengthRule, errorMessage);

    rule.context.options.minLength = length;

    return this;
  }

  public maxLength(length: number, errorMessage?: string) {
    const rule = this.addRule(maxLengthRule, errorMessage);

    rule.context.options.maxLength = length;

    return this;
  }

  public length(length: number, errorMessage?: string) {
    const rule = this.addRule(lengthRule, errorMessage);

    rule.context.options.length = length;

    return this;
  }

  public enum(values: any[], errorMessage?: string) {
    const rule = this.addRule(enumRule, errorMessage);

    rule.context.options.values = values;

    return this;
  }

  public in(values: any[], errorMessage?: string) {
    return this.enum(values, errorMessage);
  }

  public equal(value: any, errorMessage?: string) {
    const rule = this.addRule(equalRule, errorMessage);

    rule.context.options.value = value;

    return this;
  }

  public unique(
    model: typeof BaseModel | string,
    {
      errorMessage,
      ...options
    }: UniqueRuleOptions & {
      errorMessage?: string;
    } = {},
  ) {
    const rule = this.addRule(uniqueRule, errorMessage);

    rule.context.options = {
      ...options,
      Model: model,
    };

    return this;
  }

  public exists(
    model: typeof BaseModel | string,
    {
      errorMessage,
      ...options
    }: ExistsRuleOptions & {
      errorMessage?: string;
    } = {},
  ) {
    const rule = this.addRule(existsRule, errorMessage);

    rule.context.options = {
      ...options,
      Model: model,
    };

    return this;
  }
}

export class DateValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(dateRule, errorMessage);

    this.addMutator(dateMutator);
  }
}

class NumberValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(numberRule, errorMessage);

    this.addMutator(numberMutator);
  }

  public min(min: number, errorMessage?: string) {
    const rule = this.addRule(minRule, errorMessage);

    rule.context.options.min = min;

    return this;
  }

  public max(max: number, errorMessage?: string) {
    const rule = this.addRule(maxRule, errorMessage);

    rule.context.options.max = max;

    return this;
  }

  public equal(value: number, errorMessage?: string) {
    const rule = this.addRule(equalRule, errorMessage);

    rule.context.options.value = value;

    return this;
  }

  public positive(errorMessage?: string) {
    this.addRule(positiveRule, errorMessage);

    return this;
  }

  public unique(
    model: typeof BaseModel | string,
    {
      errorMessage,
      ...options
    }: UniqueRuleOptions & {
      errorMessage?: string;
    } = {},
  ) {
    const rule = this.addRule(uniqueRule, errorMessage);

    rule.context.options = {
      ...options,
      Model: model,
    };

    return this;
  }

  public exists(
    model: typeof BaseModel | string,
    {
      errorMessage,
      ...options
    }: ExistsRuleOptions & {
      errorMessage?: string;
    } = {},
  ) {
    const rule = this.addRule(existsRule, errorMessage);

    rule.context.options = {
      ...options,
      Model: model,
    };

    return;
  }
}

export class IntValidator extends NumberValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(intRule, errorMessage);
  }
}

export class FloatValidator extends NumberValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(floatRule, errorMessage);
  }
}

export class BooleanValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(booleanRule, errorMessage);
  }
}

export class ScalarValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(scalarRule, errorMessage);
  }

  public unique(
    model: typeof BaseModel | string,
    {
      errorMessage,
      ...options
    }: UniqueRuleOptions & {
      errorMessage?: string;
    } = {},
  ) {
    const rule = this.addRule(uniqueRule, errorMessage);

    rule.context.options = {
      ...options,
      Model: model,
    };

    return this;
  }

  public exists(
    model: typeof BaseModel | string,
    {
      errorMessage,
      ...options
    }: ExistsRuleOptions & {
      errorMessage?: string;
    } = {},
  ) {
    const rule = this.addRule(existsRule, errorMessage);

    rule.context.options = {
      ...options,
      Model: model,
    };

    return;
  }
}

export class FileValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(fileRile, errorMessage);
  }

  public image(errorMessage?: string) {
    this.addRule(imageRule, errorMessage);

    return this;
  }

  public minFileSize(size: number, errorMessage?: string) {
    const rule = this.addRule(minFileSizeRule, errorMessage);

    rule.context.options.minFileSize = size;

    return this;
  }

  public maxFileSize(size: number, errorMessage?: string) {
    const rule = this.addRule(maxFileSizeRule, errorMessage);

    rule.context.options.maxFileSize = size;

    return this;
  }

  public minWidth(width: number, errorMessage?: string) {
    const rule = this.addRule(minWidthRule, errorMessage);

    rule.context.options.minWidth = width;

    return this;
  }

  public maxWidth(width: number, errorMessage?: string) {
    const rule = this.addRule(maxWidthRule, errorMessage);

    rule.context.options.maxWidth = width;

    return this;
  }

  public minHeight(height: number, errorMessage?: string) {
    const rule = this.addRule(minHeightRule, errorMessage);

    rule.context.options.minHeight = height;

    return this;
  }

  public maxHeight(height: number, errorMessage?: string) {
    const rule = this.addRule(minHeightRule, errorMessage);

    rule.context.options.maxHeight = height;

    return this;
  }
}

export const validate = async (schema: BaseValidator, data: any) => {
  const context: SchemaContext = {
    allValues: data,
    parent: null,
    value: data,
    key: "",
    path: "",
    translator(rule, attributes) {
      return trans(`validation.${rule}`, attributes);
    },
  };

  return await schema.validate(data, context);
};

export const v = {
  object: (schema: Schema, errorMessage?: string) =>
    new ObjectValidator(schema, errorMessage),
  array: (validator: BaseValidator, errorMessage?: string) =>
    new ArrayValidator(validator, errorMessage),
  string: (errorMessage?: string) => new StringValidator(errorMessage),
  number: (errorMessage?: string) => new NumberValidator(errorMessage),
  int: (errorMessage?: string) => new IntValidator(errorMessage),
  float: (errorMessage?: string) => new FloatValidator(errorMessage),
  boolean: (errorMessage?: string) => new BooleanValidator(errorMessage),
  scalar: (errorMessage?: string) => new ScalarValidator(errorMessage),
  file: (errorMessage?: string) => new FileValidator(errorMessage),
  validate,
};
