import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { Upload } from "../../modules/uploads/models/upload";

/**
 * Uploadable rule - validates uploadable hash id
 */
export const uploadableRule: SchemaRule = {
  name: "uploadable",
  defaultErrorMessage: "The :input must be a valid upload id",
  async validate(value: any, context) {
    const upload = await Upload.find(value);

    if (upload) {
      return VALID_RULE;
    }
    return invalidRule(this, context);
  },
};
