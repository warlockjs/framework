/**
 * Database Validation Plugin (core)
 *
 * Injects the request-aware database validation methods onto Seal scalar
 * validators:
 * - uniqueExceptCurrentUser / uniqueExceptCurrentId
 * - existsExceptCurrentUser / existsExceptCurrentId
 *
 * The base `unique()` / `exists()` methods are owned by
 * `@warlock.js/cascade` and registered by its own seal plugin.
 */

import { type ChildModel, type Model } from "@warlock.js/cascade";
import type { SealPlugin } from "@warlock.js/seal";
import { NumberValidator, ScalarValidator, StringValidator } from "@warlock.js/seal";
import {
  existsExceptCurrentIdRule,
  existsExceptCurrentUserRule,
  uniqueExceptCurrentIdRule,
  uniqueExceptCurrentUserRule,
} from "../database";
import type {
  ExistsExceptCurrentIdRuleOptions,
  ExistsExceptCurrentUserRuleOptions,
  UniqueExceptCurrentIdRuleOptions,
  UniqueExceptCurrentUserRuleOptions,
} from "../database";

/**
 * Database validation plugin for Seal
 */
export const databasePlugin: SealPlugin = {
  name: "database",
  version: "1.0.0",
  description: "Adds request-aware database validation methods (except-current-user/id) to validators",

  install() {
    Object.assign(ScalarValidator.prototype, {
      uniqueExceptCurrentUser(
        this: ScalarValidator,
        model: ChildModel<Model> | string,
        optionsList?: Partial<UniqueExceptCurrentUserRuleOptions> & {
          errorMessage?: string;
        },
      ) {
        const { errorMessage, ...options } = optionsList || {};

        return this.addRule(uniqueExceptCurrentUserRule, errorMessage, {
          Model: model,
          ...options,
        });
      },

      uniqueExceptCurrentId(
        this: ScalarValidator,
        model: ChildModel<Model> | string,
        optionsList?: Partial<UniqueExceptCurrentIdRuleOptions> & {
          errorMessage?: string;
        },
      ) {
        const { errorMessage, ...options } = optionsList || {};

        return this.addRule(uniqueExceptCurrentIdRule, errorMessage, {
          Model: model,
          ...options,
        });
      },

      existsExceptCurrentUser(
        this: ScalarValidator,
        model: ChildModel<Model> | string,
        optionsList?: Partial<ExistsExceptCurrentUserRuleOptions> & {
          errorMessage?: string;
        },
      ) {
        const { errorMessage, ...options } = optionsList || {};

        return this.addRule(existsExceptCurrentUserRule, errorMessage, {
          Model: model,
          ...options,
        });
      },

      existsExceptCurrentId(
        this: ScalarValidator,
        model: ChildModel<Model> | string,
        optionsList?: Partial<ExistsExceptCurrentIdRuleOptions> & {
          errorMessage?: string;
        },
      ) {
        const { errorMessage, ...options } = optionsList || {};

        return this.addRule(existsExceptCurrentIdRule, errorMessage, {
          Model: model,
          ...options,
        });
      },
    });

    Object.assign(StringValidator.prototype, {
      uniqueExceptCurrentUser: ScalarValidator.prototype.uniqueExceptCurrentUser,
      uniqueExceptCurrentId: ScalarValidator.prototype.uniqueExceptCurrentId,
      existsExceptCurrentUser: ScalarValidator.prototype.existsExceptCurrentUser,
      existsExceptCurrentId: ScalarValidator.prototype.existsExceptCurrentId,
    });

    Object.assign(NumberValidator.prototype, {});
  },
};
