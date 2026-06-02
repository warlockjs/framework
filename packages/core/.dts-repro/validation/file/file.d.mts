import { SchemaRule } from "@warlock.js/seal";

//#region ../../@warlock.js/core/src/validation/file/file.d.ts
/**
 * File rule - validates uploaded file
 */
declare const fileRule: SchemaRule;
/**
 * Image rule - validates uploaded image
 */
declare const imageRule: SchemaRule;
/**
 * File extension rule - validates file extension
 */
declare const fileExtensionRule: SchemaRule<{
  extensions: string | string[];
}>;
/**
 * File type rule - validates MIME type
 */
declare const fileTypeRule: SchemaRule<{
  mimeTypes: string | string[];
}>;
//#endregion
export { fileExtensionRule, fileRule, fileTypeRule, imageRule };
//# sourceMappingURL=file.d.mts.map