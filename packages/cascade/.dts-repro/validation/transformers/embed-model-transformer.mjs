import { Model } from "../../model/model.mjs";
//#region ../../@warlock.js/cascade/src/validation/transformers/embed-model-transformer.ts
const databaseModelTransformer = (value, context) => {
	const embed = context.options.embed ?? "embedData";
	if (value instanceof Model === false && !Array.isArray(value)) return value;
	if (Array.isArray(value)) return value.map((item) => {
		if (typeof embed === "string") return item[embed];
		return item.only(embed);
	});
	if (typeof embed === "string") return value[embed];
	return value.only(embed);
};
//#endregion
export { databaseModelTransformer };

//# sourceMappingURL=embed-model-transformer.mjs.map