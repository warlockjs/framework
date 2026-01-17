import { isObject } from "@mongez/supportive-is";
import dayjs from "dayjs";
import { storage } from "../storage";
import { uploadsUrl, url } from "../utils/urls";
import { type LocalizedObject } from "./../utils/get-localized";
import { ResourceFieldBuilderDateOutputOptions, type ResourceOutputValueCastType } from "./types";

export class ResourceFieldBuilder {
  /**
   * Field value
   */
  protected fieldValue?: unknown;

  /**
   * Whether the value is nullable
   * If set to false and value is null, it will be returned as undefined
   */
  protected isNullable = false;

  /**
   * Default value
   */
  protected defaultValue?: unknown;

  /**
   * Date format
   */
  protected dateFormat = "DD-MM-YYYY hh:mm:ss A";

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
  protected dateOptionsInput: ResourceFieldBuilderDateOutputOptions = {
    format: true,
    timestamp: true,
    timezone: false,
    locale: false,
    offset: false,
    human: true,
  };

  /**
   * Constructor
   */
  public constructor(protected readonly type: ResourceOutputValueCastType) {
    //
  }

  /**
   * Set input key
   * Will be used in transformation if provided
   */
  public setInputKey(key: string) {
    this.inputKeyToUse = key;

    return this;
  }

  /**
   * Add a condition before transforming the value
   */
  public when(condition: () => boolean) {
    this.condition = condition;
    return this;
  }

  /**
   * Set whether the value is nullable
   */
  public nullable() {
    this.isNullable = true;
    return this;
  }

  /**
   * Get input key
   */
  public getInputKey() {
    return this.inputKeyToUse;
  }

  /**
   * Set default value
   */
  public default(value: unknown) {
    this.defaultValue = value;

    return this;
  }

  /**
   * Set field format
   */
  public format(format: string) {
    this.dateFormat = format;

    return this;
  }

  /**
   * Set date options
   * This will override current date options
   */
  public dateOptions(options: ResourceFieldBuilderDateOutputOptions) {
    this.dateOptionsInput = options;

    return this;
  }

  /**
   * Transform the value
   */
  public transform(value: any, locale?: string) {
    if (value === undefined) return this.defaultValue;

    if (this.condition && !this.condition()) return this.defaultValue;

    if (value === null) {
      return this.isNullable ? null : this.defaultValue;
    }

    switch (this.type) {
      case "string":
        return String(value);
      case "number":
        return Number(value);
      case "boolean":
        return Boolean(value);
      case "float":
        return parseFloat(value);
      case "int":
        return parseInt(value);
      case "date":
        return this.transformDate(value as string | Date, locale);
      case "localized":
        return this.transformLocalized(value as LocalizedObject[], locale);
      case "url":
        return url(value as string);
      case "uploadsUrl":
        return uploadsUrl(value as string);
      case "storageUrl":
        return storage.url(value as string);
      case "object":
        return isObject(value) && !Array.isArray(value) ? value : undefined;
      case "array":
        return Array.isArray(value) ? value : undefined;
    }
  }

  /**
   * Transform date value
   */
  protected transformDate(value: string | Date, locale?: string) {
    if (typeof this.dateOptionsInput === "string") {
      if (this.dateOptionsInput === "format") {
        return dayjs(value).format(this.dateFormat);
      }

      if (this.dateOptionsInput === "timestamp") {
        return dayjs(value).valueOf();
      }

      if (this.dateOptionsInput === "human") {
        return (dayjs as any)(value).fromNow();
      }

      if (this.dateOptionsInput === "locale") {
        if (!locale) {
          return dayjs(value).format(this.dateFormat);
        }

        return dayjs(value).locale(locale).format(this.dateFormat);
      }
    }

    // now manage it as an object based on date options what's marked as true
    const output: {
      format?: string;
      timestamp?: number;
      human?: string;
      locale?: string;
    } = {};

    let dayjsObject = dayjs(value);

    if (locale) {
      dayjsObject = dayjsObject.locale(locale);
    }

    if (this.dateOptionsInput.format) {
      output.format = dayjsObject.format(this.dateFormat);
    }

    if (this.dateOptionsInput.timestamp) {
      output.timestamp = dayjsObject.valueOf();
    }

    if (this.dateOptionsInput.human) {
      output.human = (dayjsObject as any).fromNow();
    }

    if (this.dateOptionsInput.locale) {
      output.locale = dayjsObject.format(this.dateFormat);
    }

    return output;
  }

  /**
   * Transform localized value
   */
  protected transformLocalized(value: LocalizedObject[] | string, locale?: string) {
    if (typeof value === "string") {
      return value;
    }

    if (!locale) {
      return value[0]?.value || value;
    }

    return value.find((item) => item.localeCode === locale)?.value;
  }
}
