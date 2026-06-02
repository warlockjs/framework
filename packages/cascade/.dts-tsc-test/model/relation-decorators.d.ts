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
import { type Lazy } from "@mongez/reinforcements";
import type { BelongsToManyOptions, BelongsToOptions, HasManyOptions, HasOneOptions } from "../relations/types";
import type { ChildModel, Model } from "./model";
/**
 * Key used to stash relation definitions on the decorator metadata object.
 * Exported so `@RegisterModel` (in `register-model.ts`) can read it back.
 */
export declare const RELATION_METADATA_KEY: unique symbol;
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
export declare const BelongsTo: (modelRelation: string | ChildModel<Model> | Lazy<unknown>, options?: string | BelongsToOptions | undefined) => <This>(_value: undefined, context: ClassFieldDecoratorContext<This>) => void;
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
export declare const HasOne: (modelRelation: string | ChildModel<Model> | Lazy<unknown>, options?: string | HasOneOptions | undefined) => <This>(_value: undefined, context: ClassFieldDecoratorContext<This>) => void;
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
export declare const HasMany: (modelRelation: string | ChildModel<Model> | Lazy<unknown>, options?: string | HasManyOptions | undefined) => <This>(_value: undefined, context: ClassFieldDecoratorContext<This>) => void;
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
export declare const BelongsToMany: (modelRelation: string | ChildModel<Model> | Lazy<unknown>, options?: string | BelongsToManyOptions | undefined) => <This>(_value: undefined, context: ClassFieldDecoratorContext<This>) => void;
//# sourceMappingURL=relation-decorators.d.ts.map