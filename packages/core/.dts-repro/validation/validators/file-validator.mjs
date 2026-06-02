import { UploadedFile } from "../../http/uploaded-file.mjs";
import "../../http/index.mjs";
import { fileExtensionRule, fileRule, fileTypeRule, imageRule } from "../file/file.mjs";
import "../file/index.mjs";
import { BaseValidator, maxFileSizeRule, maxHeightRule, maxWidthRule, minFileSizeRule, minHeightRule, minWidthRule, resolveFileSize, v } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/validation/validators/file-validator.ts
const uploadedFileMetadataSchema = v.object({
	location: v.string().oneOf(["local", "cloud"]),
	width: v.int().positive(),
	height: v.int().positive(),
	size: v.int().positive(),
	mimeType: v.string(),
	extension: v.string(),
	name: v.string()
});
/**
* File validator class
*/
var FileValidator = class extends BaseValidator {
	constructor(errorMessage) {
		super();
		this.addMutableRule(fileRule, errorMessage);
	}
	/**
	* Check if value is a File type
	*/
	matchesType(value) {
		return value instanceof UploadedFile;
	}
	/** Value must be an image */
	image(errorMessage) {
		return this.addRule(imageRule, errorMessage);
	}
	/** Accept specific file extensions */
	accept(extensions, errorMessage) {
		return this.addRule(fileExtensionRule, errorMessage, { extensions });
	}
	/** Allow specific MIME types */
	mimeType(mimeTypes, errorMessage) {
		return this.addRule(fileTypeRule, errorMessage, { mimeTypes });
	}
	/** Allow only pdf files */
	pdf(errorMessage) {
		return this.mimeType("application/pdf", errorMessage);
	}
	/** Allow only excel files */
	excel(errorMessage) {
		return this.mimeType(["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], errorMessage);
	}
	/** Allow only word files */
	word(errorMessage) {
		return this.mimeType(["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], errorMessage);
	}
	/** Minimum file size */
	minSize(size, errorMessage) {
		return this.addRule(minFileSizeRule, errorMessage, { minSize: resolveFileSize(size) });
	}
	/** @alias minSize */
	min(size, errorMessage) {
		return this.minSize(size, errorMessage);
	}
	/** Maximum file size */
	maxSize(size, errorMessage) {
		return this.addRule(maxFileSizeRule, errorMessage, { maxSize: resolveFileSize(size) });
	}
	/** @alias maxSize */
	max(size, errorMessage) {
		return this.maxSize(size, errorMessage);
	}
	/** Minimum image width */
	minWidth(width, errorMessage) {
		return this.addRule(minWidthRule, errorMessage, { minWidth: width });
	}
	/** Maximum image width */
	maxWidth(width, errorMessage) {
		return this.addRule(maxWidthRule, errorMessage, { maxWidth: width });
	}
	/** Minimum image height */
	minHeight(height, errorMessage) {
		return this.addRule(minHeightRule, errorMessage, { minHeight: height });
	}
	/** Maximum image height */
	maxHeight(height, errorMessage) {
		return this.addRule(maxHeightRule, errorMessage, { maxHeight: height });
	}
	/**
	* Save the file and return it as a string
	*/
	saveTo(relativeDirectory) {
		return this.addTransformer(async (file) => {
			return (await file.save(relativeDirectory)).path;
		});
	}
	/**
	* @inheritdoc
	*
	* File uploads are not natively representable in JSON Schema.
	* The output varies by target:
	* - `openapi-3.0`   → `{ type: "string", format: "binary" }` (standard for multipart/form-data uploads)
	* - `draft-2020-12` → `{ type: "string", contentEncoding: "binary" }`
	* - `draft-07`      → `{}` (no standard binary representation — permissive fallback)
	*
	* @example
	* ```ts
	* v.file().toJsonSchema("openapi-3.0")
	* // → { type: "string", format: "binary" }
	* ```
	*/
	toJsonSchema(target = "draft-2020-12") {
		if (target === "openapi-3.0") return {
			type: "string",
			format: "binary"
		};
		if (target === "draft-2020-12") return {
			type: "string",
			contentEncoding: "binary"
		};
		return {};
	}
};
//#endregion
export { FileValidator, uploadedFileMetadataSchema };

//# sourceMappingURL=file-validator.mjs.map