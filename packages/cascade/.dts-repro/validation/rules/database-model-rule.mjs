import { getModelFromRegistry } from "../../model/register-model.mjs";
import { Model } from "../../model/model.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/rules/database-model-rule.ts
const databaseModelRule = {
	name: "databaseModel",
	defaultErrorMessage: "The :input must be a valid :model model",
	async validate(value, context) {
		if (value instanceof Model === false) {
			this.context.attributesList.model = this.context.options.model?.name;
			return invalidRule(this, context);
		}
		return VALID_RULE;
	}
};
const databaseModelsRule = {
	name: "databaseModels",
	defaultErrorMessage: "The :input must be a list of valid :model",
	async validate(value, context) {
		let { model } = this.context.options;
		if (typeof model === "string") model = getModelFromRegistry(model);
		this.context.attributesList.model = model.name;
		if (!Array.isArray(value)) return invalidRule(this, context);
		if (value.every((item) => item instanceof Model)) return VALID_RULE;
		return invalidRule(this, context);
	}
};
//#endregion
export { databaseModelRule, databaseModelsRule };

//# sourceMappingURL=database-model-rule.mjs.map