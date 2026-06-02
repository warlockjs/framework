import { UploadedFile } from "../../http/uploaded-file.mjs";
import "../../http/index.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/validation/file/file.ts
/**
* File rule - validates uploaded file
*/
const fileRule = {
	name: "file",
	defaultErrorMessage: "The :input must be a file",
	async validate(value, context) {
		if (value instanceof UploadedFile) return VALID_RULE;
		return invalidRule(this, context);
	}
};
/**
* Image rule - validates uploaded image
*/
const imageRule = {
	name: "image",
	defaultErrorMessage: "The :input must be an image",
	async validate(value, context) {
		if (value instanceof UploadedFile && value.isImage) return VALID_RULE;
		return invalidRule(this, context);
	}
};
/**
* File extension rule - validates file extension
*/
const fileExtensionRule = {
	name: "fileExtension",
	errorMessage: "The :input must have one of the following extensions: :extensions",
	async validate(value, context) {
		let extensions = this.context.options.extensions;
		if (typeof extensions === "string") extensions = [extensions];
		if (extensions.includes(value.extension)) return VALID_RULE;
		return invalidRule(this, context);
	}
};
/**
* File type rule - validates MIME type
*/
const fileTypeRule = {
	name: "fileType",
	defaultErrorMessage: "The :input must be a :types file",
	async validate(value, context) {
		let mimeTypes = this.context.options.mimeTypes;
		if (typeof mimeTypes === "string") mimeTypes = [mimeTypes];
		if (mimeTypes.includes(value.mimeType)) return VALID_RULE;
		return invalidRule(this, context);
	}
};
//#endregion
export { fileExtensionRule, fileRule, fileTypeRule, imageRule };

//# sourceMappingURL=file.mjs.map