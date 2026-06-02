import { BaseValidator, FileSizeOption, JsonSchemaResult, JsonSchemaTarget } from "@warlock.js/seal";

//#region ../../@warlock.js/core/src/validation/validators/file-validator.d.ts
declare const uploadedFileMetadataSchema: any;
/**
 * File validator class
 */
declare class FileValidator extends BaseValidator {
  constructor(errorMessage?: string);
  /**
   * Check if value is a File type
   */
  matchesType(value: any): boolean;
  /** Value must be an image */
  image(errorMessage?: string): FileValidator;
  /** Accept specific file extensions */
  accept(extensions: string | string[], errorMessage?: string): FileValidator;
  /** Allow specific MIME types */
  mimeType(mimeTypes: string | string[], errorMessage?: string): FileValidator;
  /** Allow only pdf files */
  pdf(errorMessage?: string): FileValidator;
  /** Allow only excel files */
  excel(errorMessage?: string): FileValidator;
  /** Allow only word files */
  word(errorMessage?: string): FileValidator;
  /** Minimum file size */
  minSize(size: number | FileSizeOption, errorMessage?: string): FileValidator;
  /** @alias minSize */
  min(size: number | FileSizeOption, errorMessage?: string): FileValidator;
  /** Maximum file size */
  maxSize(size: number | FileSizeOption, errorMessage?: string): FileValidator;
  /** @alias maxSize */
  max(size: number, errorMessage?: string): FileValidator;
  /** Minimum image width */
  minWidth(width: number, errorMessage?: string): FileValidator;
  /** Maximum image width */
  maxWidth(width: number, errorMessage?: string): FileValidator;
  /** Minimum image height */
  minHeight(height: number, errorMessage?: string): FileValidator;
  /** Maximum image height */
  maxHeight(height: number, errorMessage?: string): FileValidator;
  /**
   * Save the file and return it as a string
   */
  saveTo(relativeDirectory: string): FileValidator;
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
  toJsonSchema(target?: JsonSchemaTarget): JsonSchemaResult;
}
//#endregion
export { FileValidator, uploadedFileMetadataSchema };
//# sourceMappingURL=file-validator.d.mts.map