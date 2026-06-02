import { Resource } from "./resource.mjs";
//#region ../../@warlock.js/core/src/resource/register-resource.ts
/**
* Decorator for hand-written Resource classes.
* Triggers one-time schema normalization (converts string cast types into
* pre-built ResourceFieldBuilder instances) so transformOutput runs against
* builders without per-call overhead.
*
* @example
* ```typescript
* @RegisterResource()
* class PostResource extends Resource {
*   static schema = {
*     id: "number",
*     title: "string",
*     keywords: "string[]",
*   };
* }
* ```
*/
function RegisterResource() {
	return function(target) {
		target.parsedSchema = Resource.normalizeSchema(target.schema);
	};
}
//#endregion
export { RegisterResource };

//# sourceMappingURL=register-resource.mjs.map