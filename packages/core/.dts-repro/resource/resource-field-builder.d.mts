import { LocalizedObject } from "../utils/get-localized.mjs";
import { ResourceFieldBuilderDateOutputOptions, ResourceOutputValueCastType } from "./types.mjs";

//#region ../../@warlock.js/core/src/resource/resource-field-builder.d.ts
declare class ResourceFieldBuilder {
  protected readonly type: ResourceOutputValueCastType;
  /**
   * Field value
   */
  protected fieldValue?: unknown;
  /**
   * Whether the value is nullable
   * If set to false and value is null, it will be returned as undefined
   */
  protected isNullable: boolean;
  /**
   * Whether this field is an array
   * When true, transform() maps over each element using the base type
   */
  protected isArrayField: boolean;
  /**
   * Default value
   */
  protected defaultValue?: unknown;
  /**
   * Date format
   */
  protected dateFormat: string;
  /**
   * Input key
   */
  protected inputKeyToUse?: string;
  /**
   * Add a condition before transforming the value
   */
  protected condition?: () => boolean;
  /**
   * Define how date fields are returned
   * If type of the date options is string then it will be returned as a string
   * otherwise it will be returned as an object contains the date options
   */
  protected dateOptionsInput: ResourceFieldBuilderDateOutputOptions;
  /**
   * Constructor
   */
  constructor(type: ResourceOutputValueCastType);
  /**
   * Parse a cast type string (including suffixes) into a configured builder.
   * Suffix order: [] before ? (e.g. "string[]?")
   * Parsing strips right-to-left: ? first, then [].
   */
  static fromCastType(castType: string): ResourceFieldBuilder;
  /**
   * Set input key
   * Will be used in transformation if provided
   */
  setInputKey(key: string): this;
  /**
   * Add a condition before transforming the value
   */
  when(condition: () => boolean): this;
  /**
   * Set whether the value is nullable
   */
  nullable(): this;
  /**
   * Mark this field as an array
   * transform() will map over each element using the base type
   */
  array(): this;
  /**
   * Get input key
   */
  getInputKey(): string | undefined;
  /**
   * Set default value
   */
  default(value: unknown): this;
  /**
   * Set field format
   */
  format(format: string): this;
  /**
   * Set date options
   * This will override current date options
   */
  dateOptions(options: ResourceFieldBuilderDateOutputOptions): this;
  /**
   * Transform the value.
   * When isArrayField is true, maps over each element using transformSingleValue.
   */
  transform(value: any, locale?: string): any;
  /**
   * Transform a single value according to the base type.
   */
  protected transformSingleValue(value: any, locale?: string): any;
  /**
   * Transform date value
   */
  protected transformDate(value: string | Date, locale?: string): any;
  /**
   * Transform localized value
   */
  protected transformLocalized(value: LocalizedObject[] | string, locale?: string): any;
}
//#endregion
export { ResourceFieldBuilder };
//# sourceMappingURL=resource-field-builder.d.mts.map