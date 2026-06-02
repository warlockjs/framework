/**
 * @fileoverview Core relation loading logic for the Cascade ORM.
 *
 * The RelationLoader is responsible for efficiently loading related models
 * while preventing N+1 query problems through batch loading strategies.
 *
 * @module @warlock.js/cascade/relations/relation-loader
 */

import { isLazy, type Lazy } from "@mongez/reinforcements";
import type { ChildModel, Model } from "../model/model";
import { getModelFromRegistry, resolveModelName } from "../model/register-model";
import {
  inferBelongsToForeignKey,
  inferHasForeignKey,
  inferPivotKey,
  inferPivotTable,
} from "./key-conventions";
import type {
  LoadedRelationResult,
  RelationConstraintCallback,
  RelationConstraints,
  RelationDefinition,
} from "./types";

// ============================================================================
// SHARED HELPER — SINGLE SOURCE OF TRUTH FOR LOADED RELATIONS
// ============================================================================

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
export function attachLoadedRelation(
  model: object,
  name: string,
  value: LoadedRelationResult,
): void {
  const modelWithRelations = model as {
    loadedRelations?: Map<string, LoadedRelationResult>;
  };

  if (!modelWithRelations.loadedRelations) {
    modelWithRelations.loadedRelations = new Map();
  }

  const relations = modelWithRelations.loadedRelations;
  relations.set(name, value);

  // Install a getter/setter on the instance so direct property access reads
  // from (and writes to) the Map. `configurable: true` lets a later reload
  // re-define the property; `enumerable: true` so JSON.stringify and
  // Object.keys see the relation.
  Object.defineProperty(model, name, {
    configurable: true,
    enumerable: true,
    get(): LoadedRelationResult | undefined {
      return relations.get(name);
    },
    set(next: LoadedRelationResult): void {
      relations.set(name, next);
    },
  });
}

// ============================================================================
// RELATION LOADER CLASS
// ============================================================================

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
export class RelationLoader<TModel extends Model = Model> {
  // ==========================================================================
  // PRIVATE PROPERTIES
  // ==========================================================================

  /**
   * The model instances to load relations for.
   */
  private readonly models: TModel[];

  /**
   * The model class constructor.
   */
  private readonly modelClass: ChildModel<TModel>;

  // ==========================================================================
  // CONSTRUCTOR
  // ==========================================================================

  /**
   * Creates a new RelationLoader instance.
   *
   * @param models - The model instances to load relations for
   * @param modelClass - The model class constructor
   */
  public constructor(models: TModel[], modelClass: ChildModel<TModel>) {
    this.models = models;
    this.modelClass = modelClass;
  }

  /**
   * Read the configured relation conventions from this model's data
   * source. Returns `undefined` when no overrides are set — the inference
   * helpers fall back to framework defaults in that case.
   */
  private get relationDefaults() {
    try {
      return this.modelClass.getDataSource()?.relationDefaults;
    } catch {
      return undefined;
    }
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

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
  public async load(
    relations: string | string[],
    constraints?: RelationConstraints,
  ): Promise<void> {
    // If no models, nothing to load
    if (this.models.length === 0) {
      return;
    }

    // Normalize to array
    const relationNames = Array.isArray(relations) ? relations : [relations];

    // Load each relation
    for (const relationName of relationNames) {
      const constraint = constraints?.[relationName];
      const callbackConstraint = typeof constraint === "function" ? constraint : undefined;

      await this.loadRelation(relationName, callbackConstraint);
    }
  }

  // ==========================================================================
  // PRIVATE METHODS - RELATION LOADING
  // ==========================================================================

  /**
   * Loads a single relation, handling nested relations via dot notation.
   *
   * @param name - The relation name, possibly with dot notation for nesting
   * @param constraint - Optional constraint callback
   */
  private async loadRelation(name: string, constraint?: RelationConstraintCallback): Promise<void> {
    const path = this.parseNestedRelation(name);
    const rootRelation = path[0];

    // Get the relation definition from the model class
    const definition = this.getRelationDefinition(rootRelation);

    if (!definition) {
      throw new Error(
        `Relation "${rootRelation}" is not defined on model "${this.modelClass.name}". ` +
          `Make sure to define it in the static 'relations' property.`,
      );
    }

    // Load based on relation type
    switch (definition.type) {
      case "hasMany":
        await this.loadHasMany(rootRelation, definition, constraint);
        break;

      case "hasOne":
        await this.loadHasOne(rootRelation, definition, constraint);
        break;

      case "belongsTo":
        await this.loadBelongsTo(rootRelation, definition, constraint);
        break;

      case "belongsToMany":
        await this.loadBelongsToMany(rootRelation, definition, constraint);
        break;
    }

    // If there are nested relations, load them recursively
    if (path.length > 1) {
      await this.loadNestedRelations(rootRelation, path.slice(1), constraint);
    }
  }

  /**
   * Loads a hasMany relation for all models.
   *
   * @param name - The relation name
   * @param definition - The relation definition
   * @param constraint - Optional constraint callback
   */
  private async loadHasMany(
    name: string,
    definition: RelationDefinition,
    constraint?: RelationConstraintCallback,
  ): Promise<void> {
    const RelatedModel = this.resolveModelClass(definition.model);
    const localKey = definition.localKey ?? this.modelClass.primaryKey ?? "id";
    const foreignKey = definition.foreignKey ?? inferHasForeignKey(this.modelClass.name, this.relationDefaults);

    // Collect all local key values
    const localKeyValues = this.collectKeyValues(localKey);

    if (localKeyValues.length === 0) {
      // No values to query, set empty arrays
      this.setRelationOnModels(name, () => []);
      return;
    }

    // Build and execute query
    const query = RelatedModel.query().whereIn(foreignKey, localKeyValues);

    if (constraint) {
      constraint(query);
    }

    const relatedRecords = await query.get();

    // Group by foreign key and assign to models
    const recordsByForeignKey = this.groupBy(relatedRecords as Model[], foreignKey);

    this.setRelationOnModels(name, (model) => {
      const keyValue = model.get(localKey);
      return recordsByForeignKey.get(keyValue) ?? [];
    });
  }

  /**
   * Loads a hasOne relation for all models.
   *
   * @param name - The relation name
   * @param definition - The relation definition
   * @param constraint - Optional constraint callback
   */
  private async loadHasOne(
    name: string,
    definition: RelationDefinition,
    constraint?: RelationConstraintCallback,
  ): Promise<void> {
    const RelatedModel = this.resolveModelClass(definition.model);
    const localKey = definition.localKey ?? this.modelClass.primaryKey ?? "id";
    const foreignKey = definition.foreignKey ?? inferHasForeignKey(this.modelClass.name, this.relationDefaults);

    // Collect all local key values
    const localKeyValues = this.collectKeyValues(localKey);

    if (localKeyValues.length === 0) {
      this.setRelationOnModels(name, () => null);
      return;
    }

    // Build and execute query
    const query = RelatedModel.query().whereIn(foreignKey, localKeyValues);

    if (constraint) {
      constraint(query);
    }

    const relatedRecords = await query.get();

    // Index by foreign key
    const recordsByForeignKey = new Map<unknown, Model>();
    for (const record of relatedRecords as Model[]) {
      const fkValue = record.get(foreignKey);
      // For hasOne, take the first match only
      if (!recordsByForeignKey.has(fkValue)) {
        recordsByForeignKey.set(fkValue, record);
      }
    }

    this.setRelationOnModels(name, (model) => {
      const keyValue = model.get(localKey);
      return recordsByForeignKey.get(keyValue) ?? null;
    });
  }

  /**
   * Loads a belongsTo relation for all models.
   *
   * @param name - The relation name
   * @param definition - The relation definition
   * @param constraint - Optional constraint callback
   */
  private async loadBelongsTo(
    name: string,
    definition: RelationDefinition,
    constraint?: RelationConstraintCallback,
  ): Promise<void> {
    const RelatedModel = this.resolveModelClass(definition.model);
    const foreignKey = definition.foreignKey ?? inferBelongsToForeignKey(name, this.relationDefaults);
    const ownerKey = definition.localKey ?? RelatedModel.primaryKey ?? "id";

    // Collect all foreign key values from the models
    const foreignKeyValues = this.collectKeyValues(foreignKey);

    if (foreignKeyValues.length === 0) {
      this.setRelationOnModels(name, () => null);
      return;
    }

    // Build and execute query
    const query = RelatedModel.query().whereIn(ownerKey, foreignKeyValues);

    if (constraint) {
      constraint(query);
    }

    const relatedRecords = await query.get();

    // Index by owner key
    const recordsByOwnerKey = new Map<unknown, Model>();
    for (const record of relatedRecords as Model[]) {
      const keyValue = record.get(ownerKey);
      recordsByOwnerKey.set(keyValue, record);
    }

    this.setRelationOnModels(name, (model) => {
      const fkValue = model.get(foreignKey);
      return recordsByOwnerKey.get(fkValue) ?? null;
    });
  }

  /**
   * Loads a belongsToMany relation for all models.
   *
   * @param name - The relation name
   * @param definition - The relation definition
   * @param constraint - Optional constraint callback
   */
  private async loadBelongsToMany(
    name: string,
    definition: RelationDefinition,
    constraint?: RelationConstraintCallback,
  ): Promise<void> {
    const RelatedModel = this.resolveModelClass(definition.model);
    const relatedModelName = resolveModelName(definition.model);
    const pivotTable =
      definition.pivot ??
      inferPivotTable(this.modelClass.name, relatedModelName, this.relationDefaults);
    const localKey = definition.pivotLocalKey ?? this.modelClass.primaryKey ?? "id";
    const pivotLocalKey =
      definition.localKey ?? inferPivotKey(this.modelClass.name, this.relationDefaults);
    const pivotForeignKey =
      definition.foreignKey ?? inferPivotKey(relatedModelName, this.relationDefaults);
    const relatedKey = definition.pivotForeignKey ?? RelatedModel.primaryKey ?? "id";

    // Collect all local key values
    const localKeyValues = this.collectKeyValues(localKey);

    if (localKeyValues.length === 0) {
      this.setRelationOnModels(name, () => []);
      return;
    }

    // Step 1: Query the pivot table to get the relationships
    const dataSource = this.modelClass.getDataSource();
    const pivotQuery = dataSource.driver
      .queryBuilder(pivotTable)
      .whereIn(pivotLocalKey, localKeyValues);

    const pivotRecords = (await pivotQuery.get()) as Record<string, unknown>[];

    if (pivotRecords.length === 0) {
      this.setRelationOnModels(name, () => []);
      return;
    }

    // Step 2: Collect related model IDs from pivot
    const relatedIds = [...new Set(pivotRecords.map((p) => p[pivotForeignKey]))];

    // Step 3: Query the related model
    const relatedQuery = RelatedModel.query().whereIn(relatedKey, relatedIds);

    if (constraint) {
      constraint(relatedQuery);
    }

    const relatedRecords = await relatedQuery.get();

    // Step 4: Index related records by their key
    const relatedById = new Map<unknown, Model>();
    for (const record of relatedRecords as Model[]) {
      relatedById.set(record.get(relatedKey), record);
    }

    // Step 5: Build the relationship map from pivot data
    const relationshipMap = new Map<unknown, Model[]>();

    for (const pivot of pivotRecords) {
      const localValue = pivot[pivotLocalKey];
      const foreignValue = pivot[pivotForeignKey];
      const relatedRecord = relatedById.get(foreignValue);

      if (relatedRecord) {
        if (!relationshipMap.has(localValue)) {
          relationshipMap.set(localValue, []);
        }
        relationshipMap.get(localValue)!.push(relatedRecord);
      }
    }

    this.setRelationOnModels(name, (model) => {
      const keyValue = model.get(localKey);
      return relationshipMap.get(keyValue) ?? [];
    });
  }

  // ==========================================================================
  // PRIVATE METHODS - NESTED RELATIONS
  // ==========================================================================

  /**
   * Loads nested relations recursively.
   *
   * @param parentRelation - The name of the parent relation
   * @param remainingPath - The remaining path segments to load
   * @param constraint - Optional constraint callback
   */
  private async loadNestedRelations(
    parentRelation: string,
    remainingPath: string[],
    constraint?: RelationConstraintCallback,
  ): Promise<void> {
    // Collect all loaded related models from the parent relation
    const relatedModels: Model[] = [];

    for (const model of this.models) {
      const loaded = this.getLoadedRelation(model, parentRelation);

      if (Array.isArray(loaded)) {
        relatedModels.push(...loaded);
      } else if (loaded) {
        relatedModels.push(loaded);
      }
    }

    if (relatedModels.length === 0) {
      return;
    }

    // Get the related model class
    const parentDefinition = this.getRelationDefinition(parentRelation);
    if (!parentDefinition) return;

    const RelatedModelClass = this.resolveModelClass(parentDefinition.model);

    // Create a new loader for the nested relation
    const nestedLoader = new RelationLoader(relatedModels, RelatedModelClass as ChildModel<Model>);

    // Load the next level
    const nextRelation = remainingPath.join(".");
    await nestedLoader.load(nextRelation, constraint ? { [nextRelation]: constraint } : undefined);
  }

  // ==========================================================================
  // PRIVATE METHODS - UTILITIES
  // ==========================================================================

  /**
   * Parses a dot-notation relation path into segments.
   *
   * @param path - The relation path (e.g., "posts.comments.author")
   * @returns An array of relation names
   */
  private parseNestedRelation(path: string): string[] {
    return path.split(".");
  }

  /**
   * Resolves a model class from the registry by name.
   *
   * @param name - The registered model name
   * @returns The model class constructor
   * @throws Error if the model is not found in the registry
   */
  private resolveModelClass(
    model: string | ChildModel<Model> | Lazy<unknown>,
  ): ChildModel<Model> {
    if (typeof model === "function") return model;
    if (isLazy(model)) return model.resolve() as ChildModel<Model>;

    const ModelClass = getModelFromRegistry(model);

    if (!ModelClass) {
      const callerName = this.modelClass.name || "unknown";
      throw new Error(
        `Cannot resolve relation target — model "${model}" is not registered.\n` +
          `  Caller: ${callerName} (relation target reference)\n` +
          `  Common causes:\n` +
          `    - The target model is missing the @RegisterModel() decorator\n` +
          `    - The target model's module is not imported anywhere at startup\n` +
          `    - Circular import between the caller and target — one of them sees\n` +
          `      the other as undefined during module load\n` +
          `  Fix: add an explicit \`import "<path-to-${model}-model>";\` to your app's\n` +
          `  entry point so the decorator runs before any query consults this relation.\n` +
          `  Alternative: declare the relation with \`lazy(() => ${model})\` instead of a string\n` +
          `  to bind directly to the class (no registry lookup needed).`,
      );
    }

    return ModelClass;
  }

  /**
   * Gets the relation definition from the model class.
   *
   * @param name - The relation name
   * @returns The relation definition or undefined
   */
  private getRelationDefinition(name: string): RelationDefinition | undefined {
    const relations = (
      this.modelClass as unknown as { relations?: Record<string, RelationDefinition> }
    ).relations;
    return relations?.[name];
  }

  /**
   * Collects unique key values from all models.
   *
   * @param key - The key to collect values for
   * @returns An array of unique key values
   */
  private collectKeyValues(key: string): unknown[] {
    const values = new Set<unknown>();

    for (const model of this.models) {
      const value = model.get(key);
      if (value !== undefined && value !== null) {
        values.add(value);
      }
    }

    return [...values];
  }

  /**
   * Groups records by a key value.
   *
   * @param records - The records to group
   * @param key - The key to group by
   * @returns A map of key values to records
   */
  private groupBy(records: Model[], key: string): Map<unknown, Model[]> {
    const groups = new Map<unknown, Model[]>();

    for (const record of records) {
      const keyValue = record.get(key);

      if (!groups.has(keyValue)) {
        groups.set(keyValue, []);
      }

      groups.get(keyValue)!.push(record);
    }

    return groups;
  }

  /**
   * Sets a relation value on all models using a getter function.
   *
   * @param name - The relation name
   * @param getter - Function that returns the relation value for each model
   */
  private setRelationOnModels(name: string, getter: (model: TModel) => LoadedRelationResult): void {
    for (const model of this.models) {
      const value = getter(model);
      this.setLoadedRelation(model, name, value);
    }
  }

  /**
   * Gets a loaded relation from a model instance.
   *
   * @param model - The model instance
   * @param name - The relation name
   * @returns The loaded relation value or undefined
   */
  private getLoadedRelation(model: TModel, name: string): LoadedRelationResult | undefined {
    const loadedRelations = (
      model as unknown as { loadedRelations?: Map<string, LoadedRelationResult> }
    ).loadedRelations;
    return loadedRelations?.get(name);
  }

  /**
   * Sets a loaded relation on a model instance.
   *
   * @param model - The model instance
   * @param name - The relation name
   * @param value - The relation value
   */
  private setLoadedRelation(model: TModel, name: string, value: LoadedRelationResult): void {
    attachLoadedRelation(model as object, name, value);
  }
}
