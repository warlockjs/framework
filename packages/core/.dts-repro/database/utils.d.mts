import { SchemaContext } from "@warlock.js/seal";
import { Model } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/database/utils.d.ts
/**
 * Hash password on saving if password changes
 */
declare const useHashedPassword: () => any;
type ComputedCallbackModel = (data: any, model: Model, context: SchemaContext) => any | Promise<any>;
/**
 * Generate computed value based on other fields
 */
declare function useComputedModel(callback: ComputedCallbackModel): ComputedCallback;
/**
 * Generate slug based on a field on saving
 */
declare function useComputedSlug(field?: string, scope?: "global" | "sibling"): ComputedCallback;
//#endregion
export { useComputedModel, useComputedSlug, useHashedPassword };
//# sourceMappingURL=utils.d.mts.map