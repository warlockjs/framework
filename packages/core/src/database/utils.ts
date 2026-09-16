import { get } from "@mongez/reinforcements";
import { slugify } from "@mongez/slug";
import { Model, useModelTransformer } from "@warlock.js/cascade";
import { type ComputedCallback, type SchemaContext } from "@warlock.js/seal";
import { hashPassword } from "../encryption/password";

/**
 * Hash password on saving if password changes.
 *
 * Uses core's own bcrypt `hashPassword` (salt rounds from
 * `encryption.password.salt`). Core must never import `@warlock.js/auth`:
 * auth depends on core, and its `authService.hashPassword` only delegates here.
 */
export const useHashedPassword = () =>
  useModelTransformer(({ value, isChanged, isNew }) => {
    if (!value) return value;

    if (!isNew && !isChanged) return value;

    return hashPassword(String(value));
  });

type ComputedCallbackModel = (
  data: any,
  model: Model,
  context: SchemaContext,
) => any | Promise<any>;

/**
 * Generate computed value based on other fields
 */
export function useComputedModel(callback: ComputedCallbackModel) {
  const computedCallback: ComputedCallback = (data, context) => {
    return callback(data, context.rootContext!.model, context);
  };

  return computedCallback;
}

/**
 * Generate slug based on a field on saving
 */
export function useComputedSlug(field = "title", scope: "global" | "sibling" = "sibling") {
  return useComputedModel((data, model, context) => {
    const value = scope === "sibling" ? data[field] : get(context.allValues, field);

    if (!value) return model.get(field);

    return slugify(value);
  });
}
