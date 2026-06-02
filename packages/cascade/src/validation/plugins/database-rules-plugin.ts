/**
 * Database Rules Plugin
 *
 * Injects the `.unique()` and `.exists()` method-chain entries onto Seal's
 * scalar validators. These are the Cascade-owned, DB-aware validation rules.
 *
 * Request-aware variants (`uniqueExceptCurrentUser`, etc.) live in
 * `@warlock.js/core` because they depend on the HTTP request store, which
 * Cascade has no business knowing about.
 */

import type { SealPlugin } from "@warlock.js/seal";
import { NumberValidator, ScalarValidator, StringValidator } from "@warlock.js/seal";
import type { ChildModel, Model } from "../../model/model";
import { existsRule } from "../rules/exists-rule";
import { uniqueRule } from "../rules/unique-rule";
import type { ExistsRuleOptions, UniqueRuleOptions } from "../types";

declare module "@warlock.js/seal" {
  interface ScalarValidator {
    /** Value must be unique in database */
    unique(
      model: ChildModel<Model> | string,
      optionsList?: Partial<UniqueRuleOptions> & {
        errorMessage?: string;
      },
    ): this;

    /** Value must exist in database */
    exists(
      model: ChildModel<Model> | string,
      optionsList?: Partial<ExistsRuleOptions> & {
        errorMessage?: string;
      },
    ): this;
  }

  interface StringValidator {
    unique: ScalarValidator["unique"];
    exists: ScalarValidator["exists"];
  }

  interface NumberValidator {
    unique: ScalarValidator["unique"];
    exists: ScalarValidator["exists"];
  }
}

/**
 * Cascade's database-rules plugin for Seal.
 */
export const databaseRulesPlugin: SealPlugin = {
  name: "cascade-database-rules",
  version: "1.0.0",
  description: "Adds unique() and exists() database validation methods to Seal scalar validators",

  install() {
    Object.assign(ScalarValidator.prototype, {
      unique(
        this: ScalarValidator,
        model: ChildModel<Model> | string,
        optionsList?: Partial<UniqueRuleOptions> & {
          errorMessage?: string;
        },
      ) {
        const { errorMessage, ...options } = optionsList || {};

        return this.addRule(uniqueRule, errorMessage, {
          Model: model,
          ...options,
        });
      },

      exists(
        this: ScalarValidator,
        model: ChildModel<Model> | string,
        optionsList?: Partial<ExistsRuleOptions> & {
          errorMessage?: string;
        },
      ) {
        const { errorMessage, ...options } = optionsList || {};

        return this.addRule(existsRule, errorMessage, {
          Model: model,
          ...options,
        });
      },
    });

    Object.assign(StringValidator.prototype, {
      unique: ScalarValidator.prototype.unique,
      exists: ScalarValidator.prototype.exists,
    });

    Object.assign(NumberValidator.prototype, {
      unique: ScalarValidator.prototype.unique,
      exists: ScalarValidator.prototype.exists,
    });
  },
};
