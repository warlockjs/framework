import { ResponseStatus } from "../http/response.mjs";
import { ResourceFieldBuilder } from "./resource-field-builder.mjs";
import { ResourceConstructor, ResourceContract } from "./resource.mjs";
import { Lazy } from "@mongez/reinforcements";

//#region ../../@warlock.js/core/src/resource/types.d.ts
type ResourceOutputValueCastType = "string" | "number" | "date" | "localized" | "boolean" | "url" | "float" | "int" | "object" | "array" | "uploadsUrl"
/**
 * Storage url means the value will be generated using current storage.url method
 */
| "storageUrl";
/**
 * Self-referencing type — resolves the field using the same resource class.
 * - `"self"` for a single nested self-reference
 * - `"self[]"` for an array of self-references
 */
type ResourceSelfReference = "self" | "self[]";
/**
 * Cast type with modifier suffixes for use in resource schemas.
 * - `[]` suffix declares the field as an array (e.g. "string[]")
 * - `?` suffix declares the field as nullable — always present in output, value or null (e.g. "number?")
 * - Combined: `[]` must come before `?` (e.g. "string[]?")
 */
type ResourceCastType = ResourceOutputValueCastType | `${ResourceOutputValueCastType}[]` | `${ResourceOutputValueCastType}?` | `${ResourceOutputValueCastType}[]?`;
type ResourceArraySchema = {
  __type: "arrayOf";
  schema: Record<string, ResourceFieldConfig>;
};
type ResourceFieldConfig = ResourceCastType | ResourceConstructor | ResourceSelfReference | Lazy<ResourceConstructor> | [string, ResourceCastType] | ResourceFieldBuilder | ResourceArraySchema | ((value: any, resource: ResourceContract) => any);
type ResourceSchema = Record<string, ResourceFieldConfig>;
type ResourceFieldBuilderDateOutputOptions = {
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
} | "format" | "timestamp" | "humanTime" | "locale" | "iso";
/**
 * Allowed value types in a response schema body.
 * - Cast type string for primitive fields (e.g. "string", "number")
 * - ResourceConstructor for a single nested resource object
 * - [ResourceConstructor] (tuple) for an array of a nested resource
 */
type ResponseBodyValue = ResourceOutputValueCastType | ResourceConstructor | [ResourceConstructor];
/**
 * Response schema for a controller — used for documentation / OpenAPI generation.
 * Keyed by HTTP status code, each entry declares the expected response body shape.
 */
type ResponseSchema = { [statusCode in ResponseStatus]?: {
  body: Record<string, ResponseBodyValue>;
} };
//#endregion
export { ResourceArraySchema, ResourceCastType, ResourceFieldBuilderDateOutputOptions, ResourceFieldConfig, ResourceOutputValueCastType, ResourceSchema, ResourceSelfReference, ResponseBodyValue, ResponseSchema };
//# sourceMappingURL=types.d.mts.map