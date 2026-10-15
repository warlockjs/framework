/**
 * Embed Validator Plugin
 *
 * Adds embed validation to Seal v factory
 */

import type { SealPlugin } from "@warlock.js/seal";
import { v } from "@warlock.js/seal";
import type { ChildModel } from "../../model/model";
import { EmbedModelValidator } from "../validators/embed-validator";

type EmbedOptions = {
  errorMessage?: string;
  embed?: string | string[];
};

declare module "@warlock.js/seal" {
  interface ValidatorV {
    embed(model?: ChildModel<any> | string, options?: EmbedOptions): EmbedModelValidator;
    embedMany(model?: ChildModel<any> | string, options?: EmbedOptions): EmbedModelValidator;
  }
}

/**
 * File validation plugin for Seal
 */
export const embedValidator: SealPlugin = {
  name: "embed",
  version: "1.0.0",
  description: "Adds embed validation (v.embed())",

  install() {
    // Inject embed() method into v factory
    // without a model, a bare validator is returned (call .model()/.models() later)
    v.embed = (model?: ChildModel<any> | string, options?: EmbedOptions) => {
      const validator = new EmbedModelValidator();

      return (model ? validator.model(model, options?.errorMessage) : validator).embed(
        options?.embed,
      );
    };
    v.embedMany = (model?: ChildModel<any> | string, options?: EmbedOptions) => {
      const validator = new EmbedModelValidator();

      return (model ? validator.models(model, options?.errorMessage) : validator).embed(
        options?.embed,
      );
    };
  },
};
