import { ChildModel } from "../../model/model.types.mjs";
import { EmbedModelValidator } from "../validators/embed-validator.mjs";
//#region ../../@warlock.js/cascade/src/validation/plugins/embed-validator-plugin.d.ts
type EmbedOptions = {
  errorMessage?: string;
  embed?: string | string[];
};
declare module "@warlock.js/seal" {
  interface ValidatorV {
    embed(model: ChildModel<any> | string, options?: EmbedOptions): EmbedModelValidator;
    embedMany(model: ChildModel<any> | string, options?: EmbedOptions): EmbedModelValidator;
  }
}
/**
 * File validation plugin for Seal
 */
//# sourceMappingURL=embed-validator-plugin.d.mts.map