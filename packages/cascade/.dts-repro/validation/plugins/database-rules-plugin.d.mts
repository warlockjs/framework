import { ChildModel } from "../../model/model.types.mjs";
import { Model } from "../../model/model.mjs";
import { ExistsRuleOptions, UniqueRuleOptions } from "../types.mjs";
//#region ../../@warlock.js/cascade/src/validation/plugins/database-rules-plugin.d.ts
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
//# sourceMappingURL=database-rules-plugin.d.mts.map