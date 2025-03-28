import {
  flipArrayMutator,
  sortArrayMutator,
  uniqueArrayMutator,
} from "./../mutators";
import {
  arrayRule,
  lengthRule,
  maxLengthRule,
  minLengthRule,
  uniqueArrayRule,
} from "./../rules";
import { BaseValidator } from "./base.validator";

export class ArrayValidator extends BaseValidator {
  public constructor(
    public validator: BaseValidator,
    errorMessage?: string,
  ) {
    super();

    this.addRule(arrayRule, errorMessage);
  }

  /**
   * Reverse array order
   *
   * @mutate
   */
  public flip() {
    return this.addMutator(flipArrayMutator);
  }

  /**
   * Reverse array order
   *
   * @mutate
   */
  public reverse() {
    return this.addMutator(flipArrayMutator);
  }

  /**
   * Make it has only unique values
   *
   * @mutate
   */
  public onlyUnique() {
    return this.addMutator(uniqueArrayMutator);
  }

  /**
   * Sort array
   *
   * If key is passed, it will sort by the key value
   *
   * @mutate
   * @supports dot notation
   */
  public sort(direction: "asc" | "desc" = "asc", key?: string) {
    this.addMutator(sortArrayMutator, { direction, key });

    return this;
  }

  // End of mutators

  //   Start of rules

  /**
   * Array length must be greater than the given length
   */
  public minLength(length: number, errorMessage?: string) {
    const rule = this.addRule(minLengthRule, errorMessage);

    rule.context.options.minLength = length;

    return this;
  }

  /**
   * Array length must be less than the given length
   */
  public maxLength(length: number, errorMessage?: string) {
    const rule = this.addRule(maxLengthRule, errorMessage);

    rule.context.options.maxLength = length;

    return this;
  }

  /**
   * Array length must be of the given length
   */
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

  /**
   * Mutate the data
   *
   * Please note this method should not be called directly, as it is used internally by the `validate` method
   */
  public mutate(data: any, context: SchemaContext) {
    if (!Array.isArray(data)) return data;

    return super.mutate([...data], context);
  }

  /**
   * Validate array
   */
  public async validate(
    data: any,
    context: SchemaContext,
  ): Promise<ValidationResult> {
    const mutatedData = (await this.mutate(data, context)) || [];
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
