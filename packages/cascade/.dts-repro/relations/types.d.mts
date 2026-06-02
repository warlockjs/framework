import { ChildModel } from "../model/model.types.mjs";
import { Model } from "../model/model.mjs";
import { QueryBuilderContract } from "../contracts/query-builder.contract.mjs";
import { Lazy } from "@mongez/reinforcements";

//#region ../../@warlock.js/cascade/src/relations/types.d.ts
/**
 * The type of relationship between models.
 *
 * - `hasOne`: One-to-one relationship where the foreign key is on the related model
 * - `hasMany`: One-to-many relationship where the foreign key is on the related model
 * - `belongsTo`: Inverse of hasOne/hasMany where the foreign key is on this model
 * - `belongsToMany`: Many-to-many relationship through a pivot table
 *
 * @example
 * ```typescript
 * // User hasOne Profile (profile.userId references user.id)
 * // User hasMany Posts (post.userId references user.id)
 * // Post belongsTo User (post.userId references user.id)
 * // Post belongsToMany Tags (through post_tags pivot table)
 * ```
 */
type RelationType = "hasOne" | "hasMany" | "belongsTo" | "belongsToMany";
/**
 * Complete definition of a model relationship.
 *
 * This interface describes how two models are connected, including
 * the type of relationship and the keys used for joining.
 *
 * @example
 * ```typescript
 * const postsRelation: RelationDefinition = {
 *   type: "hasMany",
 *   model: "Post",
 *   foreignKey: "userId",
 *   localKey: "id",
 * };
 * ```
 */
type RelationDefinition = {
  /**
   * The type of relationship.
   */
  readonly type: RelationType;
  /**
   * The related model — accepts three forms:
   *  - **String** registered via `@RegisterModel()` — indirect lookup,
   *    cycle-safe because resolution is dynamic. Required for cross-package
   *    refs that can't import the class.
   *  - **Direct class reference** — idiomatic and type-safe. Cleanest
   *    choice when no import cycle exists between the two model files.
   *  - **`lazy(() => SomeModel)`** — type-safe AND cycle-safe. The
   *    closure defers reading the binding until query time, sidestepping
   *    the ESM partial-load gotcha that breaks direct refs in cycles.
   *
   * The framework resolves all three via `resolveModelClass()` from
   * `model/register-model.ts`. Direct class and lazy refs carry the class
   * directly, so their target does NOT need to be registered.
   */
  readonly model: string | ChildModel<Model> | Lazy<unknown>;
  /**
   * The foreign key field on the related model (for hasOne/hasMany)
   * or on this model (for belongsTo).
   *
   * For belongsToMany, this is the key on the related model.
   */
  readonly foreignKey?: string;
  /**
   * The local key field on this model that the foreign key references.
   *
   * @default "id"
   */
  readonly localKey?: string;
  /**
   * The pivot table name (only for belongsToMany relationships).
   */
  readonly pivot?: string;
  /**
   * The column in the pivot table that references this model's primary key.
   * Only applicable for belongsToMany relationships.
   */
  readonly pivotLocalKey?: string;
  /**
   * The column in the pivot table that references the related model's primary key.
   * Only applicable for belongsToMany relationships.
   */
  readonly pivotForeignKey?: string;
  /**
   * List of specific columns to select.
   *
   * If not provided, defaults to all columns.
   */
  readonly select?: string[];
};
/**
 * Configuration options for a hasMany relationship.
 *
 * @example
 * ```typescript
 * // User has many Posts via post.userId
 * static relations = {
 *   posts: hasMany("Post", { foreignKey: "userId" }),
 * };
 * ```
 */
type HasManyOptions = {
  /**
   * The foreign key field on the related model.
   *
   * If not provided, defaults to `{thisModelName}Id` (e.g., `userId` for User model).
   */
  readonly foreignKey?: string;
  /**
   * The local key field on this model that the foreign key references.
   *
   * @default "id"
   */
  readonly localKey?: string;
  /**
   * List of specific columns to select.
   *
   * If not provided, defaults to all columns.
   */
  readonly select?: string[];
};
/**
 * Configuration options for a hasOne relationship.
 *
 * @example
 * ```typescript
 * // User has one Profile via profile.userId
 * static relations = {
 *   profile: hasOne("Profile", { foreignKey: "userId" }),
 * };
 * ```
 */
type HasOneOptions = {
  /**
   * The foreign key field on the related model.
   *
   * If not provided, defaults to `{thisModelName}Id` (e.g., `userId` for User model).
   */
  readonly foreignKey?: string;
  /**
   * The local key field on this model that the foreign key references.
   *
   * @default "id"
   */
  readonly localKey?: string;
  /**
   * List of specific columns to select.
   *
   * If not provided, defaults to all columns.
   */
  readonly select?: string[];
};
/**
 * Configuration options for a belongsTo relationship.
 *
 * @example
 * ```typescript
 * // Post belongs to User via post.userId
 * static relations = {
 *   author: belongsTo("User", { foreignKey: "userId" }),
 * };
 * ```
 */
type BelongsToOptions = {
  /**
   * The foreign key field on this model that references the related model.
   *
   * If not provided, defaults to `{relationName}Id` (e.g., `authorId` for author relation).
   */
  readonly foreignKey?: string;
  /**
   * The primary key field on the related model.
   *
   * @default "id"
   */
  readonly ownerKey?: string;
  /**
   * List of specific columns to select from the related model.
   */
  readonly select?: string[];
};
/**
 * Configuration options for a belongsToMany relationship.
 *
 * @example
 * ```typescript
 * // Post belongs to many Tags via post_tags pivot table
 * static relations = {
 *   tags: belongsToMany("Tag", {
 *     pivot: "post_tags",
 *     localKey: "postId",
 *     foreignKey: "tagId",
 *   }),
 * };
 * ```
 */
type BelongsToManyOptions = {
  /**
   * The pivot table name that connects the two models.
   *
   * If omitted, defaults to the alphabetical snake-case join of the two
   * model names (e.g. `post_tag` for `Post` ↔ `Tag`).
   */
  readonly pivot?: string;
  /**
   * The column in the pivot table that references this model's primary key.
   *
   * If not provided, defaults to `{thisModelName}Id`.
   */
  readonly localKey?: string;
  /**
   * The column in the pivot table that references the related model's primary key.
   *
   * If not provided, defaults to `{relatedModelName}Id`.
   */
  readonly foreignKey?: string;
  /**
   * The primary key of this model that the pivot table references.
   *
   * @default "id"
   */
  readonly pivotLocalKey?: string;
  /**
   * The primary key of the related model that the pivot table references.
   *
   * @default "id"
   */
  readonly pivotForeignKey?: string;
  /**
   * List of specific columns to select from the related model.
   */
  readonly select?: string[];
};
/**
 * Callback function to apply constraints when loading a relation.
 *
 * @example
 * ```typescript
 * User.query().with("posts", (query) => {
 *   query.where("isPublished", true).orderBy("createdAt", "desc");
 * });
 * ```
 */
type RelationConstraintCallback = (query: QueryBuilderContract) => void;
/**
 * Constraints to apply when loading relations.
 *
 * Can be:
 * - A single constraint callback for a relation
 * - An object mapping relation names to constraint callbacks or boolean values
 *
 * @example
 * ```typescript
 * // Object form
 * await User.loadRelations(users, {
 *   posts: (query) => query.where("isPublished", true),
 *   organization: true,
 * });
 * ```
 */
type RelationConstraints = Record<string, boolean | RelationConstraintCallback>;
/**
 * Type for the result of loading a relation.
 *
 * - For hasOne/belongsTo: A single model instance or null
 * - For hasMany/belongsToMany: An array of model instances
 */
type LoadedRelationResult = Model | Model[] | null;
/**
 * Map that stores loaded relation data on a model instance.
 *
 * @example
 * ```typescript
 * // After user.load("posts", "profile")
 * user.loadedRelations.get("posts"); // Post[]
 * user.loadedRelations.get("profile"); // Profile | null
 * ```
 */
type LoadedRelationsMap = Map<string, LoadedRelationResult>;
/**
 * A map of relation names to their definitions.
 *
 * This is the type for the static `relations` property on models.
 *
 * @example
 * ```typescript
 * class User extends Model {
 *   static relations: RelationDefinitions = {
 *     posts: hasMany("Post"),
 *     profile: hasOne("Profile"),
 *     organization: belongsTo("Organization"),
 *   };
 * }
 * ```
 */
type RelationDefinitions = Record<string, RelationDefinition>;
/**
 * Additional data to store in the pivot table for many-to-many relationships.
 *
 * @example
 * ```typescript
 * await post.attach("tags", [1, 2, 3], { addedBy: userId, addedAt: new Date() });
 * ```
 */
type PivotData = Record<string, unknown>;
/**
 * IDs that can be used for pivot operations.
 * Supports both numeric and string IDs.
 */
type PivotIds = (number | string)[];
//#endregion
export { BelongsToManyOptions, BelongsToOptions, HasManyOptions, HasOneOptions, LoadedRelationResult, LoadedRelationsMap, PivotData, PivotIds, RelationConstraintCallback, RelationConstraints, RelationDefinition, RelationDefinitions, RelationType };
//# sourceMappingURL=types.d.mts.map