import { useModelTransformer } from "@warlock.js/cascade";
import { slugify } from "@mongez/slug";
import { get } from "@mongez/reinforcements";
import { authService } from "@warlock.js/auth";
//#region ../../@warlock.js/core/src/database/utils.ts
/**
* Hash password on saving if password changes
*/
const useHashedPassword = () => useModelTransformer(({ value, isChanged, isNew }) => {
	if (!value) return value;
	if (!isNew && !isChanged) return value;
	return authService.hashPassword(String(value));
});
/**
* Generate computed value based on other fields
*/
function useComputedModel(callback) {
	const computedCallback = (data, context) => {
		return callback(data, context.rootContext.model, context);
	};
	return computedCallback;
}
/**
* Generate slug based on a field on saving
*/
function useComputedSlug(field = "title", scope = "sibling") {
	return useComputedModel((data, model, context) => {
		const value = scope === "sibling" ? data[field] : get(context.allValues, field);
		if (!value) return model.get(field);
		return slugify(value);
	});
}
//#endregion
export { useComputedModel, useComputedSlug, useHashedPassword };

//# sourceMappingURL=utils.mjs.map