import { Resource, type ResourceConstructor, type ResourceContract } from "./resource";
import type { ResourceOutputOf, ResourceSchema } from "./types";

/**
 * Options for defining a resource
 *
 * `S` is the literal schema type; it is what `defineResource` reads the output type from.
 */
export type DefineResourceOptions<S extends ResourceSchema = ResourceSchema> = {
  /**
   * Resource schema - field mapping configuration
   */
  schema: S;

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
 * The JSON output type is inferred from the literal cast strings in `schema`,
 * so `toJSON()` is typed instead of a generic object:
 * - `"string"`, `"localized"`, `"url"`, `"uploadsUrl"`, `"storageUrl"` -> `string`
 * - `"number"`, `"float"`, `"int"` -> `number`; `"boolean"` -> `boolean`
 * - `"date"` -> `{ iso; format; timestamp; humanTime }` (the default date output)
 * - `"object"` -> `Record<string, unknown>`; `"array"` -> `unknown[]`
 * - `[]` -> array of the cast, `?` -> `T | null` (always present, never an optional key)
 * - nested resources, lazy resources, `["inputKey", cast]` tuples, resolver functions,
 *   `arrayOf` schemas and `"self"` / `"self[]"` resolve to their own output type
 * - builder fields (`this.date().format(...)`) are `unknown`
 *
 * The type reflects the schema only. When `transform`, `boot`, `extend` or a builder
 * changes the real shape, declare the output yourself with an explicit type argument.
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
 *     name: "string?",
 *     tags: "string[]",
 *   },
 * });
 *
 * // Usage — json is { id: number; name: string | null; tags: string[] }
 * const json = new UserResource(user).toJSON();
 *
 * // Read the output type elsewhere
 * type UserJson = ResourceOutput<typeof UserResource>;
 *
 * // Self reference
 * export const CategoryResource = defineResource({
 *   schema: {
 *     id: "number",
 *     name: "localized",
 *     children: "self[]",
 *   },
 * });
 *
 * // Explicit output: the hooks change the shape, so you state it.
 * // `defineResource<Out>(...)` replaces the inferred type with `Out`.
 * type ProductJson = { id: number; title: string; priceLabel: string };
 *
 * export const ProductResource = defineResource<ProductJson>({
 *   schema: { id: "number", title: "string", price: "number" },
 *   transform: (data) => {
 *     data.priceLabel = "$" + data.price;
 *     delete data.price;
 *
 *     return data;
 *   },
 * });
 *
 * // A cast also works when the declared type overlaps the inferred one:
 * // defineResource({ schema, transform }) as ResourceConstructor<ProductJson>
 * ```
 */
export function defineResource<const S extends ResourceSchema>(
  options: DefineResourceOptions<S>,
): ResourceConstructor<ResourceOutputOf<S>>;
export function defineResource<Out extends object, const S extends ResourceSchema = ResourceSchema>(
  options: DefineResourceOptions<S>,
): ResourceConstructor<Out>;
export function defineResource(options: DefineResourceOptions): ResourceConstructor<unknown> {
  const resource = class AnonymousResource extends Resource {
    static schema = options.schema;

    protected boot() {
      if (options.boot) {
        options.boot.call(this, this as unknown as ResourceContract);
      }
    }

    protected extend() {
      if (options.extend) {
        options.extend.call(this, this as unknown as ResourceContract);
      }

      if (options.transform) {
        options.transform.call(this, this.data, this);
      }
    }
  };

  // Normalize schema once at definition time — converts string cast types
  // (including [] and ? suffixes) into pre-built ResourceFieldBuilder instances
  resource.parsedSchema = Resource.normalizeSchema(resource.schema);

  // The runtime class is untyped; the overloads above carry the output type.
  return resource as unknown as ResourceConstructor<unknown>;
}
