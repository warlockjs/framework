import type { Mutator } from "@warlock.js/seal";
import { type ChildModel, Model } from "../../model/model";
import { requireModelClass } from "../../model/register-model";

type DatabaseModelMutatorOptions = {
  model: ChildModel<any> | string;
};

export const databaseModelMutator: Mutator<DatabaseModelMutatorOptions> = async (
  value,
  context,
) => {
  const { model } = context?.options || {};

  if (!model) {
    throw new Error("Model option is required");
  }

  const ModelClass = requireModelClass(model);

  if (value instanceof Model) return value;

  if (value && typeof value === "object") {
    const key = ModelClass.primaryKey || "id";
    value = value[key] ?? value.id;
  }

  if (typeof value !== "number" && typeof value !== "string") return value;

  if (value === "") return value;

  return await ModelClass.find(value);
};

export const databaseModelsMutator: Mutator<DatabaseModelMutatorOptions> = async (
  value,
  context,
) => {
  if (!Array.isArray(value)) return value;

  const { model } = context?.options || {};

  if (!model) {
    throw new Error("Model option is required");
  }

  const ModelClass = requireModelClass(model);

  // first, if all values are list of models, then return them.
  if (value.every((item) => item instanceof Model)) return value;

  const key = ModelClass.primaryKey || "id";

  const ids = value
    .map((item) => (item && typeof item === "object" ? (item[key] ?? item.id) : item))
    .filter((item) => item !== undefined && item !== null);

  const uniqueIds = [...new Set(ids)];

  const found = await ModelClass.query().whereIn(key, uniqueIds).get();

  // a missing id must fail validation instead of being silently dropped;
  // returning the raw value makes the models rule reject it
  if (found.length !== uniqueIds.length) return value;

  return found;
};
