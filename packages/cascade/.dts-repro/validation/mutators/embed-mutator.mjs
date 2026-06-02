import { getModelFromRegistry } from "../../model/register-model.mjs";
import { Model } from "../../model/model.mjs";
//#region ../../@warlock.js/cascade/src/validation/mutators/embed-mutator.ts
const databaseModelMutator = async (value, context) => {
	let { model: ModelClass } = context?.options || {};
	if (typeof ModelClass === "string") ModelClass = getModelFromRegistry(ModelClass);
	if (!ModelClass) throw new Error(`Model ${ModelClass} not found in registry`);
	if (value instanceof Model) return value;
	if (typeof value === "object" && value?.id) value = Number(value.id);
	if (typeof value !== "number") return value;
	return await ModelClass.find(value);
};
const databaseModelsMutator = async (value, context) => {
	if (!Array.isArray(value)) return value;
	let { model: ModelClass } = context?.options || {};
	if (typeof ModelClass === "string") ModelClass = getModelFromRegistry(ModelClass);
	if (!ModelClass) throw new Error(`Model ${ModelClass} not found in registry`);
	if (value.every((item) => item instanceof Model)) return value;
	const ids = value.map((item) => item?.id || item).filter((item) => item !== void 0);
	return await ModelClass.query().whereIn("id", ids).get();
};
//#endregion
export { databaseModelMutator, databaseModelsMutator };

//# sourceMappingURL=embed-mutator.mjs.map