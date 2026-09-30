import { type Lazy } from "@mongez/reinforcements";
import { ResponseStatus } from "../http";
import { type ResourceConstructor, type ResourceContract } from "./resource";
import { type ResourceFieldBuilder } from "./resource-field-builder";

export type ResourceOutputValueCastType =
  | "string"
  | "number"
  | "date"
  | "localized"
  | "boolean"
  | "url"
  | "float"
  | "int"
  | "object"
  | "array"
  | "uploadsUrl"
  /**
   * Storage url means the value will be generated using current storage.url method
   */
  | "storageUrl";

/**
 * Self-referencing type — resolves the field using the same resource class.
 * - `"self"` for a single nested self-reference
 * - `"self[]"` for an array of self-references
 */
export type ResourceSelfReference = "self" | "self[]";

/**
 * Cast type with modifier suffixes for use in resource schemas.
 * - `[]` suffix declares the field as an array (e.g. "string[]")
 * - `?` suffix declares the field as nullable — always present in output, value or null (e.g. "number?")
 * - Combined: `[]` must come before `?` (e.g. "string[]?")
 */
export type ResourceCastType =
  | ResourceOutputValueCastType
  | `${ResourceOutputValueCastType}[]`
  | `${ResourceOutputValueCastType}?`
  | `${ResourceOutputValueCastType}[]?`;

export type ResourceArraySchema = {
  __type: "arrayOf";
  schema: Record<string, ResourceFieldConfig>;
};

export type ResourceFieldConfig =
  | ResourceCastType
  | ResourceConstructor
  | ResourceSelfReference
  | Lazy<ResourceConstructor>
  | [string, ResourceCastType]
  | ResourceFieldBuilder
  | ResourceArraySchema
  | ((value: any, resource: ResourceContract) => any); // Resolver function for computed/static values

export type ResourceSchema = Record<string, ResourceFieldConfig>;

export type ResourceFieldBuilderDateOutputOptions =
  | {
      /**
       * If set to true, then it will be returned as a formatted date
       */
      format?: boolean;
      /**
       * Return unix timestamp (Milliseconds)
       */
      timestamp?: boolean;
      /**
       * Return human readable date
       */
      humanTime?: boolean;
      /**
       * Return timezone
       */
      timezone?: boolean;
      /**
       * Return timezone offset
       */
      offset?: boolean;
      /**
       * Return date in current locale
       */
      locale?: boolean;
      /**
       * Return date in iso format
       */
      iso?: boolean;
    }
  | "format"
  | "timestamp"
  | "humanTime"
  | "locale"
  | "iso";

/**
 * Allowed value types in a response schema body.
 * - Cast type string for primitive fields (e.g. "string", "number")
 * - ResourceConstructor for a single nested resource object
 * - [ResourceConstructor] (tuple) for an array of a nested resource
 */
export type ResponseBodyValue =
  ResourceOutputValueCastType | ResourceConstructor | [ResourceConstructor];

/**
 * Response schema for a controller — used for documentation / OpenAPI generation.
 * Keyed by HTTP status code, each entry declares the expected response body shape.
 */
export type ResponseSchema = {
  [statusCode in ResponseStatus]?: {
    body: Record<string, ResponseBodyValue>;
  };
};

/**
 * Collapse `any` to `unknown` so an untyped resolver never leaks `any` into a resource output.
 */
type AnyToUnknown<T> = 0 extends 1 & T ? unknown : T;

/**
 * Output type of a single (suffix-free) cast.
 *
 * `date` is the DEFAULT date output of `ResourceFieldBuilder` (iso, format, timestamp and
 * humanTime are on; timezone, locale and offset are off). A date field customised through a
 * builder (`dateOptions()`) is a builder field and resolves to `unknown`.
 */
export type BaseCastOutput<C extends string> = C extends
  | "string"
  | "localized"
  | "url"
  | "uploadsUrl"
  | "storageUrl"
  ? string
  : C extends "number" | "float" | "int"
    ? number
    : C extends "boolean"
      ? boolean
      : C extends "object"
        ? Record<string, unknown>
        : C extends "array"
          ? unknown[]
          : C extends "date"
            ? { iso: string; format: string; timestamp: number; humanTime: string }
            : unknown;

/**
 * Output type of a cast string, including its `[]`, `?` and `[]?` suffixes.
 * `?` means "always present, value or null" (not an optional key).
 *
 * @example
 * CastOutput<"number">    // number
 * CastOutput<"string?">   // string | null
 * CastOutput<"string[]">  // string[]
 * CastOutput<"url[]?">    // string[] | null
 */
export type CastOutput<C extends string> = C extends `${infer B}[]?`
  ? BaseCastOutput<B>[] | null
  : C extends `${infer B}[]`
    ? BaseCastOutput<B>[]
    : C extends `${infer B}?`
      ? BaseCastOutput<B> | null
      : BaseCastOutput<C>;

/**
 * Output type of one schema field.
 *
 * `Root` is the schema of the resource being defined, used to resolve `"self"` and `"self[]"`.
 * Anything that cannot be inferred statically (builders) is `unknown`, never `any`.
 */
export type FieldOutput<F, Root extends ResourceSchema = ResourceSchema> = F extends "self"
  ? ResourceOutputOf<Root, Root>
  : F extends "self[]"
    ? ResourceOutputOf<Root, Root>[]
    : F extends string
      ? CastOutput<F>
      : F extends readonly [string, infer C extends string]
        ? CastOutput<C>
        : F extends ResourceFieldBuilder
          ? unknown
          : F extends Lazy<infer R>
            ? FieldOutput<R, Root>
            : F extends { readonly __type: "arrayOf"; readonly schema: infer Item extends ResourceSchema }
              ? ResourceOutputOf<Item, Root>[]
              : F extends new (...args: any[]) => { toJSON(): infer O }
                ? AnyToUnknown<O>
                : F extends (...args: any[]) => infer R
                  ? AnyToUnknown<R>
                  : unknown;

/**
 * JSON output type inferred from a resource schema.
 *
 * @example
 * type UserJson = ResourceOutputOf<{ id: "number"; name: "string?" }>;
 * // { id: number; name: string | null }
 */
export type ResourceOutputOf<S extends ResourceSchema, Root extends ResourceSchema = S> = {
  -readonly [K in keyof S]: FieldOutput<S[K], Root>;
};

/**
 * JSON output type of a resource class or of a resource instance.
 *
 * @example
 * type UserJson = ResourceOutput<typeof UserResource>;
 * type SameJson = ResourceOutput<InstanceType<typeof UserResource>>;
 */
export type ResourceOutput<R> = R extends new (...args: any[]) => { toJSON(): infer O }
  ? O
  : R extends { toJSON(): infer O }
    ? O
    : never;
