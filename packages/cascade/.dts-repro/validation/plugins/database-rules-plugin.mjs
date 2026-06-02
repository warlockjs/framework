import { existsRule } from "../rules/exists-rule.mjs";
import { uniqueRule } from "../rules/unique-rule.mjs";
import { NumberValidator, ScalarValidator, StringValidator } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/plugins/database-rules-plugin.ts
/**
* Cascade's database-rules plugin for Seal.
*/
const databaseRulesPlugin = {
	name: "cascade-database-rules",
	version: "1.0.0",
	description: "Adds unique() and exists() database validation methods to Seal scalar validators",
	install() {
		Object.assign(ScalarValidator.prototype, {
			unique(model, optionsList) {
				const { errorMessage, ...options } = optionsList || {};
				return this.addRule(uniqueRule, errorMessage, {
					Model: model,
					...options
				});
			},
			exists(model, optionsList) {
				const { errorMessage, ...options } = optionsList || {};
				return this.addRule(existsRule, errorMessage, {
					Model: model,
					...options
				});
			}
		});
		Object.assign(StringValidator.prototype, {
			unique: ScalarValidator.prototype.unique,
			exists: ScalarValidator.prototype.exists
		});
		Object.assign(NumberValidator.prototype, {
			unique: ScalarValidator.prototype.unique,
			exists: ScalarValidator.prototype.exists
		});
	}
};
//#endregion
export { databaseRulesPlugin };

//# sourceMappingURL=database-rules-plugin.mjs.map