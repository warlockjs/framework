import { registerModelInRegistry } from "../model/register-model.mjs";
import { Model } from "../model/model.mjs";
//#region ../../@warlock.js/cascade/src/utils/define-model.ts
/**
* Define a model with a clean, concise API.
*
* This utility function creates a Model class with the specified configuration,
* reducing boilerplate and providing a more declarative way to define models.
*
* @param options - Model configuration options
* @returns A Model class with the specified configuration
*
* @example
* ```typescript
* import { defineModel } from "@warlock.js/cascade";
* import { v } from "@warlock.js/seal";
*
* export const User = defineModel({
*   table: "users",
*   schema: v.object({
*     name: v.string().required().trim(),
*     email: v.string().email().required().lowercase(),
*     password: v.string().required().min(6),
*     role: v.string().default("user"),
*   }),
*   deleteStrategy: "soft",
* });
*
* // Usage
* const user = await User.create({
*   name: "John Doe",
*   email: "john@example.com",
*   password: "secret123",
* });
* ```
*
* @example
* ```typescript
* // With type inference
* export const Post = defineModel({
*   table: "posts",
*   schema: v.object({
*     title: v.string().required(),
*     content: v.string().required(),
*     authorId: v.number().required(),
*     published: v.boolean().default(false),
*   }),
* });
*
* // TypeScript knows the exact type!
* const post = await Post.create({
*   title: "Hello World",
*   content: "My first post",
*   authorId: 1,
* });
*
* console.log(post.title); // ✅ Type-safe!
* ```
*/
function defineModel(options) {
	class DefinedModel extends Model {
		/**
		* Table/collection name
		*/
		static table = options.table;
		/**
		* Validation schema
		*/
		static schema = options.schema;
		/**
		* Delete strategy. When undefined, the runtime resolves via call options →
		* data source `defaultDeleteStrategy` → `"permanent"`.
		*/
		static deleteStrategy = options.deleteStrategy;
		/**
		* Strict mode for unknown fields. Defaults to `"strip"` to match the base
		* `Model` static default.
		*/
		static strictMode = options.strictMode || "strip";
		/**
		* Auto-generate sequential IDs (NoSQL only). Defaults to `true` to match
		* the base `Model` static default.
		*/
		static autoGenerateId = options.autoGenerateId ?? true;
		/**
		* Random increment for auto-generated IDs. When undefined, falls through
		* to the data-source default.
		*/
		static randomIncrement = options.randomIncrement;
		/**
		* Initial ID value for the first record when auto-generating IDs. When
		* undefined, falls through to the data-source default.
		*/
		static initialId = options.initialId;
	}
	if (options.properties) Object.defineProperties(DefinedModel.prototype, Object.getOwnPropertyDescriptors(options.properties));
	if (options.name) registerModelInRegistry(options.name, DefinedModel);
	if (options.statics) Object.defineProperties(DefinedModel, Object.getOwnPropertyDescriptors(options.statics));
	return DefinedModel;
}
//#endregion
export { defineModel };

//# sourceMappingURL=define-model.mjs.map