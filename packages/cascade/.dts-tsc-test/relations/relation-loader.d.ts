/**
 * @fileoverview Core relation loading logic for the Cascade ORM.
 *
 * The RelationLoader is responsible for efficiently loading related models
 * while preventing N+1 query problems through batch loading strategies.
 *
 * @module @warlock.js/cascade/relations/relation-loader
 */
import type { ChildModel, Model } from "../model/model";
import type { LoadedRelationResult, RelationConstraints } from "./types";
/**
 * Attach a loaded relation onto a model instance, keeping the
 * `loadedRelations` Map and the direct property access in sync.
 *
 * The property is installed as a `defineProperty` getter/setter façade over
 * the Map — `model.posts` reads from `loadedRelations.get("posts")`, and
 * assigning `model.posts = newPosts` writes back to the Map. Eliminates the
 * historical drift between the two storage slots: any mutation visible via
 * one path is visible via the other.
 *
 * Used by both `RelationLoader` (the `with()` path) and the Postgres
 * driver's `attachJoinedRelations` (the `joinWith()` path).
 *
 * @example
 *   attachLoadedRelation(user, "posts", postsArray);
 *   user.posts === user.loadedRelations.get("posts"); // always true
 */
export declare function attachLoadedRelation(model: object, name: string, value: LoadedRelationResult): void;
/**
 * Efficiently loads relationships for one or more model instances.
 *
 * The RelationLoader handles:
 * - Batch loading to prevent N+1 query problems
 * - Nested relation loading via dot notation
 * - Constrained loading with query callbacks
 * - All relation types (hasOne, hasMany, belongsTo, belongsToMany)
 *
 * @template TModel - The type of model being loaded
 *
 * @example
 * ```typescript
 * const users = await User.query().get();
 * const loader = new RelationLoader(users, User);
 *
 * // Load single relation
 * await loader.load("posts");
 *
 * // Load multiple relations
 * await loader.load(["posts", "organization"]);
 *
 * // Load nested relations
 * await loader.load("posts.comments.author");
 *
 * // Load with constraints
 * await loader.load("posts", {
 *   posts: (query) => query.where("isPublished", true),
 * });
 * ```
 */
export declare class RelationLoader<TModel extends Model = Model> {
    /**
     * The model instances to load relations for.
     */
    private readonly models;
    /**
     * The model class constructor.
     */
    private readonly modelClass;
    /**
     * Creates a new RelationLoader instance.
     *
     * @param models - The model instances to load relations for
     * @param modelClass - The model class constructor
     */
    constructor(models: TModel[], modelClass: ChildModel<TModel>);
    /**
     * Read the configured relation conventions from this model's data
     * source. Returns `undefined` when no overrides are set — the inference
     * helpers fall back to framework defaults in that case.
     */
    private get relationDefaults();
    /**
     * Loads one or more relations for all model instances.
     *
     * @param relations - A single relation name, array of names, or constraints object
     * @param constraints - Optional constraints to apply to the loading query
     *
     * @example
     * ```typescript
     * // Single relation
     * await loader.load("posts");
     *
     * // Multiple relations
     * await loader.load(["posts", "organization"]);
     *
     * // With constraints
     * await loader.load("posts", {
     *   posts: (query) => query.where("status", "active"),
     * });
     * ```
     */
    load(relations: string | string[], constraints?: RelationConstraints): Promise<void>;
    /**
     * Loads a single relation, handling nested relations via dot notation.
     *
     * @param name - The relation name, possibly with dot notation for nesting
     * @param constraint - Optional constraint callback
     */
    private loadRelation;
    /**
     * Loads a hasMany relation for all models.
     *
     * @param name - The relation name
     * @param definition - The relation definition
     * @param constraint - Optional constraint callback
     */
    private loadHasMany;
    /**
     * Loads a hasOne relation for all models.
     *
     * @param name - The relation name
     * @param definition - The relation definition
     * @param constraint - Optional constraint callback
     */
    private loadHasOne;
    /**
     * Loads a belongsTo relation for all models.
     *
     * @param name - The relation name
     * @param definition - The relation definition
     * @param constraint - Optional constraint callback
     */
    private loadBelongsTo;
    /**
     * Loads a belongsToMany relation for all models.
     *
     * @param name - The relation name
     * @param definition - The relation definition
     * @param constraint - Optional constraint callback
     */
    private loadBelongsToMany;
    /**
     * Loads nested relations recursively.
     *
     * @param parentRelation - The name of the parent relation
     * @param remainingPath - The remaining path segments to load
     * @param constraint - Optional constraint callback
     */
    private loadNestedRelations;
    /**
     * Parses a dot-notation relation path into segments.
     *
     * @param path - The relation path (e.g., "posts.comments.author")
     * @returns An array of relation names
     */
    private parseNestedRelation;
    /**
     * Resolves a model class from the registry by name.
     *
     * @param name - The registered model name
     * @returns The model class constructor
     * @throws Error if the model is not found in the registry
     */
    private resolveModelClass;
    /**
     * Gets the relation definition from the model class.
     *
     * @param name - The relation name
     * @returns The relation definition or undefined
     */
    private getRelationDefinition;
    /**
     * Collects unique key values from all models.
     *
     * @param key - The key to collect values for
     * @returns An array of unique key values
     */
    private collectKeyValues;
    /**
     * Groups records by a key value.
     *
     * @param records - The records to group
     * @param key - The key to group by
     * @returns A map of key values to records
     */
    private groupBy;
    /**
     * Sets a relation value on all models using a getter function.
     *
     * @param name - The relation name
     * @param getter - Function that returns the relation value for each model
     */
    private setRelationOnModels;
    /**
     * Gets a loaded relation from a model instance.
     *
     * @param model - The model instance
     * @param name - The relation name
     * @returns The loaded relation value or undefined
     */
    private getLoadedRelation;
    /**
     * Sets a loaded relation on a model instance.
     *
     * @param model - The model instance
     * @param name - The relation name
     * @param value - The relation value
     */
    private setLoadedRelation;
}
//# sourceMappingURL=relation-loader.d.ts.map