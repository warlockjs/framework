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
  ScalarValidator,
  StandardSchemaV1,
  StringValidator,
  TranslateAttributeCallback,
  TranslateRuleCallback,
} from "@warlock.js/seal";
import type { UploadedFile } from "../http";
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
    uniqueExceptCurrentUser: ScalarValidator["uniqueExceptCurrentUser"];
    uniqueExceptCurrentId: ScalarValidator["uniqueExceptCurrentId"];
    existsExceptCurrentUser: ScalarValidator["existsExceptCurrentUser"];
    existsExceptCurrentId: ScalarValidator["existsExceptCurrentId"];
  }
}

// Export database types for use in validators
export type {
  ExistsExceptCurrentIdRuleOptions,
  ExistsExceptCurrentUserRuleOptions,
  UniqueExceptCurrentIdRuleOptions,
  UniqueExceptCurrentUserRuleOptions,
} from "./database";

export type ValidationConfiguration = {
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
