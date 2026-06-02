import { SealConfig } from "../config";
import type { StandardSchemaV1 } from "../standard-schema/types";
import type { Schema, SchemaContext, ValidationResult } from "../types";
import type { Infer } from "../types/inference-types";
import { AnyValidator } from "../validators/any-validator";
import { ArrayValidator } from "../validators/array-validator";
import type { BaseValidator } from "../validators/base-validator";
import { BooleanValidator } from "../validators/boolean-validator";
import { ComputedValidator } from "../validators/computed-validator";
import { DateValidator } from "../validators/date-validator";
import { DiscriminatedUnionValidator } from "../validators/discriminated-union-validator";
import { FloatValidator } from "../validators/float-validator";
import { InstanceOfValidator } from "../validators/instanceof-validator";
import { IntValidator } from "../validators/int-validator";
import { LazyValidator } from "../validators/lazy-validator";
import { LiteralValidator } from "../validators/literal-validator";
import { ManagedValidator } from "../validators/managed-validator";
import { NumberValidator } from "../validators/number-validator";
import { NumericValidator } from "../validators/numeric-validator";
import { ObjectValidator } from "../validators/object-validator";
import { RecordValidator } from "../validators/record-validator";
import { ScalarValidator } from "../validators/scalar-validator";
import { StringValidator } from "../validators/string-validator";
import { TupleValidator } from "../validators/tuple-validator";
import { UnionValidator } from "../validators/union-validator";
// BaseValidator prototype augmentations — side-effect imports so the `v`
// factory always exposes the chain methods (.required, .requiredIf, .sameAs,
// .present, .forbidden, .when, …) regardless of which entry path loaded it.
// The package barrel (src/index.ts) loads these via the validators barrel, but
// importing the factory leaf directly would otherwise yield a half-built `v`.
import "../validators/methods/equality-conditional-methods";
import "../validators/methods/forbidden-methods";
import "../validators/methods/present-methods";
import "../validators/methods/required-methods";
import { validate as validateFunction } from "./validate";

/**
 * Seal factory object - creates instances of validators
 *
 * Use 'v' to create validation schemas (seals) for your data
 */
export const v: ValidatorV = {
  /** Create an object validator */
  object: <T extends Schema>(schema: T, errorMessage?: string) =>
    new ObjectValidator<T>(schema, errorMessage) as ObjectValidator<T> &
      StandardSchemaV1<Infer<ObjectValidator<T>>>,

  /** Create an any validator */
  any: () => new AnyValidator() as AnyValidator & StandardSchemaV1<any>,

  /** Create an array validator */
  array: <T extends BaseValidator>(validator: T, errorMessage?: string) =>
    new ArrayValidator(validator, errorMessage) as ArrayValidator & {
      validator: T;
    } & StandardSchemaV1<Array<Infer<T>>>,

  /** Create a record validator - object with dynamic keys and consistent value types */
  record: <T extends BaseValidator>(validator?: T, errorMessage?: string) =>
    new RecordValidator(validator || v.any(), errorMessage) as RecordValidator & {
      valueValidator: T;
    } & StandardSchemaV1<Record<string, Infer<T>>>,

  /** Create a tuple validator - fixed-length array with position-specific types */
  tuple: <T extends BaseValidator[]>(validators: T, errorMessage?: string) =>
    new TupleValidator(validators, errorMessage) as TupleValidator & {
      validators: T;
    } & StandardSchemaV1<{ [K in keyof T]: Infer<T[K]> }>,

  /** Create a date validator */
  date: (errorMessage?: string) =>
    new DateValidator(errorMessage) as DateValidator & StandardSchemaV1<Date>,

  /**
   * Create a literal validator — narrows to the union of given literal values
   *
   * @example
   * v.literal("items")               // type: "items"
   * v.literal("draft", "published")  // type: "draft" | "published"
   * v.literal(1, 2, 3)               // type: 1 | 2 | 3
   */
  literal: <T extends readonly [string | number | boolean, ...(string | number | boolean)[]]>(
    ...values: T
  ) =>
    new LiteralValidator<T>(values) as LiteralValidator<T> & StandardSchemaV1<T[number]>,

  /**
   * Create an instanceof validator — value must be `instanceof` the constructor
   *
   * @example
   * v.instanceof(File)        // type: File
   * v.instanceof(Buffer)      // type: Buffer
   * v.instanceof(MyClass)     // type: MyClass
   */
  instanceof: <T>(ctor: new (...args: any[]) => T, errorMessage?: string) =>
    new InstanceOfValidator<T>(ctor, errorMessage) as InstanceOfValidator<T> &
      StandardSchemaV1<T>,

  /**
   * Create a lazy validator — defers resolution of the inner validator until
   * validate-time. Use for recursive or forward-referenced schemas.
   *
   * @example
   * type Category = { name: string; children: Category[] };
   *
   * const category: ObjectValidator<...> = v.object({
   *   name: v.string(),
   *   children: v.array(v.lazy(() => category)),
   * });
   */
  lazy: <T extends BaseValidator>(thunk: () => T) =>
    new LazyValidator(thunk) as LazyValidator<T> & StandardSchemaV1<Infer<T>>,

  /** Create a string validator */
  string: (errorMessage?: string) =>
    new StringValidator(errorMessage) as StringValidator & StandardSchemaV1<string>,

  /** Create an email validator */
  email: (emailErrorMessage?: string, errorMessage?: string) =>
    new StringValidator(errorMessage).email(emailErrorMessage) as StringValidator &
      StandardSchemaV1<string>,

  /**
   * Create an enum validator — preserves the literal union of accepted
   * values in the inferred Standard Schema output.
   *
   * Two input shapes:
   * - Tuple of literals: `v.enum(["draft", "published"])` →
   *   `StandardSchemaV1<"draft" | "published">`
   * - TypeScript enum object: `v.enum(Status)` →
   *   `StandardSchemaV1<Status[keyof Status]>`
   *
   * Implementation is loosely typed; the public `ValidatorV.enum`
   * surface declares the precise overloads.
   */
  enum: ((values: any, errorMessage?: string) =>
    Array.isArray(values)
      ? new StringValidator().oneOf(values, errorMessage)
      : new ScalarValidator().enum(values, errorMessage)) as ValidatorV["enum"],

  /** Create a number validator */
  number: (errorMessage?: string) =>
    new NumberValidator(errorMessage) as NumberValidator & StandardSchemaV1<number>,

  /** Create a numeric validator */
  numeric: (errorMessage?: string) =>
    new NumericValidator(errorMessage) as NumericValidator & StandardSchemaV1<number>,

  /** Create an integer validator */
  int: (errorMessage?: string) =>
    new IntValidator(errorMessage) as IntValidator & StandardSchemaV1<number>,

  /** Create a float validator */
  float: (errorMessage?: string) =>
    new FloatValidator(errorMessage) as FloatValidator & StandardSchemaV1<number>,

  /** Create a boolean validator */
  boolean: (errorMessage?: string) =>
    new BooleanValidator(errorMessage) as BooleanValidator & StandardSchemaV1<boolean>,

  /** Create a scalar validator */
  scalar: (errorMessage?: string) =>
    new ScalarValidator(errorMessage) as ScalarValidator &
      StandardSchemaV1<string | number | boolean>,

  /** Create a union validator - validates against multiple types */
  union: <T extends BaseValidator[]>(validators: T, errorMessage?: string) =>
    new UnionValidator().union(validators, errorMessage) as UnionValidator &
      StandardSchemaV1<Infer<T[number]>>,

  /**
   * Create a discriminated union — routes payloads by a shared literal
   * discriminator field. Each branch must be a `v.object(...)` with the
   * discriminator typed as `v.literal(...)`.
   *
   * @example
   * const email = v.object({ type: v.literal("email"), email: v.string().email() });
   * const sms   = v.object({ type: v.literal("sms"),   phone: v.string() });
   * const notif = v.discriminatedUnion("type", [email, sms]);
   * // type T = Infer<typeof notif>;
   * // → { type: "email", email: string } | { type: "sms", phone: string }
   */
  discriminatedUnion: <
    K extends string,
    Branches extends ReadonlyArray<ObjectValidator<any>>,
  >(
    discriminator: K,
    validators: Branches,
  ) =>
    new DiscriminatedUnionValidator(discriminator, validators) as DiscriminatedUnionValidator<
      K,
      Branches
    > &
      StandardSchemaV1<Infer<Branches[number]>>,

  /** Create a computed field validator - derives value from other validated fields */
  computed: <TResult = any>(
    callback: (data: any, context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) =>
    new ComputedValidator<TResult>(callback, resultValidator) as ComputedValidator<TResult> &
      StandardSchemaV1<TResult>,

  /** Create a managed field validator - framework-injected value */
  managed: <TResult = any>(
    callback: (context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) =>
    new ManagedValidator<TResult>(callback, resultValidator) as ManagedValidator<TResult> &
      StandardSchemaV1<TResult>,

  /** Validate data against a schema */
  validate: validateFunction,
} as unknown as ValidatorV;

export type ValidateOptions = {
  context?: Record<string, any>;
} & SealConfig;

export interface ValidatorV {
  object: <T extends Schema>(
    schema: T,
    errorMessage?: string,
  ) => ObjectValidator<T> & StandardSchemaV1<Infer<ObjectValidator<T>>>;
  any: () => AnyValidator & StandardSchemaV1<any>;
  array: <T extends BaseValidator>(
    validator: T,
    errorMessage?: string,
  ) => ArrayValidator & {
    validator: T;
  } & StandardSchemaV1<Array<Infer<T>>>;
  record: <T extends BaseValidator>(
    validator?: T,
    errorMessage?: string,
  ) => RecordValidator & {
    valueValidator: T;
  } & StandardSchemaV1<Record<string, Infer<T>>>;
  tuple: <T extends BaseValidator[]>(
    validators: T,
    errorMessage?: string,
  ) => TupleValidator & {
    validators: T;
  } & StandardSchemaV1<{ [K in keyof T]: Infer<T[K]> }>;
  date: (errorMessage?: string) => DateValidator & StandardSchemaV1<Date>;
  literal: <T extends readonly [string | number | boolean, ...(string | number | boolean)[]]>(
    ...values: T
  ) => LiteralValidator<T> & StandardSchemaV1<T[number]>;
  instanceof: <T>(
    ctor: new (...args: any[]) => T,
    errorMessage?: string,
  ) => InstanceOfValidator<T> & StandardSchemaV1<T>;
  lazy: <T extends BaseValidator>(
    thunk: () => T,
  ) => LazyValidator<T> & StandardSchemaV1<Infer<T>>;
  string: (errorMessage?: string) => StringValidator & StandardSchemaV1<string>;
  email: (errorMessage?: string) => StringValidator & StandardSchemaV1<string>;
  enum: {
    <const T extends readonly (string | number | boolean)[]>(
      values: T,
      errorMessage?: string,
    ): ScalarValidator & StandardSchemaV1<T[number]>;
    <const T extends Record<string, string | number>>(
      values: T,
      errorMessage?: string,
    ): ScalarValidator & StandardSchemaV1<T[keyof T]>;
  };
  number: (errorMessage?: string) => NumberValidator & StandardSchemaV1<number>;
  numeric: (errorMessage?: string) => NumericValidator & StandardSchemaV1<number>;
  int: (errorMessage?: string) => IntValidator & StandardSchemaV1<number>;
  float: (errorMessage?: string) => FloatValidator & StandardSchemaV1<number>;
  boolean: (errorMessage?: string) => BooleanValidator & StandardSchemaV1<boolean>;
  scalar: (
    errorMessage?: string,
  ) => ScalarValidator & StandardSchemaV1<string | number | boolean>;
  union: <T extends BaseValidator[]>(
    validators: T,
    errorMessage?: string,
  ) => UnionValidator & StandardSchemaV1<Infer<T[number]>>;
  discriminatedUnion: <
    K extends string,
    Branches extends ReadonlyArray<ObjectValidator<any>>,
  >(
    discriminator: K,
    validators: Branches,
  ) => DiscriminatedUnionValidator<K, Branches> & StandardSchemaV1<Infer<Branches[number]>>;
  computed: <TResult = any>(
    callback: (data: any, context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) => ComputedValidator<TResult> & StandardSchemaV1<TResult>;
  managed: <TResult = any>(
    callback?: (context: SchemaContext) => TResult | Promise<TResult>,
    resultValidator?: BaseValidator,
  ) => ManagedValidator<TResult> & StandardSchemaV1<TResult>;
  validate: <T extends BaseValidator>(
    schema: T,
    data: any,
    options?: ValidateOptions,
  ) => Promise<ValidationResult>;
}
