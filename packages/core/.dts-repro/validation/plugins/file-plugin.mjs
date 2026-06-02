import { FileValidator } from "../validators/file-validator.mjs";
import "../validators/index.mjs";
import { v } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/validation/plugins/file-plugin.ts
/**
* File validation plugin for Seal
*/
const filePlugin = {
	name: "file",
	version: "1.0.0",
	description: "Adds file upload validation (v.file())",
	install() {
		v.file = (errorMessage) => new FileValidator(errorMessage);
	}
};
//#endregion
export { filePlugin };

//# sourceMappingURL=file-plugin.mjs.map