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
    this.addMutableRule(fileRule, errorMessage);
  }

  /**
   * Check if value is a File type
   */
  public matchesType(value: any): boolean {
    return value instanceof UploadedFile;
  }

  /** Value must be an image */
  public image(errorMessage?: string) {
    return this.addRule(imageRule, errorMessage);
  }

  /** Accept specific file extensions */
  public accept(extensions: string | string[], errorMessage?: string) {
    return this.addRule(fileExtensionRule, errorMessage, {
      extensions,
    });
  }

  /** Allow specific MIME types */
  public mimeType(mimeTypes: string | string[], errorMessage?: string) {
    return this.addRule(fileTypeRule, errorMessage, {
      mimeTypes,
    });
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
    return this.addRule(minFileSizeRule, errorMessage, {
      minSize: resolveFileSize(size),
    });
  }

  /** @alias minSize */
  public min(size: number | FileSizeOption, errorMessage?: string) {
    return this.minSize(size, errorMessage);
  }

  /** Maximum file size */
  public maxSize(size: number | FileSizeOption, errorMessage?: string) {
    return this.addRule(maxFileSizeRule, errorMessage, {
      maxSize: resolveFileSize(size),
    });
  }

  /** @alias maxSize */
  public max(size: number, errorMessage?: string) {
    return this.maxSize(size, errorMessage);
  }

  /** Minimum image width */
  public minWidth(width: number, errorMessage?: string) {
    return this.addRule(minWidthRule, errorMessage, {
      minWidth: width,
    });
  }

  /** Maximum image width */
  public maxWidth(width: number, errorMessage?: string) {
    return this.addRule(maxWidthRule, errorMessage, {
      maxWidth: width,
    });
  }

  /** Minimum image height */
  public minHeight(height: number, errorMessage?: string) {
    return this.addRule(minHeightRule, errorMessage, {
      minHeight: height,
    });
  }

  /** Maximum image height */
  public maxHeight(height: number, errorMessage?: string) {
    return this.addRule(maxHeightRule, errorMessage, {
      maxHeight: height,
    });
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
