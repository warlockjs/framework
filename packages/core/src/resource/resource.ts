import { get, set, type GenericObject } from "@mongez/reinforcements";
import { Model } from "@warlock.js/cascade";
import { useRequestStore } from "../http/context/request-context";
import { ResourceFieldBuilder } from "./resource-field-builder";
import {
  ResourceArraySchema,
  ResourceFieldConfig,
  ResourceOutputValueCastType,
  ResourceSchema,
} from "./types";

export class Resource {
  /**
   * Resource data
   */
  public resource: GenericObject = {};

  /**
   * Resource final output
   */
  public data: GenericObject = {};

  /**
   * Output shape
   */
  public schema: ResourceSchema = {};

  /**
   * Constructor
   */
  public constructor(protected originalData: GenericObject | Resource | Model) {
    if (this.originalData instanceof Model) {
      this.resource = this.originalData.data;
    } else if (this.originalData instanceof Resource) {
      this.resource = this.originalData.data;
    } else {
      this.resource = this.originalData;
    }
  }

  /**
   * Convert resource to JSON
   */
  public toJSON() {
    this.boot();
    this.transformOutput();
    this.extend();

    return this.data;
  }

  /**
   * Boot method
   * Called before transforming the resource
   */
  protected boot() {
    //
  }

  /**
   * Transform resource to output
   */
  protected transformOutput() {
    const localeCode = useRequestStore()?.request?.locale;
    for (const [outputKey, outputSettings] of Object.entries(this.schema)) {
      let fieldKey = outputKey;
      let valueTransformType = outputSettings as ResourceFieldConfig;

      if (Array.isArray(outputSettings)) {
        fieldKey = outputSettings[0];
        valueTransformType = outputSettings[1];
      }

      const inputValue = this.get(fieldKey);
      let outputValue: any;

      if (Array.isArray(inputValue)) {
        outputValue = inputValue
          .map((item) => {
            const outputValue = this.transformValue(item, valueTransformType, localeCode);
            if (outputValue !== undefined) {
              return outputValue;
            }
          })
          .filter((value) => value !== undefined);
      } else {
        outputValue = this.transformValue(inputValue, valueTransformType, localeCode);
      }

      if (outputValue !== undefined) {
        this.set(outputKey, outputValue);
      }
    }
  }

  /**
   * Transform the given value with given type
   */
  public transform(value: any, type: ResourceOutputValueCastType, locale?: string) {
    return new ResourceFieldBuilder(type).transform(value, locale);
  }

  /**
   * Transform the given value for the given output
   */
  protected transformValue(value: any, outputSettings: ResourceFieldConfig, locale?: string) {
    let outputValue: any;

    // now check the value transform type
    // if it's prototype instanceof Resource, then it's a nested resource
    // if it's a function (but not a Resource class), then it's a resolver function
    // if it's an instance of ResourceFieldBuilder, then it's a field builder
    // if it's a ResourceArraySchema, then it's an array schema
    // if it's a string, then it's a field cast type
    if (typeof outputSettings === "function" && outputSettings.prototype instanceof Resource) {
      outputValue = new (outputSettings as typeof Resource)(value).toJSON();
    } else if (typeof outputSettings === "function") {
      // Handle resolver function - bind to Resource instance for access to this.get(), etc.
      outputValue = (outputSettings as Function).call(this, value, this);
    } else if (outputSettings instanceof ResourceFieldBuilder) {
      const inputKey = outputSettings.getInputKey();
      outputValue = outputSettings.transform(inputKey ? this.get(inputKey) : value, locale);
    } else if (
      typeof outputSettings === "object" &&
      outputSettings !== null &&
      "__type" in outputSettings &&
      outputSettings.__type === "arrayOf"
    ) {
      // Handle array schema - value here is a single array item, not the whole array
      // The parent transformOutput already handles the array mapping
      outputValue = this.transformArrayItem(value, outputSettings.schema, locale);
    } else if (typeof outputSettings === "string") {
      outputValue = new ResourceFieldBuilder(
        outputSettings as ResourceOutputValueCastType,
      ).transform(value, locale);
    }

    return outputValue;
  }

  /**
   * Extend the resource output
   */
  protected extend() {
    //
  }

  /**
   * Transform a single array item according to the given schema
   */
  protected transformArrayItem(
    item: any,
    schema: Record<string, ResourceFieldConfig>,
    locale?: string,
  ) {
    const transformedItem: GenericObject = {};

    for (const [outputKey, outputSettings] of Object.entries(schema)) {
      let fieldKey = outputKey;
      let valueTransformType = outputSettings as ResourceFieldConfig;

      if (Array.isArray(outputSettings)) {
        fieldKey = outputSettings[0];
        valueTransformType = outputSettings[1];
      }

      const inputValue = get(item, fieldKey);
      const outputValue = this.transformValue(inputValue, valueTransformType, locale);

      if (outputValue !== undefined) {
        set(transformedItem, outputKey, outputValue);
      }
    }

    return transformedItem;
  }

  /**
   * Get a input value for the given key
   */
  public get(key: string, defaultValue?: any) {
    return get(this.resource, key, defaultValue);
  }

  /**
   * Set the given value for the given field
   */
  public set(key: string, value: any) {
    set(this.data, key, value);

    return this;
  }

  /**
   * Create an array schema for transforming array items
   */
  public arrayOf(schema: Record<string, ResourceFieldConfig>): ResourceArraySchema {
    return {
      __type: "arrayOf",
      schema,
    };
  }

  /**
   * Get a string field builder
   */
  public string(inputKey?: string) {
    return this.fieldBuilder("string", inputKey);
  }

  /**
   * Get a date field builder
   */
  public date(inputKey?: string) {
    return this.fieldBuilder("date", inputKey);
  }

  /**
   * Get a localized field builder
   */
  public localized(inputKey?: string) {
    return this.fieldBuilder("localized", inputKey);
  }

  /**
   * Get a url field builder
   */
  public url(inputKey?: string) {
    return this.fieldBuilder("url", inputKey);
  }

  /**
   * Get a uploadsUrl field builder
   */
  public uploadsUrl(inputKey?: string) {
    return this.fieldBuilder("uploadsUrl", inputKey);
  }

  /**
   * Get a number field builder
   */
  public number(inputKey?: string) {
    return this.fieldBuilder("number", inputKey);
  }

  /**
   * Get a boolean field builder
   */
  public boolean(inputKey?: string) {
    return this.fieldBuilder("boolean", inputKey);
  }

  /**
   * Get a float field builder
   */
  public float(inputKey?: string) {
    return this.fieldBuilder("float", inputKey);
  }

  /**
   * Get a int field builder
   */
  public int(inputKey?: string) {
    return this.fieldBuilder("int", inputKey);
  }

  /**
   * New field builder
   */
  protected fieldBuilder(type: ResourceOutputValueCastType, inputKey?: string) {
    const builder = new ResourceFieldBuilder(type);

    if (inputKey) {
      builder.setInputKey(inputKey);
    }

    return builder;
  }
}
