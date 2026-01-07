import { Resource } from "./resource";
import type { ResourceSchema } from "./types";

/**
 * Options for defining a resource
 */
export type DefineResourceOptions = {
  /**
   * Resource schema - field mapping configuration
   */
  schema: ResourceSchema;

  /**
   * Optional: Boot hook - called before transformation
   */
  boot?: (resource?: Resource) => void;

  /**
   * Optional: Extend hook - called after transformation
   */
  extend?: (resource?: Resource) => void;

  /**
   * Optional: Transform hook - modify final output
   */
  transform?: (data: Record<string, any>, resource: Resource) => Record<string, any>;
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
export function defineResource(options: DefineResourceOptions) {
  return class AnonymousResource extends Resource {
    public schema = options.schema;

    protected boot() {
      if (options.boot) {
        options.boot.call(this, this as unknown as Resource);
      }
    }

    protected extend() {
      if (options.extend) {
        options.extend.call(this, this as unknown as Resource);
      }

      if (options.transform) {
        options.transform.call(this, this.data, this);
      }
    }
  };
}
