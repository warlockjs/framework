import type { Schema, ValidationResult } from "../types";
import type { BaseValidator } from "../validators";
import {
  AnyValidator,
  ArrayValidator,
  BooleanValidator,
  DateValidator,
  FloatValidator,
  IntValidator,
  NumberValidator,
  ObjectValidator,
  ScalarValidator,
  StringValidator,
} from "../validators";
import { validate as validateFunction } from "./validate";

/**
 * Seal factory object - creates instances of validators
 *
 * Use 'v' to create validation schemas (seals) for your data
 */
export const v: ValidatorV = {
  /** Create an object validator */
  object: <T extends Schema>(schema: T, errorMessage?: string) =>
    new ObjectValidator(schema, errorMessage) as ObjectValidator & {
      schema: T;
    },

  /** Create an any validator */
  any: () => new AnyValidator(),

  /** Create a forbidden validator */
  forbidden: () => v.any().forbidden(),

  /** Create an array validator */
  array: <T extends BaseValidator>(validator: T, errorMessage?: string) =>
    new ArrayValidator(validator, errorMessage) as ArrayValidator & {
      validator: T;
    },

  /** Create a date validator */
  date: (errorMessage?: string) => new DateValidator(errorMessage),

  /** Create a string validator */
  string: (errorMessage?: string) => new StringValidator(errorMessage),

  /** Create an enum validator */
  enum: (values: any, errorMessage?: string) =>
    new StringValidator().enum(values, errorMessage),

  /** Create a number validator */
  number: (errorMessage?: string) => new NumberValidator(errorMessage),

  /** Create an integer validator */
  int: (errorMessage?: string) => new IntValidator(errorMessage),

  /** Create a float validator */
  float: (errorMessage?: string) => new FloatValidator(errorMessage),

  /** Create a boolean validator */
  boolean: (errorMessage?: string) => new BooleanValidator(errorMessage),

  /** Create a scalar validator */
  scalar: (errorMessage?: string) => new ScalarValidator(errorMessage),

  /** Create a localized array validator */
  localized: (valueValidator?: BaseValidator, errorMessage?: string) =>
    v.array(
      v.object({
        localeCode: v.string().required(),
        value: (valueValidator || v.string()).required(),
      }),
      errorMessage,
    ),

  /** Validate data against a schema */
  validate: validateFunction,
} as unknown as ValidatorV;

export interface ValidatorV {
  object: <T extends Schema>(
    schema: T,
    errorMessage?: string,
  ) => ObjectValidator & {
    schema: T;
  };
  any: () => AnyValidator;
  forbidden: () => AnyValidator;
  array: <T extends BaseValidator>(
    validator: T,
    errorMessage?: string,
  ) => ArrayValidator & {
    validator: T;
  };
  date: (errorMessage?: string) => DateValidator;
  string: (errorMessage?: string) => StringValidator;
  enum: (values: any, errorMessage?: string) => ScalarValidator;
  number: (errorMessage?: string) => NumberValidator;
  int: (errorMessage?: string) => IntValidator;
  float: (errorMessage?: string) => FloatValidator;
  boolean: (errorMessage?: string) => BooleanValidator;
  scalar: (errorMessage?: string) => ScalarValidator;
  localized: (
    valueValidator?: BaseValidator,
    errorMessage?: string,
  ) => ArrayValidator & {
    validator: BaseValidator;
  };
  validate: <T extends BaseValidator>(
    schema: T,
    data: any,
  ) => Promise<ValidationResult>;
}
