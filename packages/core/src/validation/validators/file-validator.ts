import type { FileSizeOption } from "@warlock.js/seal";
import {
  BaseValidator,
  maxFileSizeRule,
  maxHeightRule,
  maxWidthRule,
  minFileSizeRule,
  minHeightRule,
  minWidthRule,
  resolveFileSize,
  v,
} from "@warlock.js/seal";
import { UploadedFile } from "../../http";
import { fileExtensionRule, fileRule, fileTypeRule, imageRule } from "../file";

export const uploadedFileMetadataSchema = v.object({
  location: v.string().oneOf(["local", "cloud"]),
  width: v.int().positive(),
  height: v.int().positive(),
  size: v.int().positive(),
  mimeType: v.string(),
  extension: v.string(),
  name: v.string(),
});

/**
 * File validator class
 */
export class FileValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addRule(fileRule, errorMessage);
  }

  /**
   * Check if value is a File type
   */
  public matchesType(value: any): boolean {
    return value instanceof UploadedFile;
  }

  /** Value must be an image */
  public image(errorMessage?: string) {
    this.addRule(imageRule, errorMessage);
    return this;
  }

  /** Accept specific file extensions */
  public accept(extensions: string | string[], errorMessage?: string) {
    const rule = this.addRule(fileExtensionRule, errorMessage);
    rule.context.options.extensions = extensions;
    return this;
  }

  /** Allow specific MIME types */
  public mimeType(mimeTypes: string | string[], errorMessage?: string) {
    const rule = this.addRule(fileTypeRule, errorMessage);
    rule.context.options.mimeTypes = mimeTypes;
    return this;
  }

  /** Allow only pdf files */
  public pdf(errorMessage?: string) {
    return this.mimeType("application/pdf", errorMessage);
  }

  /** Allow only excel files */
  public excel(errorMessage?: string) {
    return this.mimeType(
      [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      errorMessage,
    );
  }

  /** Allow only word files */
  public word(errorMessage?: string) {
    return this.mimeType(
      [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      errorMessage,
    );
  }

  /** Minimum file size */
  public minSize(size: number | FileSizeOption, errorMessage?: string) {
    const rule = this.addRule(minFileSizeRule, errorMessage);
    rule.context.options.minSize = resolveFileSize(size);
    return this;
  }

  /** @alias minSize */
  public min(size: number | FileSizeOption, errorMessage?: string) {
    return this.minSize(size, errorMessage);
  }

  /** Maximum file size */
  public maxSize(size: number | FileSizeOption, errorMessage?: string) {
    const rule = this.addRule(maxFileSizeRule, errorMessage);
    rule.context.options.maxSize = resolveFileSize(size);
    return this;
  }

  /** @alias maxSize */
  public max(size: number, errorMessage?: string) {
    return this.maxSize(size, errorMessage);
  }

  /** Minimum image width */
  public minWidth(width: number, errorMessage?: string) {
    const rule = this.addRule(minWidthRule, errorMessage);
    rule.context.options.minWidth = width;
    return this;
  }

  /** Maximum image width */
  public maxWidth(width: number, errorMessage?: string) {
    const rule = this.addRule(maxWidthRule, errorMessage);
    rule.context.options.maxWidth = width;
    return this;
  }

  /** Minimum image height */
  public minHeight(height: number, errorMessage?: string) {
    const rule = this.addRule(minHeightRule, errorMessage);
    rule.context.options.minHeight = height;
    return this;
  }

  /** Maximum image height */
  public maxHeight(height: number, errorMessage?: string) {
    const rule = this.addRule(maxHeightRule, errorMessage);
    rule.context.options.maxHeight = height;
    return this;
  }

  /**
   * Save the file and return it as a string
   */
  public saveTo(relativeDirectory: string) {
    return this.addTransformer(async (file: UploadedFile) => {
      const output = await file.save(relativeDirectory);

      return output.path;
    });
  }
}
