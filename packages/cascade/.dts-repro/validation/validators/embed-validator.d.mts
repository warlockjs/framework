import { ChildModel } from "../../model/model.types.mjs";
import { BaseValidator } from "@warlock.js/seal";

//#region ../../@warlock.js/cascade/src/validation/validators/embed-validator.d.ts
declare class EmbedModelValidator extends BaseValidator {
  /**
   * Check if value is a string type
   */
  matchesType(value: any): boolean;
  /**
   * Mutate the value to be a model, also fail if the mutated value is not a valid model
   */
  model(model: ChildModel<any> | string, errorMessage?: string): EmbedModelValidator;
  /**
   * Validate the value is a list of models
   */
  models(model: ChildModel<any> | string, errorMessage?: string): EmbedModelValidator;
  /**
   * Determine how the data will be stored as an embedded document
   */
  embed(embed?: string | string[]): EmbedModelValidator;
}
//#endregion
export { EmbedModelValidator };
//# sourceMappingURL=embed-validator.d.mts.map