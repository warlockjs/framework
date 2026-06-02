import { existsExceptCurrentIdRule } from "../database/exists-except-current-id.mjs";
import { existsExceptCurrentUserRule } from "../database/exists-except-current-user.mjs";
import { uniqueExceptCurrentIdRule } from "../database/unique-except-current-id.mjs";
import { uniqueExceptCurrentUserRule } from "../database/unique-except-current-user.mjs";
import "../database/index.mjs";
import { NumberValidator, ScalarValidator, StringValidator } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/validation/plugins/database-plugin.ts
/**
* Database validation plugin for Seal
*/
const databasePlugin = {
	name: "database",
	version: "1.0.0",
	description: "Adds request-aware database validation methods (except-current-user/id) to validators",
	install() {
		Object.assign(ScalarValidator.prototype, {
			uniqueExceptCurrentUser(model, optionsList) {
				const { errorMessage, ...options } = optionsList || {};
				return this.addRule(uniqueExceptCurrentUserRule, errorMessage, {
					Model: model,
					...options
				});
			},
			uniqueExceptCurrentId(model, optionsList) {
				const { errorMessage, ...options } = optionsList || {};
				return this.addRule(uniqueExceptCurrentIdRule, errorMessage, {
					Model: model,
					...options
				});
			},
			existsExceptCurrentUser(model, optionsList) {
				const { errorMessage, ...options } = optionsList || {};
				return this.addRule(existsExceptCurrentUserRule, errorMessage, {
					Model: model,
					...options
				});
			},
			existsExceptCurrentId(model, optionsList) {
				const { errorMessage, ...options } = optionsList || {};
				return this.addRule(existsExceptCurrentIdRule, errorMessage, {
					Model: model,
					...options
				});
			}
		});
		Object.assign(StringValidator.prototype, {
			uniqueExceptCurrentUser: ScalarValidator.prototype.uniqueExceptCurrentUser,
			uniqueExceptCurrentId: ScalarValidator.prototype.uniqueExceptCurrentId,
			existsExceptCurrentUser: ScalarValidator.prototype.existsExceptCurrentUser,
			existsExceptCurrentId: ScalarValidator.prototype.existsExceptCurrentId
		});
		Object.assign(NumberValidator.prototype, {});
	}
};
//#endregion
export { databasePlugin };

//# sourceMappingURL=database-plugin.mjs.map