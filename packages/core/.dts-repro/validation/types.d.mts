import { ExistsExceptCurrentIdRuleOptions, ExistsExceptCurrentUserRuleOptions, UniqueExceptCurrentIdRuleOptions, UniqueExceptCurrentUserRuleOptions } from "./database/types.mjs";
import { FileValidator } from "./validators/file-validator.mjs";
import { ArrayValidator, BaseValidator, TranslateAttributeCallback, TranslateRuleCallback } from "@warlock.js/seal";
import { ChildModel, Model } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/validation/types.d.ts
declare module "@warlock.js/seal" {
  interface ValidatorV {
    file: (errorMessage?: string) => FileValidator;
    localized: (valueValidator?: BaseValidator, errorMessage?: string) => ArrayValidator & {
      validator: BaseValidator;
    };
  }
  interface ScalarValidator {
    /** Value must be unique in database except current user */
    uniqueExceptCurrentUser(model: ChildModel<Model> | string, optionsList?: Partial<UniqueExceptCurrentUserRuleOptions> & {
      errorMessage?: string;
    }): this;
    /** Value must be unique in database except current id */
    uniqueExceptCurrentId(model: ChildModel<Model> | string, optionsList?: Partial<UniqueExceptCurrentIdRuleOptions> & {
      errorMessage?: string;
    }): this;
    /** Value must exist in database except current user */
    existsExceptCurrentUser(model: ChildModel<Model> | string, optionsList?: Partial<ExistsExceptCurrentUserRuleOptions> & {
      errorMessage?: string;
    }): this;
    /** Value must exists in database except current id */
    existsExceptCurrentId(model: ChildModel<Model> | string, optionsList?: Partial<ExistsExceptCurrentIdRuleOptions> & {
      errorMessage?: string;
    }): this;
  }
  interface StringValidator {
    uniqueExceptCurrentUser: ScalarValidator["uniqueExceptCurrentUser"];
    uniqueExceptCurrentId: ScalarValidator["uniqueExceptCurrentId"];
    existsExceptCurrentUser: ScalarValidator["existsExceptCurrentUser"];
    existsExceptCurrentId: ScalarValidator["existsExceptCurrentId"];
  }
}
type ValidationConfiguration = {
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
//#endregion
export { ValidationConfiguration };
//# sourceMappingURL=types.d.mts.map