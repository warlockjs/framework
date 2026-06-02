import { EmbedModelValidator } from "../validators/embed-validator.mjs";
import { v } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/plugins/embed-validator-plugin.ts
/**
* File validation plugin for Seal
*/
const embedValidator = {
	name: "embed",
	version: "1.0.0",
	description: "Adds embed validation (v.embed())",
	install() {
		v.embed = (model, options) => new EmbedModelValidator().model(model).embed(options?.embed);
		v.embedMany = (model, options) => new EmbedModelValidator().models(model).embed(options?.embed);
	}
};
//#endregion
export { embedValidator };

//# sourceMappingURL=embed-validator-plugin.mjs.map