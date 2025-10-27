import {
  BaseValidator,
  maxFileSizeRule,
  maxHeightRule,
  maxWidthRule,
  minFileSizeRule,
  minHeightRule,
  minWidthRule,
} from "@warlock.js/seal";
import { fileExtensionRule, fileRule, fileTypeRule, imageRule } from "../file";

/**
 * File validator class
 */
export class FileValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addRule(fileRule, errorMessage);
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
  public minSize(size: number, errorMessage?: string) {
    const rule = this.addRule(minFileSizeRule, errorMessage);
    rule.context.options.minFileSize = size;
    return this;
  }

  /** @alias minSize */
  public min(size: number, errorMessage?: string) {
    return this.minSize(size, errorMessage);
  }

  /** Maximum file size */
  public maxSize(size: number, errorMessage?: string) {
    const rule = this.addRule(maxFileSizeRule, errorMessage);
    rule.context.options.maxFileSize = size;
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
}
