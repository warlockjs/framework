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
import type { ChildModel, Model } from "../../model/model";
import type { ExistsRuleOptions, UniqueRuleOptions } from "../types";
declare module "@warlock.js/seal" {
    interface ScalarValidator {
        /** Value must be unique in database */
        unique(model: ChildModel<Model> | string, optionsList?: Partial<UniqueRuleOptions> & {
            errorMessage?: string;
        }): this;
        /** Value must exist in database */
        exists(model: ChildModel<Model> | string, optionsList?: Partial<ExistsRuleOptions> & {
            errorMessage?: string;
        }): this;
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
export declare const databaseRulesPlugin: SealPlugin;
//# sourceMappingURL=database-rules-plugin.d.ts.map