import { capitalize } from "@mongez/reinforcements";
//#region ../../@warlock.js/cascade/src/model/relation-decorators.ts
/**
* @fileoverview TC39 Stage 3 class field decorators for declaring model
* relations directly on the field.
*
* Replaces the legacy `static relations = { name: hasMany("Foo") }` shape
* with co-located, single-declaration syntax:
*
* @example
* ```ts
* @RegisterModel()
* class User extends Model {
*   @BelongsTo("Organization") organization?: Organization;
*   @HasOne("Profile") profile?: Profile;
*   @HasMany("Post") posts?: Post[];
*   @BelongsToMany("Group") groups?: Group[];
* }
* ```
*
* Foreign keys, local keys, and pivot tables are inferred from model names
* via the convention helpers in `relations/key-conventions.ts`. Inline
* options on the decorator override the conventions per relation.
*
* @module @warlock.js/cascade/model/relation-decorators
*/
/**
* Map raw decorator inputs into a `RelationDefinition` of the canonical
* shape consumed by the relation loader, pivot operations, etc.
*
* Note: foreign-key / pivot-table defaults are NOT resolved here — they
* live on each runtime resolution path (`RelationLoader`, `PivotOperations`,
* the postgres query builder) and read from `key-conventions.ts`. Recording
* `undefined` here keeps a single source of truth for the inference logic.
*/
function buildRelationDefinition(type, model, options) {
	const localKey = type === "belongsTo" ? options?.ownerKey : options?.localKey;
	return {
		type,
		model,
		foreignKey: options?.foreignKey,
		localKey,
		pivot: options?.pivot,
		pivotLocalKey: options?.pivotLocalKey,
		pivotForeignKey: options?.pivotForeignKey,
		select: options?.select
	};
}
/**
* Stash a relation definition into the class-level decorator metadata bag.
*
* **Why metadata, not addInitializer?** `context.addInitializer` on a
* *field* decorator fires per-instance, not per-class — so it only runs
* when `new ModelClass(...)` is called. Class-level operations like
* `Organization.withCount("users")` never construct instances, which means
* an initializer-based registration would leave `Organization.relations`
* permanently empty.
*
* TC39 stage 3 `context.metadata` is the right tool: a shared object across
* every decorator on the same class declaration. Field decorators write
* into it during decoration; `@RegisterModel` (a class decorator that runs
* AFTER all field decorators) reads it back and copies the relations onto
* the class's static `relations` map.
*
* The metadata object also prototype-chains to the parent class's metadata
* (per spec), so a subclass naturally inherits its parent's relations.
*/
function stashRelationInMetadata(metadata, relationName, definition) {
	let relations = metadata[RELATION_METADATA_KEY];
	if (!Object.prototype.hasOwnProperty.call(metadata, RELATION_METADATA_KEY)) {
		relations = { ...relations ?? {} };
		metadata[RELATION_METADATA_KEY] = relations;
	}
	relations[relationName] = definition;
}
/**
* Key used to stash relation definitions on the decorator metadata object.
* Exported so `@RegisterModel` (in `register-model.ts`) can read it back.
*/
const RELATION_METADATA_KEY = Symbol.for("@warlock.js/cascade:relations");
/**
* Builds a TC39 stage 3 class-field decorator that registers a relation
* of the given `type`. Each public decorator (`@BelongsTo`, `@HasMany`,
* etc.) is a thin specialisation of this factory.
*/
function makeRelationDecorator(type) {
	return function(modelRelation, options) {
		return function(_value, context) {
			if (context.kind !== "field") throw new Error(`@${capitalize(type)} can only be applied to class fields — got "${context.kind}".`);
			const relationName = String(context.name);
			const definition = buildRelationDefinition(type, modelRelation, resolveOptions(options));
			stashRelationInMetadata(context.metadata, relationName, definition);
		};
	};
}
/**
* Normalise the decorator's second argument.
*
* Accepts three shapes:
* - Omitted (`undefined`): all defaults come from the runtime convention
*   helpers (`inferBelongsToForeignKey`, `inferHasForeignKey`, …) per
*   relation type. We must NOT pre-fill `foreignKey` here — the right
*   convention depends on the relation type AND the *owner* model name,
*   which the decorator doesn't know.
* - String: shorthand for `{ foreignKey: <string> }`, matching the legacy
*   `belongsTo("Foo", "fk_col")` helper.
* - Object: passed through as-is.
*/
function resolveOptions(options) {
	if (typeof options === "string") return { foreignKey: options };
	return options;
}
/**
* Declares a `belongsTo` relation on a model field.
*
* The foreign key lives on **this** model and points at the related
* model's primary key. Defaults: FK column inferred as `{relationName}_id`
* (snake-cased) — e.g. `organization_id` for `organization?: Organization`.
*
* @param model - The related model, in any of three forms:
*   - `"User"` — registered name (requires `@RegisterModel()` on target).
*   - `User` — direct class reference (cleanest for non-cycle relations).
*   - `lazy(() => User)` — typed but cycle-safe (use when the two model
*     files import each other).
* @param options - Inline overrides for FK / owner key / column select
*
* @example
* ```ts
* import { lazy } from "@mongez/reinforcements";
*
* class User extends Model {
*   @BelongsTo(Organization) public organization?: Organization;
*   @BelongsTo("User", { foreignKey: "manager_id" }) public manager?: User;
*   @BelongsTo(lazy(() => Team)) public team?: Team; // cycle case
* }
* ```
*/
const BelongsTo = makeRelationDecorator("belongsTo");
/**
* Declares a `hasOne` relation on a model field.
*
* The foreign key lives on the **related** model and points back at this
* model's primary key. Defaults: FK column inferred as
* `{thisModelSnakeName}_id` (e.g. `user_id` on the `Profile` table).
*
* @example
* ```ts
* class User extends Model {
*   @HasOne("Profile") profile?: Profile;
*   @HasOne("UserSettings", { foreignKey: "owner_id" }) settings?: UserSettings;
* }
* ```
*/
const HasOne = makeRelationDecorator("hasOne");
/**
* Declares a `hasMany` relation on a model field.
*
* Same shape as `@HasOne` but loads an array. The foreign key lives on
* the related model. Defaults: FK column inferred as
* `{thisModelSnakeName}_id`.
*
* @example
* ```ts
* class User extends Model {
*   @HasMany("Post") posts?: Post[];
*   @HasMany("Comment", { foreignKey: "author_id" }) comments?: Comment[];
* }
* ```
*/
const HasMany = makeRelationDecorator("hasMany");
/**
* Declares a `belongsToMany` relation on a model field.
*
* Defaults: pivot table inferred as the alphabetical snake-case join of
* the two model names (`Post` + `Tag` → `post_tag`); pivot columns
* inferred as `{modelSnakeName}_id` on each side.
*
* @example
* ```ts
* class Post extends Model {
*   @BelongsToMany("Tag") tags?: Tag[];
*   @BelongsToMany("User", { pivot: "post_collaborators" }) collaborators?: User[];
* }
* ```
*/
const BelongsToMany = makeRelationDecorator("belongsToMany");
//#endregion
export { BelongsTo, BelongsToMany, HasMany, HasOne, RELATION_METADATA_KEY };

//# sourceMappingURL=relation-decorators.mjs.map