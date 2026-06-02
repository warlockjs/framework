import { ResourceFieldBuilder } from "./resource-field-builder.mjs";
import { ResourceArraySchema, ResourceFieldConfig, ResourceOutputValueCastType, ResourceSchema } from "./types.mjs";
import { Model } from "@warlock.js/cascade";
import { GenericObject } from "@mongez/reinforcements";

//#region ../../@warlock.js/core/src/resource/resource.d.ts
/**
 * Resource contract
 */
interface ResourceContract {
  /**
   * Resource data
   */
  resource: GenericObject;
  /**
   * Resource final output
   */
  data: GenericObject;
  /**
   * Original data
   */
  originalData: GenericObject;
  /**
   * Convert resource to JSON
   */
  toJSON(): GenericObject;
  /**
   * Transform the given value with given type
   */
  transform(value: any, type: ResourceOutputValueCastType, locale?: string): any;
  /**
   * Get a input value for the given key
   */
  get(key: string, defaultValue?: any): any;
  /**
   * Set the given value for the given field
   */
  set(key: string, value: any): ResourceContract;
  /**
   * Create an array schema for transforming array items
   */
  arrayOf(schema: Record<string, ResourceFieldConfig>): ResourceArraySchema;
  /**
   * Get a string field builder
   */
  string(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a date field builder
   */
  date(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a localized field builder
   */
  localized(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a url field builder
   */
  url(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a uploadsUrl field builder
   */
  uploadsUrl(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a number field builder
   */
  number(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a boolean field builder
   */
  boolean(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a float field builder
   */
  float(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a int field builder
   */
  int(inputKey?: string): ResourceFieldBuilder;
}
/**
 * Resource constructor
 */
interface ResourceConstructor {
  new (originalData: GenericObject | Resource | Model): ResourceContract;
}
declare class Resource implements ResourceContract {
  originalData: GenericObject | Resource | Model;
  /**
   * Resource data
   */
  resource: GenericObject;
  /**
   * Resource final output
   */
  data: GenericObject;
  /**
   * Tracks visited object identities during self-reference recursion.
   * Prevents infinite loops on circular data (e.g. A.parent → B, B.parent → A).
   */
  protected _selfSeen?: Set<unknown>;
  /**
   * Raw resource schema — field declarations as written by the developer.
   * Used by doc generators for introspection.
   */
  static schema: ResourceSchema;
  /**
   * Normalized schema — all string cast types and tuples converted to
   * ResourceFieldBuilder instances at definition time. Used by transformOutput at runtime.
   */
  static parsedSchema: Record<string, ResourceFieldConfig>;
  /**
   * Normalize a raw schema into parsedSchema.
   * Converts string cast types (including suffixes) and tuples into pre-built builders.
   * Other entry types (ResourceConstructor, resolver functions, ResourceArraySchema) are kept as-is.
   */
  static normalizeSchema(schema: ResourceSchema): Record<string, ResourceFieldConfig>;
  /**
   * Constructor
   */
  constructor(originalData: GenericObject | Resource | Model);
  /**
   * Convert resource to JSON
   */
  toJSON(): GenericObject;
  /**
   * Boot method
   * Called before transforming the resource
   */
  protected boot(): void;
  /**
   * Transform resource to output using the pre-normalized parsedSchema.
   * Builders handle their own array/nullable logic internally.
   * ResourceConstructor and ResourceArraySchema handle arrays in transformValue.
   */
  protected transformOutput(): void;
  /**
   * Transform the given value with given type
   */
  transform(value: any, type: ResourceOutputValueCastType, locale?: string): any;
  /**
   * Transform the given value for the given output setting.
   * After normalization, string cast types no longer reach here — they are pre-converted to builders.
   */
  protected transformValue(value: any, outputSettings: ResourceFieldConfig, locale?: string): any;
  /**
   * Extend the resource output
   */
  protected extend(): void;
  /**
   * Transform a self-referencing field value.
   *
   * @example
   * // Single: parent: "self"
   * // Array:  children: "self[]"
   */
  protected transformSelfReference(value: any, isArray: boolean): any;
  /**
   * Resolve a single self-reference value.
   * Uses identity-based cycle detection (id/_id) and a max depth guard.
   */
  protected resolveSelf(value: any): any;
  /**
   * Transform a single array item according to the given schema
   */
  protected transformArrayItem(item: any, schema: Record<string, ResourceFieldConfig>, locale?: string): GenericObject;
  /**
   * Get a input value for the given key
   */
  get(key: string, defaultValue?: any): any;
  /**
   * Set the given value for the given field
   */
  set(key: string, value: any): ResourceContract;
  /**
   * Create an array schema for transforming array items
   */
  arrayOf(schema: Record<string, ResourceFieldConfig>): ResourceArraySchema;
  /**
   * Get a string field builder
   */
  string(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a date field builder
   */
  date(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a localized field builder
   */
  localized(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a url field builder
   */
  url(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a uploadsUrl field builder
   */
  uploadsUrl(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a number field builder
   */
  number(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a boolean field builder
   */
  boolean(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a float field builder
   */
  float(inputKey?: string): ResourceFieldBuilder;
  /**
   * Get a int field builder
   */
  int(inputKey?: string): ResourceFieldBuilder;
  /**
   * New field builder
   */
  protected fieldBuilder(type: ResourceOutputValueCastType, inputKey?: string): ResourceFieldBuilder;
}
//#endregion
export { Resource, ResourceConstructor, ResourceContract };
//# sourceMappingURL=resource.d.mts.map