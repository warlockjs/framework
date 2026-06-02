import { ResourceConstructor, ResourceContract } from "./resource.mjs";
import { ResourceSchema } from "./types.mjs";

//#region ../../@warlock.js/core/src/resource/define-resource.d.ts
/**
 * Options for defining a resource
 */
type DefineResourceOptions = {
  /**
   * Resource schema - field mapping configuration
   */
  schema: ResourceSchema;
  /**
   * Optional: Boot hook - called before transformation
   */
  boot?: (resource?: ResourceContract) => void;
  /**
   * Optional: Extend hook - called after transformation
   */
  extend?: (resource?: ResourceContract) => void;
  /**
   * Optional: Transform hook - modify final output
   */
  transform?: (data: Record<string, any>, resource: ResourceContract) => Record<string, any>;
};
/**
 * Define a resource with a clean, shorthand API.
 *
 * This utility creates a Resource class without the boilerplate,
 * perfect for simple use cases.
 *
 * @param options - Resource configuration
 * @returns A Resource class
 *
 * @example
 * ```typescript
 * // Simple resource
 * export const UserResource = defineResource({
 *   schema: {
 *     id: "number",
 *     name: "string",
 *     email: "string",
 *   },
 * });
 *
 * // With hooks
 * export const CategoryResource = defineResource({
 *   schema: {
 *     id: "number",
 *     name: "localized",
 *     children: CategoryResource,
 *   },
 *   transform: (data) => {
 *     // Filter inactive children
 *     if (data.children) {
 *       data.children = data.children.filter(c => c.isActive);
 *     }
 *     return data;
 *   },
 * });
 *
 * // Usage
 * const json = new UserResource(user).toJSON();
 * ```
 */
declare function defineResource(options: DefineResourceOptions): ResourceConstructor;
//#endregion
export { DefineResourceOptions, defineResource };
//# sourceMappingURL=define-resource.d.mts.map