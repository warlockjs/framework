/**
 * Framework Validator Type Augmentations
 *
 * Augments core validators with framework-specific methods. The base
 * `unique()` / `exists()` augmentations now live in `@warlock.js/cascade`
 * (where their implementations were moved). This file only declares the
 * request-aware variants that depend on core's HTTP helpers.
 */

import type { ChildModel, Model } from "@warlock.js/cascade";
import type {
  ArrayValidator,
  BaseValidator,
  Infer,
  ObjectValidator,
  StandardSchemaV1,
  StringValidator,
  TranslateAttributeCallback,
  TranslateRuleCallback,
  ValidationResult,
} from "@warlock.js/seal";
import type { UploadedFile } from "../http";
import type { Route } from "../router/types";
import type {
  ExistsExceptCurrentIdRuleOptions,
  ExistsExceptCurrentUserRuleOptions,
  UniqueExceptCurrentIdRuleOptions,
  UniqueExceptCurrentUserRuleOptions,
} from "./database";
import type { FileValidator } from "./validators";

/**
 * The object shape produced by `v.localized()`'s inner `v.object({
 * localeCode, value })` — kept in sync with `localizedPlugin`'s runtime
 * implementation (`core/src/validation/plugins/localized-plugin.ts`).
 */
type LocalizedEntryValidator<T extends BaseValidator> = ObjectValidator<{
  localeCode: StringValidator & StandardSchemaV1<string>;
  value: T;
}> &
  StandardSchemaV1<{
    localeCode: string;
    value: Infer<T>;
  }>;

// Type augmentation for v factory and validators
declare module "@warlock.js/seal" {
  // Augment the v factory with file() method
  export interface ValidatorV {
    file: (errorMessage?: string) => FileValidator & StandardSchemaV1<UploadedFile>;
    localized: <
      T extends BaseValidator = ScalarValidator & StandardSchemaV1<string | number | boolean>,
    >(
      valueValidator?: T,
      errorMessage?: string,
    ) => ArrayValidator & {
      validator: LocalizedEntryValidator<T>;
    } & StandardSchemaV1<
        Array<{
          localeCode: string;
          value: Infer<T>;
        }>
      >;
  }

  interface ScalarValidator {
    /** Value must be unique in database except current user */
    uniqueExceptCurrentUser(
      model: ChildModel<Model> | string,
      optionsList?: Partial<UniqueExceptCurrentUserRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must be unique in database except current id */
    uniqueExceptCurrentId(
      model: ChildModel<Model> | string,
      optionsList?: Partial<UniqueExceptCurrentIdRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must exist in database except current user */
    existsExceptCurrentUser(
      model: ChildModel<Model> | string,
      optionsList?: Partial<ExistsExceptCurrentUserRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must exists in database except current id */
    existsExceptCurrentId(
      model: ChildModel<Model> | string,
      optionsList?: Partial<ExistsExceptCurrentIdRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
  }

  // StringValidator gets same database methods
  interface StringValidator {
    uniqueExceptCurrentUser(
      model: ChildModel<Model> | string,
      optionsList?: Partial<UniqueExceptCurrentUserRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
    uniqueExceptCurrentId(
      model: ChildModel<Model> | string,
      optionsList?: Partial<UniqueExceptCurrentIdRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
    existsExceptCurrentUser(
      model: ChildModel<Model> | string,
      optionsList?: Partial<ExistsExceptCurrentUserRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
    existsExceptCurrentId(
      model: ChildModel<Model> | string,
      optionsList?: Partial<ExistsExceptCurrentIdRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
  }
}

// Export database types for use in validators
export type {
  ExistsExceptCurrentIdRuleOptions,
  ExistsExceptCurrentUserRuleOptions,
  UniqueExceptCurrentIdRuleOptions,
  UniqueExceptCurrentUserRuleOptions,
} from "./database";

/**
 * `validation.response`: how a failed schema validation is answered.
 */
export type ValidationResponseConfiguration = {
  /**
   * Key holding the list of field errors in the framework body.
   *
   * @default "errors"
   */
  errors?: string;
  /**
   * Key holding the field name in each error.
   *
   * @default "input"
   */
  inputKey?: string;
  /**
   * Key holding the message in each error.
   *
   * @default "error"
   */
  inputError?: string;
  /**
   * Status of a failed schema validation, including a body returned by
   * `body` or by a route's `onFailure` hook without its own `status`.
   *
   * @default 422
   */
  status?: number;
  /**
   * Build the failure body for every route, instead of the framework's
   * `{ errors: [...] }`. Return `undefined` to keep the framework body for a
   * route. A route's own `validation.onFailure` wins over this hook.
   *
   * @example
   * response: {
   *   status: 400,
   *   body: (result, route) => ({ error: `${route.name}.invalid`, fields: result.errors.length }),
   * },
   */
  body?: (result: ValidationResult, route: Route) => unknown;
};

export type ValidationConfiguration = {
  /**
   * How a failed schema validation is answered: the framework body's keys,
   * its status, or a `body` hook that replaces it.
   */
  response?: ValidationResponseConfiguration;
  /**
   * Status sent when a custom `validation.validate` middleware returns a
   * value that is not a `Response`.
   *
   * @default 400
   */
  responseStatus?: number;
  // TODO: Map error messages and inputs keys through configurations.
  /**
   * Translation group that will be prefixed the rules
   * For example required rule translation will be taken from validation.required
   * To remove group keep the key as empty string
   * @default validation
   */
  translationGroup?: string;
  /**
   * Attribute group that will be prefixed the attributes
   * For example name attribute translation will be taken from attributes.name
   * To remove group keep the key as empty string
   * @default attributes
   */
  attributeGroup?: string;
  /**
   * Whether to show only the first error or all errors
   * @default true
   */
  firstErrorOnly?: boolean;
  /**
   * Function to translate the rule
   * Could be useful for handling translation in another way than Warlcok.js framework handles it
   */
  translateRule?: TranslateRuleCallback;
  /**
   * Function to translate the attribute
   */
  translateAttribute?: TranslateAttributeCallback;
};
