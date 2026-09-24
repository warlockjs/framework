import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { type ChildModel, Model } from "./../../model/model";
import { requireModelClass } from "./../../model/register-model";

export const databaseModelRule: SchemaRule = {
  name: "databaseModel",
  defaultErrorMessage: "The :input must be a valid :model model",
  async validate(value, context) {
    if (value instanceof Model === false) {
      const { model } = this.context.options;

      this.context.attributesList.model = typeof model === "string" ? model : model?.name;
      return invalidRule(this, context);
    }

    return VALID_RULE;
  },
};

export const databaseModelsRule: SchemaRule<{ model: ChildModel<any> | string }> = {
  name: "databaseModels",
  defaultErrorMessage: "The :input must be a list of valid :model",
  async validate(value, context) {
    const { model } = this.context.options;

    // keep the original name for messages; throws when a string ref is unregistered
    const ModelClass = requireModelClass(model);

    this.context.attributesList.model = typeof model === "string" ? model : ModelClass.name;

    if (!Array.isArray(value)) return invalidRule(this, context);

    if (value.every((item) => item instanceof Model)) return VALID_RULE;

    return invalidRule(this, context);
  },
};
