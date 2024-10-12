import { get } from "@mongez/reinforcements";
import {
  isEmail,
  isEmpty,
  isNumeric,
  isPlainObject,
} from "@mongez/supportive-is";
import { Aggregate } from "src/cascade";
import { UploadedFile } from "src/warlock/http";
import type { SchemaRule } from "./types";
import { VALID_RULE, invalidRule, setKeyPath } from "./utils";

export const requiredRule: SchemaRule = {
  name: "required",
  defaultErrorMessage: "The :input is required",
  requiresValue: false,
  sortOrder: -2, // make sure this rule is executed first
  async validate(value: any, context) {
    if (isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredWithRule: SchemaRule = {
  name: "requiredWith",
  description: "The field is required if another field is present",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const otherField = this.context.options.field;

    const fieldValue = get(context.allValues, otherField);

    if ([undefined, null].includes(fieldValue)) {
      return VALID_RULE;
    }

    if (isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredWithAllRule: SchemaRule = {
  name: "requiredWithAll",
  description: "The field is required if all other fields are present",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const fields = this.context.options.fields;

    for (const field of fields) {
      const fieldValue = get(context.allValues, field);

      if ([undefined, null].includes(fieldValue)) {
        return VALID_RULE;
      }
    }

    if (isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredIfAbsentRule: SchemaRule = {
  name: "requiredIfAbsent",
  description: "The field is required if another field is absent",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const otherField = this.context.options.field;

    const fieldValue = get(context.allValues, otherField);
    const isPresent = ![undefined, null].includes(fieldValue);

    if (!isPresent && isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredIfAllAbsentRule: SchemaRule = {
  name: "requiredIfAllAbsent",
  description: "The field is required if all other fields are absent",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const fields = this.context.options.fields;

    let isPresent = false;

    for (const field of fields) {
      const fieldValue = get(context.allValues, field);

      if (![undefined, null].includes(fieldValue)) {
        isPresent = true;
        break;
      }
    }

    if (!isPresent && isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredIfEmptyRule: SchemaRule = {
  name: "requiredIfEmpty",
  description: "The field is required if another field is empty",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const otherField = this.context.options.field;

    const fieldValue = get(context.allValues, otherField);

    if (isEmpty(fieldValue) && isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredIfAllEmptyRule: SchemaRule = {
  name: "requiredIfAllEmpty",
  description: "The field is required if all other fields are empty",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const fields = this.context.options.fields;

    let allEmpty = true;

    for (const field of fields) {
      const fieldValue = get(context.allValues, field);

      if (!isEmpty(fieldValue)) {
        allEmpty = false;
        break;
      }
    }

    if (allEmpty && isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredIfFieldRule: SchemaRule = {
  name: "requiredIfField",
  description: "The field is required if another field has a specific value",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const otherField = this.context.options.field;
    const otherFieldValue = this.context.options.value;

    if (otherField === undefined) {
      throw new Error("The field option is required for requiredIfField rule");
    }

    const fieldValue = get(context.allValues, otherField);

    if (fieldValue === otherFieldValue && isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const requiredUnlessFieldRule: SchemaRule = {
  name: "requiredUnlessField",
  description:
    "The field is required unless another field has a specific value",
  sortOrder: -2,
  requiresValue: false,
  errorMessage: "The :input is required",
  async validate(value: any, context) {
    const otherField = this.context.options.field;
    const otherFieldValue = this.context.options.value;

    const fieldValue = get(context.allValues, otherField);

    if (fieldValue !== otherFieldValue && isEmpty(value)) {
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const objectRule: SchemaRule = {
  name: "object",
  defaultErrorMessage: "The :input must be an object",
  async validate(value: any, context) {
    if (isPlainObject(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const arrayRule: SchemaRule = {
  name: "array",
  defaultErrorMessage: "The :input must be an array",
  async validate(value: any, context) {
    if (Array.isArray(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const stringRule: SchemaRule = {
  name: "string",
  errorMessage: "The :input must be a string",
  async validate(value: any, context) {
    if (typeof value === "string") {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const numberRule: SchemaRule = {
  name: "number",
  errorMessage: "The :input must be a number",
  async validate(value: any, context) {
    if (typeof value === "number") {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const booleanRule: SchemaRule = {
  name: "boolean",
  errorMessage: "The :input must be a boolean",
  async validate(value: any, context) {
    if (typeof value === "boolean") {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const intRule: SchemaRule = {
  name: "int",
  errorMessage: "The :input must be an integer",
  async validate(value: any, context) {
    if (Number.isInteger(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const floatRule: SchemaRule = {
  name: "float",
  errorMessage: "The :input must be a float",
  async validate(value: any, context) {
    if (Number.isFinite(value) && !Number.isInteger(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const inRule: SchemaRule = {
  name: "in",
  errorMessage: "The :input must be one of the following values: :options",
  async validate(value: any, context) {
    if (this.context.options.values.includes(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const enumRule = inRule;

export const notInRule: SchemaRule = {
  name: "notIn",
  errorMessage: "The :input must not be one of the following values: :options",
  async validate(value: any, context) {
    if (!this.context.options.values.includes(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const minLengthRule: SchemaRule = {
  name: "minLength",
  errorMessage: `The :input must be at least :minLength characters long`,
  async validate(value: any, context) {
    if (value?.length >= this.context.options.minLength) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const maxLengthRule: SchemaRule = {
  name: "maxLength",
  errorMessage: `The :input must not exceed :maxLength characters`,
  async validate(value: any, context) {
    if (value?.length <= this.context.options.maxLength) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const lengthRule: SchemaRule = {
  name: "length",
  errorMessage: `The :input must be exactly :length characters long`,
  async validate(value: any, context) {
    if (value?.length === this.context.options.length) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const minRule: SchemaRule = {
  name: "min",
  errorMessage: `The :input must be at least :min`,
  async validate(value: any, context) {
    if (value >= this.context.options.min) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const maxRule: SchemaRule = {
  name: "max",
  errorMessage: `The :input must equal to or less than :max`,
  async validate(value: any, context) {
    if (value <= this.context.options.max) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const betweenRule: SchemaRule = {
  name: "between",
  errorMessage: `The :input must be between :min and :max`,
  async validate(value: any, context) {
    if (
      value >= this.context.options.min &&
      value <= this.context.options.max
    ) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const presentRule: SchemaRule = {
  name: "present",
  errorMessage: "The :input must be present",
  async validate(value: any, context) {
    if (value !== undefined) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const equalRule: SchemaRule = {
  name: "equal",
  errorMessage: `The :input must be equal to :value`,
  async validate(input: any, context) {
    if (input === this.context.options.value) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const emailRule: SchemaRule = {
  name: "email",
  errorMessage: "The :input must be a valid email address",
  async validate(value: any, context) {
    if (isEmail(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const scalarRule: SchemaRule = {
  name: "scalar",
  errorMessage: "The :input must be a scalar value",
  async validate(value: any, context) {
    // a valid value considered to beb either a string, number, or boolean
    if (["string", "number", "boolean"].includes(typeof value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const unknownKeyRule: SchemaRule = {
  name: "unknownKey",
  sortOrder: -1,
  errorMessage: "The :input contains unknown properties",
  async validate(value: any, context) {
    const schema = this.context.options.schema;
    const allowedKeys = this.context.options.allowedKeys || [];

    for (const key in value) {
      if (!schema[key] && !allowedKeys.includes(key)) {
        this.context.options.key = setKeyPath(context.path, key);
        const newContext = {
          ...context,
          key,
          path: setKeyPath(context.path, key),
        };

        return invalidRule(this, newContext);
      }
    }

    return VALID_RULE;
  },
};

export const matchesRule: SchemaRule = {
  name: "matches",
  errorMessage: "The :input must match the :field",
  async validate(value: any, context) {
    const otherField = this.context.options.field;

    if (value === get(context.allValues, otherField)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const confirmedRule: SchemaRule = {
  name: "confirmed",
  errorMessage: "The :input must be confirmed",
  async validate(value: any, context) {
    const otherField = `${this.context.options.field}_confirmation`;

    if (value === get(context.allValues, otherField)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const differentRule: SchemaRule = {
  name: "different",
  errorMessage: "The :input must be different from :field",
  async validate(value: any, context) {
    const otherField = this.context.options.field;

    if (value !== get(context.allValues, otherField)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const dateRule: SchemaRule = {
  name: "date",
  errorMessage: "The :input must be a valid date",
  async validate(value: any, context) {
    if (new Date(value).toString() !== "Invalid Date") {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

// Must be used with Date mutator
export const minDateRule: SchemaRule = {
  name: "minDate",
  description: "The field must be at least the given date",
  errorMessage: `The :input must be at least :minDate`,
  async validate(value: Date, context) {
    if (value >= this.context.options.minDate) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

// Must be used with Date mutator
export const maxDateRule: SchemaRule = {
  name: "maxDate",
  errorMessage: `The :input must be at most :maxDate`,
  async validate(value: Date, context) {
    if (value <= this.context.options.maxDate) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const urlRule: SchemaRule = {
  name: "url",
  errorMessage: "The :input must be a valid URL",
  async validate(value: any, context) {
    try {
      new URL(value);
      return VALID_RULE;
    } catch (error) {
      return invalidRule(this, context);
    }
  },
};

export const isNumericRule: SchemaRule = {
  name: "isNumeric",
  errorMessage: "The :input must be a numeric value",
  async validate(value: any, context) {
    if (isNumeric(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const alphaRule: SchemaRule = {
  name: "alpha",
  errorMessage: "The :input must contain only alphabetic characters",
  async validate(value: any, context) {
    if (/^[a-zA-Z]+$/.test(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const alphaNumericRule: SchemaRule = {
  name: "alphaNumeric",
  errorMessage:
    "The :input must contain only alphabetic and numeric characters",
  async validate(value: any, context) {
    if (/^[a-zA-Z0-9]+$/.test(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const jsonRule: SchemaRule = {
  name: "json",
  errorMessage: "The :input must be a valid JSON string",
  async validate(value: string, context) {
    try {
      JSON.parse(value);
      return VALID_RULE;
    } catch (error) {
      return invalidRule(this, context);
    }
  },
};

export const patternRule: SchemaRule = {
  name: "pattern",
  errorMessage: "The :input does not match the pattern",
  async validate(value: any, context) {
    if (this.context.options.pattern.test(value)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const sumOfRule: SchemaRule = {
  name: "sumOf",
  description: "The sum of the fields must be equal to the given value",
  errorMessage: "The sum of the fields must be equal to :value",
  async validate(value: any, context) {
    const fields = this.context.options.fields;

    let sum = 0;

    for (const field of fields) {
      sum += get(context.allValues, field);
    }

    if (sum === value) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const isCreditCardRule: SchemaRule = {
  name: "isCreditCard",
  description: "The field must be a valid credit card number",
  errorMessage: "The :input must be a valid credit card number",
  async validate(value: any, context) {
    // Luhn algorithm
    const cardNumber = value.toString().replace(/\D/g, "");

    let sum = 0;
    let isEven = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i]);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    if (sum % 10 === 0) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const positiveRule: SchemaRule = {
  name: "positive",
  errorMessage: "The :input must be a positive number",
  async validate(value: any, context) {
    if (value > 0) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const negativeRule: SchemaRule = {
  name: "negative",
  errorMessage: "The :input must be a negative number",
  async validate(value: any, context) {
    if (value < 0) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

// unique for array
export const uniqueArrayRule: SchemaRule = {
  name: "uniqueArray",
  description: "The array must contain unique values",
  errorMessage: "The :input must contain unique values",
  async validate(value: any, context) {
    const uniqueValues = new Set(value);

    if (uniqueValues.size === value.length) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const domainUrl: SchemaRule = {
  name: "domainUrl",
  description: "The input must be a valid domain not a full URL",
  errorMessage: "The :input must be a valid domain",
  async validate(value: any, context) {
    if (value.match(/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/)) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export type UniqueRuleOptions = {
  query?: (options: {
    query: Aggregate;
    value: any;
    allValues: any;
  }) => void | Promise<void>;
  except?: string;
  column?: string;
  exceptColumnName?: string;
  exceptValue?: any;
};

/**
 * Unique rule works with database
 */
export const uniqueRule: SchemaRule = {
  name: "unique",
  errorMessage: "The :input must be unique",
  async validate(value: any, context) {
    const {
      Model,
      except,
      column = context.key,
      exceptColumnName,
      exceptValue,
      query,
    } = this.context.options;

    const dbQuery: Aggregate =
      typeof Model !== "string" ? Model.aggregate() : new Aggregate(Model);

    dbQuery.where(column, value);

    if (except) {
      const exceptValue = get(context.allValues, except);

      if (exceptValue !== undefined) {
        dbQuery.where(except, "!=", exceptValue);
      }
    }

    if (exceptValue !== undefined) {
      dbQuery.where(exceptColumnName ?? context.key, "!=", exceptValue);
    }

    if (query) {
      await query({
        query: dbQuery,
        value,
        allValues: context.allValues,
      });
    }

    const document = await dbQuery.first();

    if (!document) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export type ExistsRuleOptions = {
  column?: string;
  query?: (options: {
    query: Aggregate;
    value: any;
    allValues: any;
  }) => void | Promise<void>;
};

export const existsRule: SchemaRule = {
  name: "exists",
  errorMessage: "The :input must exist",
  async validate(value: any, context) {
    const { Model, query, column = context.key } = this.context.options;

    const dbQuery: Aggregate =
      typeof Model !== "string" ? Model.aggregate() : new Aggregate(Model);

    dbQuery.where(column, value);

    if (query) {
      await query({
        query: dbQuery,
        value,
        allValues: context.allValues,
      });
    }

    const document = await dbQuery.first();

    if (document) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const fileRile: SchemaRule = {
  name: "file",
  errorMessage: "The :input must be a file",
  async validate(value: any, context) {
    if (value instanceof UploadedFile) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const maxFileSizeRule: SchemaRule = {
  name: "maxFileSize",
  errorMessage: "The :input must not exceed :maxFileSize",
  async validate(value: any, context) {
    if (value.size <= this.context.options.maxFileSize) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const minFileSizeRule: SchemaRule = {
  name: "minFileSize",
  errorMessage: "The :input must be at least :minFileSize",
  async validate(value: any, context) {
    if (value.size >= this.context.options.minFileSize) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const imageRule: SchemaRule = {
  name: "image",
  errorMessage: "The :input must be an image",
  async validate(value: any, context) {
    if (value instanceof UploadedFile && value.isImage) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const minWidthRule: SchemaRule = {
  name: "minWidth",
  errorMessage: "The :input must be at least :minWidth pixels wide",
  async validate(value: any, context) {
    const dimensions = await value.dimensions();

    if (dimensions.width >= this.context.options.minWidth) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const maxWidthRule: SchemaRule = {
  name: "maxWidth",
  errorMessage: "The :input must be at most :maxWidth pixels wide",
  async validate(value: any, context) {
    const dimensions = await value.dimensions();

    if (dimensions.width <= this.context.options.maxWidth) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const minHeightRule: SchemaRule = {
  name: "minHeight",
  errorMessage: "The :input must be at least :minHeight pixels tall",
  async validate(value: any, context) {
    const dimensions = await value.dimensions();

    if (dimensions.height >= this.context.options.minHeight) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};

export const maxHeightRule: SchemaRule = {
  name: "maxHeight",
  errorMessage: "The :input must be at most :maxHeight pixels tall",
  async validate(value: any, context) {
    const dimensions = await value.dimensions();

    if (dimensions.height <= this.context.options.maxHeight) {
      return VALID_RULE;
    }

    return invalidRule(this, context);
  },
};
