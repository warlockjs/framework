import { SealConfig } from "../config";
import type { Schema, SchemaContext, ValidationResult } from "../types";
import type { BaseValidator } from "../validators";
import {
  AnyValidator,
  ArrayValidator,
  BooleanValidator,
  ComputedValidator,
  DateValidator,
  FloatValidator,
  IntValidator,
  ManagedValidator,
  NumberValidator,
  NumericValidator,
  ObjectValidator,
  RecordValidator,
  ScalarValidator,
  StringValidator,
  TupleValidator,
  UnionValidator,
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
    new ObjectValidator<T>(schema, errorMessage),

  /** Create an any validator */
  any: () => new AnyValidator(),

  /** Create an array validator */
  array: <T extends BaseValidator>(validator: T, errorMessage?: string) =>
    new ArrayValidator(validator, errorMessage) as ArrayValidator & {
      validator: T;
    },

  /** Create a record validator - object with dynamic keys and consistent value types */
  record: <T extends BaseValidator>(validator: T, errorMessage?: string) =>
    new RecordValidator(validator, errorMessage) as RecordValidator & {
      valueValidator: T;
    },

  /** Create a tuple validator - fixed-length array with position-specific types */
  tuple: <T extends BaseValidator[]>(validators: T, errorMessage?: string) =>
    new TupleValidator(validators, errorMessage) as TupleValidator & {
      validators: T;
    },

  /** Create a date validator */
  date: (errorMessage?: string) => new DateValidator(errorMessage),

  /** Create a string validator */
  string: (errorMessage?: string) => new StringValidator(errorMessage),

  /** Create an email validator */
  email: (emailErrorMessage?: string, errorMessage?: string) =>
    new StringValidator(errorMessage).email(emailErrorMessage),

  /** Create an enum validator */
  enum: (values: any, errorMessage?: string) => new ScalarValidator().enum(values, errorMessage),

  /** Create a number validator */
  number: (errorMessage?: string) => new NumberValidator(errorMessage),

  /** Create a numeric validator */
  numeric: (errorMessage?: string) => new NumericValidator(errorMessage),

  /** Create an integer validator */
  int: (errorMessage?: string) => new IntValidator(errorMessage),

  /** Create a float validator */
  float: (errorMessage?: string) => new FloatValidator(errorMessage),

  /** Create a boolean validator */
  boolean: (errorMessage?: string) => new BooleanValidator(errorMessage),

  /** Create a scalar validator */
  scalar: (errorMessage?: string) => new ScalarValidator(errorMessage),

  /** Create a union validator - validates against multiple types */
  union: (validators: BaseValidator[], errorMessage?: string) =>
    new UnionValidator().union(validators, errorMessage),

  /** Create a computed field validator - derives value from other validated fields */
  computed: <TResult = any>(
    callback: (data: any, context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) => new ComputedValidator<TResult>(callback, resultValidator),

  /** Create a managed field validator - framework-injected value */
  managed: <TResult = any>(
    callback: (context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) => new ManagedValidator<TResult>(callback, resultValidator),

  /** Validate data against a schema */
  validate: validateFunction,
} as unknown as ValidatorV;

export type ValidateOptions = {
  context?: Record<string, any>;
} & SealConfig;

export interface ValidatorV {
  object: <T extends Schema>(schema: T, errorMessage?: string) => ObjectValidator<T>;
  any: () => AnyValidator;
  array: <T extends BaseValidator>(
    validator: T,
    errorMessage?: string,
  ) => ArrayValidator & {
    validator: T;
  };
  record: <T extends BaseValidator>(
    validator: T,
    errorMessage?: string,
  ) => RecordValidator & {
    valueValidator: T;
  };
  tuple: <T extends BaseValidator[]>(
    validators: T,
    errorMessage?: string,
  ) => TupleValidator & {
    validators: T;
  };
  date: (errorMessage?: string) => DateValidator;
  string: (errorMessage?: string) => StringValidator;
  email: (errorMessage?: string) => StringValidator;
  enum: (values: any, errorMessage?: string) => ScalarValidator;
  number: (errorMessage?: string) => NumberValidator;
  numeric: (errorMessage?: string) => NumericValidator;
  int: (errorMessage?: string) => IntValidator;
  float: (errorMessage?: string) => FloatValidator;
  boolean: (errorMessage?: string) => BooleanValidator;
  scalar: (errorMessage?: string) => ScalarValidator;
  union: (validators: BaseValidator[], errorMessage?: string) => UnionValidator;
  computed: <TResult = any>(
    callback: (data: any, context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) => ComputedValidator<TResult>;
  managed: <TResult = any>(
    callback?: (context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) => ManagedValidator<TResult>;
  validate: <T extends BaseValidator>(
    schema: T,
    data: any,
    options?: ValidateOptions,
  ) => Promise<ValidationResult>;
}
