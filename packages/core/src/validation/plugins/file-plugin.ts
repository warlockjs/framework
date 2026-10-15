/**
 * File Validator Plugin
 *
 * Adds file validation to Seal v factory
 */

import type { SealPlugin, StandardSchemaV1 } from "@warlock.js/seal";
import { v } from "@warlock.js/seal";
import type { UploadedFile } from "../../http";
import { FileValidator } from "../validators";

/**
 * File validation plugin for Seal
 */
export const filePlugin: SealPlugin = {
  name: "file",
  version: "1.0.0",
  description: "Adds file upload validation (v.file())",
  install() {
    // Inject file() method into v factory
    v.file = (errorMessage?: string) =>
      new FileValidator(errorMessage) as FileValidator & StandardSchemaV1<UploadedFile>;
  },
};
