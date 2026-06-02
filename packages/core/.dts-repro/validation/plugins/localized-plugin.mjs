import { v } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/validation/plugins/localized-plugin.ts
/**
* Localized validation plugin for Seal
*/
const localizedPlugin = {
	name: "localized",
	version: "1.0.0",
	description: "Adds localized validation (v.localized())",
	install() {
		v.localized = (valueValidator, errorMessage) => v.array(v.object({
			localeCode: v.string().required(),
			value: valueValidator || v.scalar()
		}), errorMessage);
	}
};
//#endregion
export { localizedPlugin };

//# sourceMappingURL=localized-plugin.mjs.map