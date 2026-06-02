import { Resource } from "./resource.mjs";
//#region ../../@warlock.js/core/src/resource/define-resource.ts
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
function defineResource(options) {
	const resource = class AnonymousResource extends Resource {
		static {
			this.schema = options.schema;
		}
		boot() {
			if (options.boot) options.boot.call(this, this);
		}
		extend() {
			if (options.extend) options.extend.call(this, this);
			if (options.transform) options.transform.call(this, this.data, this);
		}
	};
	resource.parsedSchema = Resource.normalizeSchema(resource.schema);
	return resource;
}
//#endregion
export { defineResource };

//# sourceMappingURL=define-resource.mjs.map