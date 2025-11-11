/**
 * Framework Validator Type Augmentations
 *
 * Augments core validators with framework-specific methods
 */

import type { Model } from "@warlock.js/cascade";
import type { ArrayValidator, BaseValidator } from "@warlock.js/seal";
import type {
  ExistsExceptCurrentIdRuleOptions,
  ExistsExceptCurrentUserRuleOptions,
  ExistsRuleOptions,
  UniqueExceptCurrentIdRuleOptions,
  UniqueExceptCurrentUserRuleOptions,
  UniqueRuleOptions,
} from "./database";
import type { FileValidator } from "./validators";

// Type augmentation for v factory and validators
declare module "@warlock.js/seal" {
  // Augment the v factory with file() method
  export interface ValidatorV {
    file: (errorMessage?: string) => FileValidator;
    localized: (
      valueValidator?: BaseValidator,
      errorMessage?: string,
    ) => ArrayValidator & {
      validator: BaseValidator;
    };
  }

  interface ScalarValidator {
    /** Value must be unique in database */
    unique(
      model: typeof Model | string,
      optionsList?: Partial<UniqueRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must be unique in database except current user */
    uniqueExceptCurrentUser(
      model: typeof Model | string,
      optionsList?: Partial<UniqueExceptCurrentUserRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must be unique in database except current id */
    uniqueExceptCurrentId(
      model: typeof Model | string,
      optionsList?: Partial<UniqueExceptCurrentIdRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must exist in database */
    exists(
      model: typeof Model | string,
      optionsList?: Partial<ExistsRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must exist in database except current user */
    existsExceptCurrentUser(
      model: typeof Model | string,
      optionsList?: Partial<ExistsExceptCurrentUserRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must exists in database except current id */
    existsExceptCurrentId(
      model: typeof Model | string,
      optionsList?: Partial<ExistsExceptCurrentIdRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
  }

  // StringValidator gets same database methods
  interface StringValidator {
    unique: ScalarValidator["unique"];
    uniqueExceptCurrentUser: ScalarValidator["uniqueExceptCurrentUser"];
    uniqueExceptCurrentId: ScalarValidator["uniqueExceptCurrentId"];
    exists: ScalarValidator["exists"];
    existsExceptCurrentUser: ScalarValidator["existsExceptCurrentUser"];
    existsExceptCurrentId: ScalarValidator["existsExceptCurrentId"];
  }

  // NumberValidator gets unique and exists only
  interface NumberValidator {
    unique: ScalarValidator["unique"];
    exists: ScalarValidator["exists"];
  }
}

// Export database types for use in validators
export type {
  ExistsExceptCurrentIdRuleOptions,
  ExistsExceptCurrentUserRuleOptions,
  ExistsRuleOptions,
  UniqueExceptCurrentIdRuleOptions,
  UniqueExceptCurrentUserRuleOptions,
  UniqueRuleOptions,
} from "./database";
