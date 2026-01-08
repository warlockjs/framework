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

export type ResourceArraySchema = {
  __type: "arrayOf";
  schema: Record<string, ResourceFieldConfig>;
};

export type ResourceFieldConfig =
  | ResourceOutputValueCastType
  | ResourceConstructor
  | [string, ResourceOutputValueCastType]
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
      human?: boolean;
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
    }
  | "format"
  | "timestamp"
  | "human"
  | "locale";
