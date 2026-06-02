import { databaseModelMutator, databaseModelsMutator } from "../mutators/embed-mutator.mjs";
import { databaseModelRule, databaseModelsRule } from "../rules/database-model-rule.mjs";
import { databaseModelTransformer } from "../transformers/embed-model-transformer.mjs";
import { Model } from "../../model/model.mjs";
import { BaseValidator, arrayRule } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/validators/embed-validator.ts
var EmbedModelValidator = class extends BaseValidator {
	/**
	* Check if value is a string type
	*/
	matchesType(value) {
		return value instanceof Model || typeof value === "number" || Array.isArray(value) && value.every((item) => item instanceof Model);
	}
	/**
	* Mutate the value to be a model, also fail if the mutated value is not a valid model
	*/
	model(model, errorMessage) {
		this.addMutator(databaseModelMutator, { model });
		return this.addRule(databaseModelRule, errorMessage, { model });
	}
	/**
	* Validate the value is a list of models
	*/
	models(model, errorMessage) {
		const instance = this.instance;
		instance.addMutator(databaseModelsMutator, { model });
		instance.addMutableRule(arrayRule);
		instance.addMutableRule(databaseModelsRule, errorMessage, { model });
		return instance;
	}
	/**
	* Determine how the data will be stored as an embedded document
	*/
	embed(embed) {
		return this.addTransformer(databaseModelTransformer, { embed });
	}
};
//#endregion
export { EmbedModelValidator };

//# sourceMappingURL=embed-validator.mjs.map