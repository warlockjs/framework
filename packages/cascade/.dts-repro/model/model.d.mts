import { DeleteStrategy, StrictMode } from "../types.mjs";
import { DatabaseDirtyTracker } from "../database-dirty-tracker.mjs";
import { ChildModel, GlobalScopeDefinition, GlobalScopeOptions, LocalScopeCallback, ModelSchema, ScopeTiming } from "./model.types.mjs";
import { ModelEventListener, ModelEventName, ModelEvents } from "../events/model-events.mjs";
import { LoadedRelationResult, PivotData, PivotIds, RelationDefinition } from "../relations/types.mjs";
import { PivotOperations } from "../relations/pivot-operations.mjs";
import { ModelSnapshot } from "../relations/relation-hydrator.mjs";
import { ModelSyncOperationContract } from "../sync/types.mjs";
import { PaginationOptions, PaginationResult, QueryBuilderContract, WhereCallback, WhereObject, WhereOperator } from "../contracts/query-builder.contract.mjs";
import { DriverContract, UpdateOperations } from "../contracts/database-driver.contract.mjs";
import { RemoverResult } from "../contracts/database-remover.contract.mjs";
import { WriterOptions } from "../contracts/database-writer.contract.mjs";
import { DataSource } from "../data-source/data-source.mjs";
import { GenericObject } from "@mongez/reinforcements";
import { ObjectValidator } from "@warlock.js/seal";

//#region ../../@warlock.js/cascade/src/model/model.d.ts
/**
 * Base class that powers all Cascade models.
 *
 * Provides:
 * - Type-safe value accessors with dot-notation support (get, set, has, unset, merge)
 * - Automatic dirty tracking for efficient partial updates
 * - Lifecycle event hooks (saving, created, deleting, etc.)
 * - Integration with the data-source registry for multi-database support
 * - Support for both per-model and global event listeners
 *
 * @template TSchema - The shape of the model's underlying data
 *
 * @example
 * ```typescript
 * interface UserSchema {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * class User extends Model<UserSchema> {
 *   public static table = "users";
 * }
 *
 * const user = new User({ name: "Alice" });
 * user.set("email", "alice@example.com");
 * console.log(user.hasChanges()); // true
 * ```
 */
declare abstract class Model<TSchema extends ModelSchema = ModelSchema> {
  /**
   * The database table or collection name associated with this model.
   *
   * Must be defined by each concrete model subclass.
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static table = "users";
   * }
   * ```
   */
  static table: string;
  /**
   * Resource for this model.
   * It is a class that holds a toJSON function
   * Called when the model is being converted to JSON (by calling toJSON or JSON.stringify(model))
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static resource = UserResource;
   * }
   * ```
   */
  static resource?: any;
  /**
   * Resource columns
   * Define what columns should be sent to the resource (if any) when converting to JSON
   */
  static resourceColumns?: string[];
  /**
   * JSON keys for this model.
   * This could be used if resource is not passed
   * It will select only these keys from the model
   * @example
   * ```typescript
   * class User extends Model {
   *   public static toJsonColumns = ["id", "name"];
   * }
   * ```
   */
  static toJsonColumns?: string[];
  /**
   * Data source reference for this model.
   *
   * Can be:
   * - A string name registered in the data-source registry
   * - A DataSource instance
   * - Undefined (falls back to the default data source)
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static dataSource = "primary";
   * }
   * ```
   */
  static dataSource?: string | DataSource;
  /**
   * Query builder class
   */
  static builder?: new (...args: any[]) => QueryBuilderContract<Model>;
  /**
   * Primary key field name used to identify records.
   *
   * @default "id"
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static primaryKey = "_id"; // MongoDB
   * }
   *
   * class Product extends Model {
   *   public static primaryKey = "id"; // SQL
   * }
   * ```
   */
  static primaryKey: string;
  /**
   * Embeded fields when document is Being embeded
   */
  static embed?: string[];
  /**
   * Validation and casting schema using @warlock.js/seal.
   *
   * Defines validation rules and data transformations for the model.
   * Used automatically during save operations.
   *
   * @example
   * ```typescript
   * import { v } from "@warlock.js/seal";
   *
   * class User extends Model {
   *   public static schema = v.object({
   *     name: v.string().required().trim(),
   *     age: v.number().min(0).max(120),
   *     email: v.string().email().required().toLowerCase(),
   *     createdAt: v.date().default(() => new Date()),
   *   });
   * }
   * ```
   */
  static schema?: ObjectValidator;
  /**
   * Strict mode behavior for unknown fields.
   *
   * - `"strip"`: Remove unknown fields silently (default, recommended for APIs)
   * - `"fail"`: Throw validation error on unknown fields (strict validation)
   * - `"allow"`: Allow unknown fields to pass through (permissive)
   *
   * @default "strip"
   *
   * @example
   * ```typescript
   * import { Model, type StrictMode } from "@warlock.js/cascade";
   *
   * class User extends Model {
   *   public static strictMode: StrictMode = "fail"; // Throw on unknown fields
   * }
   *
   * const user = new User({ name: "Alice", unknownField: "value" });
   * await user.save(); // DatabaseWriterValidationError: unknown field
   * ```
   */
  static strictMode: StrictMode;
  /**
   * Auto-generate incremental `id` field on insert (NoSQL only).
   *
   * When enabled, the ID generator creates a sequential integer ID
   * separate from the database's native ID (_id for MongoDB).
   *
   * **Note:** SQL databases use native AUTO_INCREMENT and don't need this.
   *
   * @default true
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static autoGenerateId = true;
   * }
   *
   * const user = new User({ name: "Alice" });
   * await user.save();
   * console.log(user.get("_id")); // ObjectId("...") - MongoDB
   * console.log(user.get("id")); // 1 - Generated
   * ```
   */
  static autoGenerateId: boolean;
  /**
   * Initial ID value for the first record.
   *
   * If not set, defaults to 1 or uses `randomInitialId`.
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static initialId = 1000; // Start from 1000
   * }
   * ```
   */
  static initialId?: number;
  /**
   * Randomly generate the initial ID.
   *
   * Can be:
   * - `true`: Generate random ID between 10000-499999
   * - Function: Custom random ID generator
   * - `false`: Use `initialId` or default to 1
   *
   * @default false
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static randomInitialId = true; // Random 10000-499999
   * }
   *
   * class Product extends Model {
   *   public static randomInitialId = () => Math.floor(Math.random() * 1000000);
   * }
   * ```
   */
  static randomInitialId?: boolean | (() => number);
  /**
   * Amount to increment ID by for each new record.
   *
   * If not set, defaults to 1 or uses `randomIncrement`.
   *
   * @default 1
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static incrementIdBy = 5; // Increment by 5
   * }
   * ```
   */
  static incrementIdBy?: number;
  /**
   * Randomly generate the increment amount.
   *
   * Can be:
   * - `true`: Generate random increment between 1-10
   * - Function: Custom random increment generator
   * - `false`: Use `incrementIdBy` or default to 1
   *
   * @default false
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static randomIncrement = true; // Random 1-10
   * }
   *
   * class Product extends Model {
   *   public static randomIncrement = () => Math.floor(Math.random() * 100);
   * }
   * ```
   */
  static randomIncrement?: boolean | (() => number);
  /**
   * Created at column name.
   */
  static createdAtColumn?: string | false;
  /**
   * Updated at column name.
   */
  static updatedAtColumn?: string | false;
  /**
   * Delete strategy for this model.
   *
   * Controls how models are deleted:
   * - `"trash"` - Moves to trash collection, then deletes
   * - `"permanent"` - Direct deletion (hard delete)
   * - `"soft"` - Sets deletedAt timestamp (soft delete)
   *
   * Can be overridden by destroy() options.
   * Falls back to data source default if not set.
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static deleteStrategy: DeleteStrategy = "soft";
   * }
   * ```
   */
  static deleteStrategy?: DeleteStrategy;
  /**
   * Column name for soft delete timestamp.
   *
   * Used when delete strategy is "soft".
   *
   * @default "deletedAt"
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static deletedAtColumn = "archivedAt";
   * }
   * ```
   */
  static deletedAtColumn: string | false;
  /**
   * Trash table/collection name override.
   *
   * If not set, defaults to `{table}Trash` or data source default.
   * Used when delete strategy is "trash".
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static trashTable = "userRecycleBin";
   * }
   * ```
   */
  static trashTable?: string;
  /**
   * Global scopes that are automatically applied to all queries.
   * These scopes are inherited by child models.
   */
  static globalScopes: Map<string, GlobalScopeDefinition>;
  /**
   * Local scopes that can be manually applied to queries.
   * These are reusable query snippets that developers opt into.
   */
  static localScopes: Map<string, LocalScopeCallback>;
  /**
   * Relation definitions for this model.
   *
   * Define relationships to other models using helper functions:
   * - `hasMany()` - One-to-many (User has many Posts)
   * - `hasOne()` - One-to-one (User has one Profile)
   * - `belongsTo()` - Inverse of hasMany/hasOne (Post belongs to User)
   * - `belongsToMany()` - Many-to-many with pivot table (User has many Roles)
   *
   * @example
   * ```typescript
   * import { hasMany, belongsTo, belongsToMany, hasOne } from "@warlock.js/cascade";
   *
   * class User extends Model {
   *   public posts?: Post[];  // Optional: for TypeScript autocomplete
   *
   *   static relations = {
   *     posts: hasMany("Post"),
   *     profile: hasOne("Profile"),
   *     organization: belongsTo("Organization"),
   *     roles: belongsToMany("Role", { pivot: "user_roles" }),
   *   };
   * }
   *
   * // Usage:
   * const users = await User.query().with("posts").get();
   * console.log(users[0].posts); // Post[]
   * ```
   */
  static relations: Readonly<Record<string, RelationDefinition>>;
  /**
   * Flag indicating whether this model instance represents a new (unsaved) record.
   *
   * - `true`: The model has not been persisted to the database yet
   * - `false`: The model represents an existing database record
   *
   * This flag is used by the writer to determine whether to perform an insert or update.
   */
  isNew: boolean;
  /**
   * The raw mutable data backing this model instance.
   *
   * All field accessors (get, set, merge, etc.) operate on this object.
   */
  data: TSchema;
  /**
   * Dirty tracker that monitors changes to the model's data.
   *
   * Tracks:
   * - Which fields have been modified (dirty columns)
   * - Which fields have been removed
   * - Original vs. current values for each dirty field
   *
   * Used by the writer to generate efficient partial update payloads.
   */
  readonly dirtyTracker: DatabaseDirtyTracker;
  /**
   * Model instance events.
   * Allows registering listeners for lifecycle events on this specific instance.
   */
  events: ModelEvents<any>;
  /**
   * Map of loaded relations for this model instance.
   *
   * Populated automatically when using `with()` for eager loading,
   * or when calling `load()` for lazy loading.
   *
   * @example
   * ```typescript
   * const user = await User.query().with("posts").first();
   * console.log(user.loadedRelations.get("posts")); // Post[]
   *
   * // Also accessible as direct properties:
   * console.log(user.posts); // Post[]\n   * ```
   */
  loadedRelations: Map<string, any>;
  /**
   * Column name for active status.
   */
  protected isActiveColumn: string;
  /**
   * Constructs a new model instance with optional initial data.
   *
   * Initializes the dirty tracker with a snapshot of the provided data.
   *
   * @param initialData - Partial data to populate the model
   *
   * @example
   * ```typescript
   * const user = new User({ name: "Alice", email: "alice@example.com" });
   * ```
   */
  constructor(initialData?: Partial<TSchema>);
  /**
   * Lazily load one or more relations for this model instance.
   *
   * This method loads relations on-demand after the model has been fetched.
   * The loaded relations are attached directly to the model instance and
   * also stored in `loadedRelations` map.
   *
   * @param relations - Relation name(s) to load
   * @returns This model instance for chaining
   *
   * @example
   * ```typescript
   * const user = await User.first();
   *
   * // Load single relation
   * await user.load("posts");
   * console.log(user.posts); // Post[]
   *
   * // Load multiple relations
   * await user.load("posts", "organization");
   *
   * // Chain with other operations
   * const posts = await user.load("posts").then(() => user.posts);
   * ```
   */
  load(...relations: string[]): Promise<this>;
  /**
   * Check if a relation has been loaded.
   *
   * @param relationName - Name of the relation to check
   * @returns True if the relation has been loaded
   *
   * @example
   * ```typescript
   * const user = await User.first();
   *
   * console.log(user.isLoaded("posts")); // false
   * await user.load("posts");
   * console.log(user.isLoaded("posts")); // true
   * ```
   */
  isLoaded(relationName: string): boolean;
  /**
   * Set relation manually
   *
   * @param relationName
   * @param relationData
   */
  setRelation(relationName: string, relationData: LoadedRelationResult): void;
  /**
   * Get a loaded relation by name.
   *
   * Returns undefined if the relation has not been loaded.
   *
   * @param relationName - Name of the relation to get
   * @returns The loaded relation data, or undefined
   *
   * @example
   * ```typescript
   * const user = await User.query().with("posts").first();
   *
   * const posts = user.getRelation<Post[]>("posts");
   * console.log(posts?.length);
   * ```
   */
  getRelation<TRelation = any>(relationName: string): TRelation | undefined;
  /**
   * Get a model class by its name from the global registry.
   *
   * Models must be decorated with @RegisterModel() to be available in the registry.
   *
   * @param name - The model class name
   * @returns The model class or undefined if not found
   *
   * @example
   * ```typescript
   * const UserModel = Model.getModel("User");
   * if (UserModel) {
   *   const user = await UserModel.find(1);
   * }
   * ```
   */
  static getModel(name: string): ChildModel<Model<ModelSchema>> | undefined;
  /**
   * Get all registered models from the global registry.
   *
   * Only models decorated with @RegisterModel() will appear here.
   *
   * @returns A Map of all registered model classes by name
   *
   * @example
   * ```typescript
   * const allModels = Model.getAllModels();
   * for (const [name, ModelClass] of allModels) {
   *   console.log(`Found model: ${name} with table: ${ModelClass.table}`);
   * }
   * ```
   */
  static getAllModels(): Map<string, ChildModel<Model<ModelSchema>>>;
  /**
   * Create a sync operation for a single embedded document.
   *
   * When this model is updated, the target model's field
   * will be updated with the embedded data.
   *
   * @param TargetModel - Target model class that receives data
   * @param targetField - Field path in target model
   * @returns Sync operation for chaining configuration
   *
   * @example
   * ```typescript
   * // When Category updates, update Product.category
   * Category.sync(Product, "category");
   * ```
   */
  static sync<TModel extends Model = Model>(this: ChildModel<TModel>, TargetModel: ChildModel<Model>, targetField: string): ModelSyncOperationContract;
  /**
   * Create a sync operation for an array of embedded documents.
   *
   * When this model is updated, the corresponding element
   * in the target model's array field will be updated.
   *
   * @param TargetModel - Target model class that receives data
   * @param targetField - Array field path in target model
   * @returns Sync operation for chaining configuration
   *
   * @example
   * ```typescript
   * // When Tag updates, update Post.tags[i] where tags[i].id matches
   * Tag.syncMany(Post, "tags").identifyBy("id");
   * ```
   */
  static syncMany<TModel extends Model = Model>(this: ChildModel<TModel>, TargetModel: ChildModel<Model>, targetField: string): ModelSyncOperationContract;
  /**
   * Get model id
   */
  get id(): number | string;
  /**
   * String-typed accessor for the model's primary id.
   *
   * The underlying `id` field is `string | number` (MongoDB's ObjectId-as-string
   * vs SQL's auto-increment integer), which forces consumers to write
   * `string | number` everywhere they pass an id around. This getter narrows
   * the contract to `string` so callers can write functions that accept a
   * single id type without leaking the engine difference.
   *
   * The name `uuid` is historical — it does NOT validate or coerce the value
   * to a UUID. It simply returns the id, typed as a string.
   *
   * @example
   * ```typescript
   * function shareLink(modelId: string) { ... }
   * shareLink(user.uuid); // works regardless of whether the underlying id is
   *                      // a Mongo ObjectId string or a SQL integer
   * ```
   */
  get uuid(): string;
  /**
   * Retrieves a field value from the model's data.
   *
   * Supports both top-level keys and dot-notation paths for nested access.
   *
   * @param field - The field name or dot-notation path (e.g., "address.city")
   * @param defaultValue - Value to return if the field is missing
   * @returns The field value or the default value if not found
   *
   * @example
   * ```typescript
   * user.get("name"); // "Alice"
   * user.get("address.city", "Unknown"); // "Unknown" if address.city is missing
   * ```
   */
  get<TKey extends keyof TSchema & string>(field: TKey): TSchema[TKey];
  get<TKey extends keyof TSchema & string>(field: TKey, defaultValue: TSchema[TKey]): TSchema[TKey];
  get<Type extends unknown = any>(field: string): Type;
  get<Type extends unknown = any>(field: string, defaultValue: Type): Type;
  /**
   * Get only the values of the given fields
   */
  only<TKey extends keyof TSchema & string>(fields: TKey[]): Record<TKey, TSchema[TKey]>;
  only(fields: string[]): Record<string, unknown>;
  /**
   * Get a string value
   */
  string(key: string, defaultValue?: string): string | undefined;
  /**
   * Get a number value
   */
  number(key: string, defaultValue?: number): number | undefined;
  /**
   * Get a boolean value
   */
  boolean(key: string, defaultValue?: boolean): boolean | undefined;
  /**
   * Sets a field value in the model's data and marks it as dirty.
   *
   * Supports both top-level keys and dot-notation paths for nested assignment.
   * Automatically updates the dirty tracker to reflect the change.
   *
   * @param field - The field name or dot-notation path (e.g., "address.city")
   * @param value - The value to assign
   * @returns The model instance for method chaining
   *
   * @example
   * ```typescript
   * user.set("name", "Bob").set("address.city", "NYC");
   * ```
   */
  set<TKey extends keyof TSchema & string>(field: TKey, value: TSchema[TKey]): this;
  set(field: string, value: unknown): this;
  /**
   * Checks whether a field exists in the model's data.
   *
   * Supports both top-level keys and dot-notation paths.
   *
   * @param field - The field name or dot-notation path
   * @returns `true` if the field exists, `false` otherwise
   *
   * @example
   * ```typescript
   * user.has("name"); // true
   * user.has("address.zipCode"); // false
   * ```
   */
  has<TKey extends keyof TSchema & string>(field: TKey): boolean;
  has(field: string): boolean;
  /**
   * Increment the given field by the given amount
   */
  increment<TKey extends keyof TSchema & string>(field: TKey, amount: number): this;
  increment(field: string, amount?: number): this;
  /**
   * Decrement the given field by the given amount
   */
  decrement<TKey extends keyof TSchema & string>(field: TKey, amount: number): this;
  decrement(field: string, amount?: number): this;
  /**
   * Removes one or more fields from the model's data and marks them as removed.
   *
   * Supports both top-level keys and dot-notation paths.
   * Automatically updates the dirty tracker to reflect the removal.
   *
   * @param fields - One or more field names or dot-notation paths to remove
   * @returns The model instance for method chaining
   *
   * @example
   * ```typescript
   * user.unset("tempField", "address.oldZip");
   * ```
   */
  unset(...fields: (keyof TSchema & string)[]): this;
  unset(...fields: string[]): this;
  /**
   * Merges new values into the model's data and marks changed fields as dirty.
   *
   * Performs a deep merge, preserving existing nested structures.
   * Automatically updates the dirty tracker to reflect all changes.
   *
   * @param values - Partial data to merge into the model
   * @returns The model instance for method chaining
   *
   * @example
   * ```typescript
   * user.merge({ name: "Charlie", address: { city: "LA" } });
   * ```
   */
  merge(values: Partial<TSchema>): this;
  merge(values: Record<string, unknown>): this;
  /**
   * Perform atomoic update from current model instance
   * Please note that it would require the id to be existing in the current
   * model instance
   * @returns number of affected records
   */
  atomicUpdate(operations: Record<string, unknown>): Promise<number>;
  /**
   * Perform atomic increment
   * This would issue a query update and update the given field without
   * saving the model
   */
  atomicIncrement<T extends keyof TSchema & string>(field: T, amount?: number): Promise<number>;
  /**
   * Perform atomic decrement
   * This would issue a query update and update the given field without
   * saving the model
   */
  atomicDecrement<T extends keyof TSchema & string>(field: T, amount?: number): Promise<number>;
  /**
   * Determine if current model is active
   */
  get isActive(): boolean;
  /**
   * Get created at date
   */
  get createdAt(): Date | undefined;
  /**
   * Get updated at date
   */
  get updatedAt(): Date | undefined;
  /**
   * Check if current model record is created by the given user model
   */
  isCreatedBy(user: Model | GenericObject): boolean;
  /**
   * Checks whether the model's data has changed since instantiation or last reset.
   *
   * @returns `true` if any fields have been modified or removed, `false` otherwise
   *
   * @example
   * ```typescript
   * const user = new User({ name: "Alice" });
   * user.hasChanges(); // false
   * user.set("name", "Bob");
   * user.hasChanges(); // true
   * ```
   */
  hasChanges(): boolean;
  /**
   * Check if the given column has been modified.
   *
   * @param column - The column name to check
   * @returns `true` if the column has been modified, `false` otherwise
   *
   * @example
   * ```typescript
   * user.set("name", "Bob");
   * user.isDirty("name"); // true
   * ```
   */
  isDirty(column: string): boolean;
  /**
   * Retrieves all dirty columns with their old and new values.
   *
   * @returns A record mapping each dirty column to its previous and current value
   *
   * @example
   * ```typescript
   * user.set("name", "Bob");
   * user.getDirtyColumnsWithValues();
   * // { name: { oldValue: "Alice", newValue: "Bob" } }
   * ```
   */
  getDirtyColumnsWithValues(): Record<string, {
    oldValue: unknown;
    newValue: unknown;
  }>;
  /**
   * Lists all columns that have been removed from the model's data.
   *
   * @returns An array of field names that were present initially but have been unset
   *
   * @example
   * ```typescript
   * user.unset("tempField");
   * user.getRemovedColumns(); // ["tempField"]
   * ```
   */
  getRemovedColumns(): string[];
  /**
   * Lists all columns that have been modified since instantiation or last reset.
   *
   * @returns An array of field names that have changed
   *
   * @example
   * ```typescript
   * user.set("name", "Bob");
   * user.getDirtyColumns(); // ["name"]
   * ```
   */
  getDirtyColumns(): string[];
  /**
   * Emits a lifecycle event to both per-model and global listeners.
   *
   * This method is public so that external services (like the writer) can trigger
   * lifecycle events when appropriate.
   *
   * @param event - The event name (e.g., "saving", "created", "deleting")
   * @param context - Optional context data to pass to listeners
   *
   * @example
   * ```typescript
   * await user.emitEvent("saving");
   * await user.emitEvent("validated", { errors: [] });
   * ```
   */
  emitEvent<TContext = unknown>(event: ModelEventName, context?: TContext): Promise<void>;
  /**
   * Register a listener for a model lifecycle event on this instance.
   *
   * @param event - Event name (e.g., "saving", "updated")
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  on<TContext = unknown>(event: ModelEventName, listener: ModelEventListener<this, TContext>): () => void;
  /**
   * Register a one-time listener for a model lifecycle event on this instance.
   *
   * @param event - Event name
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  once<TContext = unknown>(event: ModelEventName, listener: ModelEventListener<this, TContext>): () => void;
  /**
   * Remove a listener from this instance.
   *
   * @param event - Event name
   * @param listener - Callback function to remove
   */
  off<TContext = unknown>(event: ModelEventName, listener: ModelEventListener<this, TContext>): void;
  /**
   * Resolves the data source associated with this model.
   *
   * Resolution order:
   * 1. If `dataSource` is a string, looks it up in the data-source registry
   * 2. If `dataSource` is a DataSource instance, returns it directly
   * 3. Otherwise, returns the default data source from the registry
   *
   * @returns The resolved DataSource instance
   * @throws Error if no data source is found
   *
   * @example
   * ```typescript
   * class User extends Model {
   *   public static dataSource = "primary";
   * }
   *
   * const ds = User.getDataSource();
   * ```
   */
  static getDataSource(): DataSource;
  /**
   * Get driver instance
   */
  static getDriver(): DriverContract;
  /**
   * Generate next id and set it to current model's id
   */
  generateNextId(): Promise<number | string>;
  /**
   * Apply model defaults from data source configuration.
   *
   * This is called automatically by getDataSource() the first time
   * a model accesses its data source. Defaults are only applied if
   * the model doesn't already have its own value set.
   *
   * The hierarchy is:
   * 1. Model static property (highest priority - skipped here)
   * 2. Database config modelDefaults (passed here)
   * 3. Driver modelDefaults (merged before passing here)
   * 4. Framework defaults (fallback values in the code)
   *
   * @param defaults - Model default configuration from data source
   */
  static applyModelDefaults(defaults: any): void;
  /**
   * Add a global scope that is automatically applied to all queries.
   *
   * Global scopes are inherited by child models and applied before query execution.
   * Use for security filters, multi-tenancy, soft deletes, etc.
   *
   * @param name - Unique name for the scope
   * @param callback - Function that modifies the query
   * @param options - Scope options (timing: 'before' | 'after')
   *
   * @example
   * ```typescript
   * // Multi-tenancy scope
   * Model.addGlobalScope('tenant', (query) => {
   *   query.where('tenantId', getCurrentTenant());
   * }, { timing: 'before' });
   *
   * // Soft delete scope
   * User.addGlobalScope('notDeleted', (query) => {
   *   query.whereNull('deletedAt');
   * });
   * ```
   */
  static addGlobalScope(name: string, callback: (query: QueryBuilderContract) => void, options?: GlobalScopeOptions): void;
  /**
   * Remove a global scope by name.
   *
   * @param name - Name of the scope to remove
   *
   * @example
   * ```typescript
   * Model.removeGlobalScope('tenant');
   * ```
   */
  static removeGlobalScope(name: string): void;
  /**
   * Add a local scope that can be manually applied to queries.
   *
   * Local scopes are reusable query snippets that developers opt into.
   * They are not automatically applied.
   *
   * @param name - Unique name for the scope
   * @param callback - Function that modifies the query
   *
   * @example
   * ```typescript
   * // Define reusable scopes
   * User.addScope('active', (query) => {
   *   query.where('isActive', true);
   * });
   *
   * User.addScope('admins', (query) => {
   *   query.where('role', 'admin');
   * });
   *
   * // Use explicitly
   * await User.query().scope('active').get();
   * await User.query().scope('admins').get();
   * ```
   */
  static addScope(name: string, callback: LocalScopeCallback): void;
  /**
   * Remove a local scope by name.
   *
   * @param name - Name of the scope to remove
   *
   * @example
   * ```typescript
   * User.removeScope('active');
   * ```
   */
  static removeScope(name: string): void;
  /**
   * Create a new query builder for this model
   */
  static query<TModel extends Model = Model>(this: ChildModel<TModel>): QueryBuilderContract<TModel>;
  /**
   * Eagerly load one or more relations with the query results.
   *
   * Relations are loaded in separate optimized queries to prevent N+1 problems.
   * The loaded relations are attached to each model instance.
   *
   * @param relation - Single relation name to load
   * @returns Query builder for chaining
   *
   * @example
   * ```typescript
   * // Load single relation
   * const user = await User.query().with("posts").find(1);
   * console.log(user.posts); // Post[]
   *
   * // Load multiple relations
   * const user = await User.query().with("posts", "organization").find(1);
   *
   * // Load nested relations
   * const user = await User.query().with("posts.comments.author").find(1);
   * ```
   */
  static with<TModel extends Model = Model>(this: ChildModel<TModel>, relation: string): QueryBuilderContract<TModel>;
  /**
   * Eagerly load multiple relations.
   *
   * @param relations - Relation names to load
   * @returns Query builder for chaining
   */
  static with<TModel extends Model = Model>(this: ChildModel<TModel>, ...relations: string[]): QueryBuilderContract<TModel>;
  /**
   * Eagerly load a relation with a constraint callback.
   *
   * The callback receives the relation query builder, allowing you to
   * add conditions, ordering, or limits to the related query.
   *
   * @param relation - Relation name to load
   * @param constraint - Callback to configure the relation query
   * @returns Query builder for chaining
   *
   * @example
   * ```typescript
   * const user = await User.query()
   *   .with("posts", (query) => {
   *     query.where("isPublished", true)
   *       .orderBy("createdAt", "desc")
   *       .limit(5);
   *   })
   *   .find(1);
   * ```
   */
  static with<TModel extends Model = Model>(this: ChildModel<TModel>, relation: string, constraint: (query: QueryBuilderContract) => void): QueryBuilderContract<TModel>;
  /**
   * Eagerly load multiple relations with constraints.
   *
   * Pass an object where keys are relation names and values are either:
   * - `true` to load without constraints
   * - A callback function to configure the relation query
   *
   * @param relations - Object mapping relation names to constraints
   * @returns Query builder for chaining
   *
   * @example
   * ```typescript
   * const user = await User.query()
   *   .with({
   *     posts: (query) => query.where("isPublished", true),
   *     organization: true,
   *     roles: (query) => query.orderBy("priority"),
   *   })
   *   .find(1);
   * ```
   */
  static with<TModel extends Model = Model>(this: ChildModel<TModel>, relations: Record<string, boolean | ((query: QueryBuilderContract) => void)>): QueryBuilderContract<TModel>;
  /**
   * Add a count of related records as a virtual field on each result row.
   *
   * Each relation produces a `${relationName}Count` column by default. Use
   * the `"name as alias"` shorthand or the object form to customise the
   * output alias or apply per-relation where-clause constraints.
   *
   * @param relation - Relation name (optionally with `as <alias>`)
   * @returns Query builder for chaining
   *
   * @example
   * ```typescript
   * const users = await User.withCount("posts").get();
   * console.log(users[0].postsCount); // number
   * ```
   */
  static withCount<TModel extends Model = Model>(this: ChildModel<TModel>, relation: string): QueryBuilderContract<TModel>;
  /**
   * Add counts for multiple relations at once.
   *
   * @example
   * ```typescript
   * await User.withCount("posts", "comments", "followers").get();
   * ```
   */
  static withCount<TModel extends Model = Model>(this: ChildModel<TModel>, ...relations: string[]): QueryBuilderContract<TModel>;
  /**
   * Add counts for multiple relations supplied as an array.
   */
  static withCount<TModel extends Model = Model>(this: ChildModel<TModel>, relations: string[]): QueryBuilderContract<TModel>;
  /**
   * Add counts with optional per-relation constraints and alias overrides.
   *
   * Values may be `true`, an alias string, or a callback that applies
   * where-clauses inside the count subquery. Use the `as <alias>` shorthand
   * in the key to count the same relation more than once.
   *
   * @example
   * ```typescript
   * await Post.withCount({
   *   comments: true,
   *   "comments as approvedCount": (q) => q.where("approved", true),
   *   tags: "tagCount",
   * }).get();
   * ```
   */
  static withCount<TModel extends Model = Model>(this: ChildModel<TModel>, relations: Record<string, true | string | ((query: QueryBuilderContract) => void)>): QueryBuilderContract<TModel>;
  /**
   * Load relations using database JOINs in a single query.
   *
   * Unlike `with()` which uses separate queries, `joinWith()` uses
   * LEFT JOIN (SQL) or $lookup (MongoDB) to fetch related data
   * in a single query. The related data is hydrated into proper
   * model instances and attached to the main model.
   *
   * Best for: belongsTo and hasOne relations where you need
   * efficient single-query loading.
   *
   * @param relations - Relation names to load via JOIN
   * @returns Query builder for chaining
   *
   * @example
   * ```typescript
   * // Single relation
   * const post = await Post.joinWith("author").first();
   * console.log(post.author); // User model instance
   * console.log(post.data);   // { id, title, authorId } - no author data
   *
   * // Multiple relations
   * const post = await Post.joinWith("author", "category").first();
   * ```
   */
  static joinWith<TModel extends Model = Model>(this: ChildModel<TModel>, ...relations: string[]): QueryBuilderContract<TModel>;
  /**
   * Create new query builder.
   *
   * If the model has a static `builder` property set to a query builder class,
   * it will be instantiated instead of the default driver query builder.
   *
   * @example
   * ```typescript
   * class UserQueryBuilder<T = User> extends MongoQueryBuilder<T> {
   *   active() { return this.where("isActive", true); }
   * }
   *
   * class User extends Model {
   *   static builder = UserQueryBuilder;  // That's it! ✨
   * }
   *
   * // Now User.query() returns UserQueryBuilder<User> with autocomplete!
   * ```
   */
  static newQueryBuilder<TModel extends Model = Model>(this: ChildModel<TModel>): QueryBuilderContract<TModel>;
  /**
   * Get First matched record for the given filter
   */
  static first<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel | null>;
  /**
   * Get last matched record for the given filter
   */
  static last<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel | null>;
  /**
   * Use where clause directly
   */
  static where<TModel extends Model = Model>(this: ChildModel<TModel>, field: string, value: unknown): QueryBuilderContract<TModel>;
  static where<TModel extends Model = Model>(this: ChildModel<TModel>, field: string, operator: WhereOperator, value: unknown): QueryBuilderContract<TModel>;
  static where<TModel extends Model = Model>(this: (new (...args: any[]) => TModel) & Pick<typeof Model, "query" | "getDataSource" | "table">, conditions: WhereObject): QueryBuilderContract<TModel>;
  static where<TModel extends Model = Model>(this: (new (...args: any[]) => TModel) & Pick<typeof Model, "query" | "getDataSource" | "table">, callback: WhereCallback<TModel>): QueryBuilderContract<TModel>;
  /**
   * Count the number of records in the table
   * @param filter - The filter to apply to the query
   */
  static count<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<number>;
  /**
   * Find record by id
   */
  static find<TModel extends Model = Model>(this: ChildModel<TModel>, id: string | number): Promise<TModel | null>;
  /**
   * Get all records from the table
   *
   * @param filter - The filter to apply to the query
   * @returns All records from the table
   */
  static all<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel[]>;
  /**
   * Perform pagination
   */
  static paginate<TModel extends Model = Model>(this: ChildModel<TModel>, options?: PaginationOptions & {
    filter?: Record<string, unknown>;
  }): Promise<PaginationResult<TModel>>;
  /**
   * Get latest records from the table
   *
   * @param filter - The filter to apply to the query
   */
  static latest<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel[]>;
  /**
   * Increment the given field by the given amount using atomic update
   *
   * @example ```typescript
   * // Increase age by 1 for user id 1
   * User.increment({id: 1}, "age", 1);
   * // Increase age by 1 and views by 2 for user id 1
   * User.increment({id: 1}, {age: 1, views: 2});
   * ```
   */
  static increase<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, field: string, amount: number): Promise<number>;
  /**
   * Decrement the given field by the given amount using atomic update
   * @example ```typescript
   * // Decrease age by 1 for user id 1
   * User.decrement({id: 1}, "age", 1);
   * // Decrease age by 1 and views by 2 for user id 1
   * User.decrement({id: 1}, {age: 1, views: 2});
   * ```
   */
  static decrease<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, field: string, amount: number): Promise<number>;
  /**
   * Perform atomic operation
   * Example
   *
   * ```typescript
   * const user = await User.atomic({id: 1}, {$inc: {age: 1}})
   * Returns user model with updated age
   */
  static atomic<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, operations: UpdateOperations): Promise<number>;
  /**
   * Perform an atomic update for the given id
   */
  static update<TModel extends Model = Model>(this: ChildModel<TModel>, id: string | number, data: Record<string, unknown>): Promise<number>;
  /**
   * Find one and update multiple records that matches the provided filter and return the updated record
   * @param filter - Filter conditions
   * @param update - Update operations ($set, $unset, $inc)
   * @returns The updated records
   */
  static findAndUpdate<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, update: UpdateOperations): Promise<TModel[]>;
  /**
   * Find one and update a single record that matches the provided filter and return the updated record
   * @param filter - Filter conditions
   * @param update - Update operations ($set, $unset, $inc)
   * @returns The updated record or null
   */
  static findOneAndUpdate<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, update: UpdateOperations): Promise<TModel | null>;
  /**
   * Find and replace the entire document that matches the provided filter and return the replaced document
   */
  static findAndReplace<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, document: Record<string, unknown>): Promise<TModel | null>;
  /**
   * Destroy (delete) the current model instance from the database.
   *
   * Emits lifecycle events:
   * - `deleting` - Before deletion
   * - `deleted` - After successful deletion
   *
   * @param options - Destroy options (strategy override, skipEvents)
   * @throws {Error} If the model is new (not saved) or if deletion fails
   *
   * @example
   * ```typescript
   * const user = await User.find(1);
   * await user.destroy(); // Uses default strategy
   * await user.destroy({ strategy: "permanent" }); // Override strategy
   * await user.destroy({ skipEvents: true }); // Silent delete
   * ```
   */
  destroy(options?: {
    strategy?: DeleteStrategy;
    skipEvents?: boolean;
  }): Promise<RemoverResult>;
  /**
   * Attach one or more related records to a `belongsToMany` pivot table.
   *
   * Thin wrapper over `createPivotOperations(this, relation).attach(ids, pivotData)`.
   * Throws if the named relation is not a `belongsToMany` relation.
   *
   * @example
   * ```typescript
   * await post.attach("tags", [1, 2, 3]);
   * await post.attach("tags", [4], { addedBy: currentUserId });
   * ```
   */
  attach(relation: string, ids: PivotIds, pivotData?: PivotData): Promise<void>;
  /**
   * Detach related records from a `belongsToMany` pivot table. Omit `ids`
   * to detach every row for this side of the relation.
   *
   * Thin wrapper over `createPivotOperations(this, relation).detach(ids)`.
   * Throws if the named relation is not a `belongsToMany` relation.
   *
   * @example
   * ```typescript
   * await post.detach("tags", [2]);
   * await post.detach("tags"); // detach all
   * ```
   */
  detach(relation: string, ids?: PivotIds): Promise<void>;
  /**
   * Get the pivot-operations handle for a `belongsToMany` relation.
   *
   * Returns a `PivotOperations` object exposing `attach` / `detach` /
   * `sync` / `toggle` for the named relation's pivot table. Routing every
   * pivot mutation through `model.pivot(relation)` keeps the join-table
   * `sync` distinct from `Model.sync(Target, field)` (the denormalization
   * feature). Throws if the named relation is not a `belongsToMany` relation.
   *
   * @example
   * ```typescript
   * await post.pivot("tags").attach([1, 2, 3]);
   * await post.pivot("tags").sync([1, 3, 5]);   // replace the whole set
   * await post.pivot("tags").toggle([1, 7]);    // flip each
   * ```
   */
  pivot(relation: string): PivotOperations;
  /**
   * Get the class constructor from an instance.
   *
   * This helper method allows instance methods to access static properties
   * and methods of the model class in a type-safe way.
   *
   * @returns The model class constructor
   *
   * @example
   * ```typescript
   * const constructor = this.self();
   * const table = constructor.table;
   * await constructor.deleteOne({ id: 1 });
   * ```
   */
  self<TModel extends Model = this>(): ChildModel<TModel>;
  /**
   * Creates an immutable clone of the model with its current state.
   *
   * The cloned model:
   * - Contains a deep copy of all current data
   * - Has frozen (immutable) data that cannot be modified
   * - Preserves the `isNew` flag from the original
   * - Has no dirty changes (clean state)
   * - Cannot be saved or modified
   *
   * This is useful for:
   * - Creating snapshots of model state
   * - Passing read-only model data to other parts of the application
   * - Preventing accidental mutations
   * - Maintaining historical records
   *
   * @returns A new immutable model instance with the current state
   *
   * @example
   * ```typescript
   * const user = new User({ name: "Alice", email: "alice@example.com" });
   * await user.save();
   *
   * // Create an immutable snapshot
   * const snapshot = user.clone();
   *
   * // This will throw an error because the clone is immutable
   * snapshot.set("name", "Bob"); // TypeError: Cannot assign to read only property
   *
   * // Original can still be modified
   * user.set("name", "Bob");
   * await user.save();
   * ```
   */
  clone(): this;
  /**
   * Recursively freezes an object and all its nested properties.
   *
   * @param obj - The object to freeze
   * @returns The frozen object
   */
  deepFreeze<T>(obj: T): T;
  /**
   * Get table name
   */
  getTableName(): string;
  /**
   * Get primary key name
   */
  getPrimaryKey(): string;
  /**
   * Get model schema
   */
  getSchema(): any;
  /**
   * Check if schema has the given key
   */
  schemaHas(key: string): boolean;
  /**
   * Get strict mode
   */
  getStrictMode(): StrictMode;
  /**
   * Get data source (Connection)
   */
  getConnection(): DataSource;
  /**
   * Delete all matching documents from the table.
   */
  static delete<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<number>;
  /**
   * Delete a single matching document from the table.
   */
  static deleteOne<TModel extends Model = Model>(this: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<number>;
  /**
   * Restore a single deleted record by its ID.
   *
   * Automatically detects whether the record was deleted via "trash" or "soft" strategy.
   * Handles ID conflicts based on options.
   *
   * @param id - The primary key value of the record to restore
   * @param options - Restorer options (onIdConflict, skipEvents)
   * @returns The restored model instance
   *
   * @throws {Error} If record not found in trash or soft-deleted records
   * @throws {Error} If ID conflict and onIdConflict is "fail"
   *
   * @example
   * ```typescript
   * // Restore with default options (assign new ID if conflict)
   * const user = await User.restore(123);
   *
   * // Restore and fail if ID conflict
   * const user = await User.restore(123, { onIdConflict: "fail" });
   *
   * // Silent restore (skip events)
   * const user = await User.restore(123, { skipEvents: true });
   * ```
   */
  static restore<TModel extends Model = Model>(this: ChildModel<TModel>, id: string | number, options?: {
    onIdConflict?: "fail" | "assignNew";
    skipEvents?: boolean;
  }): Promise<TModel>;
  /**
   * Restore all deleted records for the model's table.
   *
   * Restores all records from the trash table (if using trash strategy)
   * or all soft-deleted records (if using soft strategy).
   *
   * @param options - Restorer options (onIdConflict, skipEvents)
   * @returns Array of restored model instances
   *
   * @example
   * ```typescript
   * // Restore all with default options
   * const users = await User.restoreAll();
   *
   * // Restore all and fail on any ID conflict
   * const users = await User.restoreAll({ onIdConflict: "fail" });
   * ```
   */
  static restoreAll<TModel extends Model = Model>(this: ChildModel<TModel>, options?: {
    onIdConflict?: "fail" | "assignNew";
    skipEvents?: boolean;
  }): Promise<TModel[]>;
  /**
   * Create a new record in database and return the model instance.
   *
   * The data type is automatically inferred from the model's schema type.
   *
   * @param data - Partial data matching the model's schema type
   * @returns The created model instance
   *
   * @example
   * ```typescript
   * // TypeScript automatically infers UserSchema from User model
   * const user = await User.create({
   *   name: "Alice",
   *   email: "alice@example.com",
   *   age: 30
   * });
   * // Type: User (with UserSchema inferred)
   * ```
   */
  static create<TModel extends Model = Model, TSchema extends ModelSchema = (TModel extends Model<infer S> ? S : ModelSchema)>(this: ChildModel<TModel>, data: Partial<TSchema>): Promise<TModel>;
  /**
   * Create many documents and return an array of created models
   */
  static createMany<TModel extends Model = Model, TSchema extends ModelSchema = (TModel extends Model<infer S> ? S : ModelSchema)>(this: ChildModel<TModel>, data: Partial<TSchema>[]): Promise<TModel[]>;
  /**
   * Find a record or create it if not found.
   *
   * Does NOT update existing records - returns them as-is.
   * Useful when you want to ensure a record exists without modifying it.
   *
   * @param filter - Conditions to find by
   * @param data - Data to create if not found (merged with filter)
   * @returns Promise resolving to found or created model
   *
   * @example
   * ```typescript
   * // Ensure default admin exists (don't modify if exists)
   * const admin = await User.findOrCreate(
   *   { email: "admin@example.com" },
   *   { email: "admin@example.com", name: "Admin", role: "admin" }
   * );
   * // If admin exists, returns existing (password unchanged)
   * // If not found, creates new admin
   * ```
   */
  static findOrCreate<TModel extends Model = Model, TSchema extends ModelSchema = (TModel extends Model<infer S> ? S : ModelSchema)>(this: ChildModel<TModel>, filter: Partial<TSchema>, data: Partial<TSchema>): Promise<TModel>;
  /**
   * Upsert (insert or update) a record atomically.
   *
   * Uses the driver's native upsert operation for atomic insert-or-update.
   * More efficient than updateOrCreate as it's a single database operation.
   *
   * Includes full Model features:
   * - ID generation (if creating)
   * - createdAt timestamp (if creating)
   * - updatedAt timestamp (always)
   * - Validation & casting
   * - Lifecycle events
   *
   * @param filter - Conditions to find by (used for conflict detection)
   * @param data - Data to update or create (merged with filter)
   * @param options - Upsert options (conflictColumns for PostgreSQL, etc.)
   * @returns Promise resolving to upserted model
   *
   * @example
   * ```typescript
   * // PostgreSQL: upsert on unique email
   * const user = await User.upsert(
   *   { email: "user@example.com" },
   *   {
   *     email: "user@example.com",
   *     name: "John Updated",
   *     lastSyncedAt: new Date()
   *   },
   *   { conflictColumns: ["email"] }
   * );
   *
   * // MongoDB: upsert by filter
   * const user = await User.upsert(
   *   { externalId: "ext-123" },
   *   {
   *     externalId: "ext-123",
   *     name: "John Updated",
   *     email: "john.new@example.com"
   *   }
   * );
   * ```
   */
  static upsert<TModel extends Model = Model, TSchema extends ModelSchema = (TModel extends Model<infer S> ? S : ModelSchema)>(this: ChildModel<TModel>, filter: Partial<TSchema>, data: Partial<TSchema>, options?: Record<string, unknown>): Promise<TModel>;
  /**
   * Update a record or create it if not found (upsert).
   *
   * @deprecated Use `upsert()` instead for better performance and atomicity.
   * This method is kept for backward compatibility but uses upsert internally.
   *
   * @param filter - Conditions to find by
   * @param data - Data to update or create (merged with filter)
   * @returns Promise resolving to updated or created model
   */
  static updateOrCreate<TModel extends Model = Model, TSchema extends ModelSchema = (TModel extends Model<infer S> ? S : ModelSchema)>(this: ChildModel<TModel>, filter: Partial<TSchema>, data: Partial<TSchema>, options?: Record<string, unknown>): Promise<TModel>;
  /**
   * Find one and delete a record that matches the filter and return the deleted record.
   *
   * @param filter - Filter conditions
   * @param options - Optional delete options
   * @returns The deleted model instance or null if not found
   *
   * @example
   * ```typescript
   * const deleted = await User.findOneAndDelete({ id: 1 });
   * if (deleted) {
   *   console.log('Deleted user:', deleted.get('name'));
   * }
   * ```
   */
  static findOneAndDelete<TModel extends Model = Model>(this: ChildModel<TModel>, filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<TModel | null>;
  /**
   * Returns embedded data for sync operations.
   * Excludes internal MongoDB fields and ensures proper date serialization.
   *
   * @returns Embedded data object suitable for syncing
   *
   * @example
   * ```typescript
   * const user = await User.find(1);
   * const embedData = user.embedData;
   * // Returns: { id: 1, name: "Alice", email: "alice@example.com", ... }
   * // Excludes: _id
   * ```
   */
  get embedData(): Record<string, unknown>;
  /**
   * Tear down framework-level registrations attached to this Model class.
   *
   * Called by Warlock's HMR machinery when a model file (or any file in its
   * dependency graph) is reloaded. Removes the event listeners and registry
   * entries the Model installed at module-load time so the reloaded class
   * does not double-register.
   *
   * The `$` prefix marks this as framework-internal — application code should
   * not call this. It is part of the public surface only because the HMR
   * system needs to invoke it from outside the Model class.
   *
   * @internal
   */
  static $cleanup(): void;
  /**
   * Accesses the event emitter dedicated to this model constructor.
   *
   * Each model subclass gets its own isolated event emitter, allowing you to
   * register lifecycle hooks that only apply to that specific model.
   *
   * @returns The ModelEvents instance for this model constructor
   *
   * @example
   * ```typescript
   * User.events().onSaving((user) => {
   *   console.log("User is being saved:", user);
   * });
   * ```
   */
  static events<TModel extends Model = Model>(this: ChildModel<TModel>): ModelEvents<TModel>;
  /**
   * Registers an event listener for this model constructor.
   *
   * Convenience shorthand for `Model.events().on(...)`.
   *
   * @param event - The event name (e.g., "saving", "created")
   * @param listener - The callback to invoke when the event fires
   * @returns An unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = User.on("saving", (user) => {
   *   console.log("Saving user:", user);
   * });
   * ```
   */
  static on<TModel extends Model = Model, TContext = unknown>(this: ChildModel<TModel>, event: ModelEventName, listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a one-time event listener for this model constructor.
   *
   * The listener will automatically unsubscribe after its first invocation.
   * Convenience shorthand for `Model.events().once(...)`.
   *
   * @param event - The event name (e.g., "saving", "created")
   * @param listener - The callback to invoke when the event fires
   * @returns An unsubscribe function
   *
   * @example
   * ```typescript
   * User.once("created", (user) => {
   *   console.log("First user created:", user);
   * });
   * ```
   */
  static once<TModel extends Model = Model, TContext = unknown>(this: ChildModel<TModel>, event: ModelEventName, listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Removes an event listener from this model constructor.
   *
   * Convenience shorthand for `Model.events().off(...)`.
   *
   * @param event - The event name
   * @param listener - The callback to remove
   *
   * @example
   * ```typescript
   * const listener = (user) => console.log(user);
   * User.on("saving", listener);
   * User.off("saving", listener);
   * ```
   */
  static off<TModel extends Model = Model, TContext = unknown>(this: ChildModel<TModel>, event: ModelEventName, listener: ModelEventListener<TModel, TContext>): void;
  /**
   * Accesses the global event emitter shared by all model instances.
   *
   * Use this for cross-cutting concerns like auditing, logging, or injecting
   * common fields (e.g., `createdBy`, `updatedBy`) across all models.
   *
   * @returns The global ModelEvents instance
   *
   * @example
   * ```typescript
   * Model.globalEvents().onSaving((model) => {
   *   model.set("updatedAt", new Date());
   * });
   * ```
   */
  static globalEvents(): ModelEvents<Model>;
  /**
   * Replace the model's data entirely.
   *
   * Used internally by the writer after validation to update the model
   * with validated/casted data.
   *
   * **Warning:** This replaces all data and updates the dirty tracker.
   * Use with caution in application code.
   *
   * @param data - New data to replace current data
   *
   * @example
   * ```typescript
   * // Internal usage by writer
   * model.replaceData(validatedData);
   * ```
   */
  replaceData(data: Record<string, unknown>): void;
  /**
   * Save the model to the database.
   *
   * Performs insert if `isNew === true`, otherwise performs update.
   * Automatically validates, casts, generates IDs, and emits lifecycle events.
   *
   * **Features:**
   * - Validation via @warlock.js/seal schema
   * - Data casting (string → number, etc.)
   * - ID generation (NoSQL only)
   * - Partial updates (only changed fields)
   * - Lifecycle events (validating, saving, created/updated, saved)
   *
   * @param data - Optional data to merge before saving
   * @param options - Save options
   * @returns The model instance for method chaining
   *
   * @throws {ValidationError} If validation fails
   * @throws {Error} If database operation fails
   *
   * @example
   * ```typescript
   * // Simple save
   * const user = new User({ name: "Alice" });
   * await user.save();
   *
   * // Merge data before saving
   * await user.save({ age: 31, email: "alice@example.com" });
   *
   * // Silent save (no events)
   * await user.save(null, { skipEvents: true });
   *
   * // Skip validation
   * await user.save(null, { skipValidation: true });
   *
   * // Method chaining
   * await user.set("name", "Bob").save();
   * ```
   */
  save(options?: WriterOptions & {
    merge?: Partial<TSchema>;
  }): Promise<this>;
  /**
   * Serialize the model data for storage in the database.
   *
   * Uses the driver's `serialize` to apply driver-specific type transformations
   * (e.g. Date → ISO string, BigInt → string for Postgres).
   *
   * **Not** the same as `toSnapshot` — this is a DB write concern, not a cache concern.
   */
  serialize(): Record<string, unknown>;
  /**
   * Produce a plain-object snapshot of this model suitable for cache storage.
   *
   * - `data`: The model's own fields, serialized via the driver (handles Dates, BigInt, ObjectId).
   * - `relations`: Each entry in `loadedRelations` recursively snapshotted via `toSnapshot`.
   *   A relation that was loaded but resolved to `null` is stored as `null` (not omitted),
   *   so that `fromSnapshot` can distinguish "loaded + null" from "never loaded".
   *
   * Use `Model.fromSnapshot(snapshot)` to reconstruct.
   *
   * @example
   * ```typescript
   * await cache.set(key, chat.toSnapshot());
   * ```
   */
  toSnapshot(): ModelSnapshot;
  /**
   * Reconstruct a model instance (with relations) from a cache snapshot.
   *
   * Counterpart to `toSnapshot`. Applies driver deserialization (e.g. ISO string → Date)
   * and recursively hydrates any nested relation snapshots via `RelationHydrator`.
   *
   * @example
   * ```typescript
   * const snapshot = await cache.get(key);
   * const chat = Chat.fromSnapshot(snapshot);
   * chat.unit; // Unit model instance, fully hydrated
   * ```
   */
  static fromSnapshot<TModel extends Model>(this: ChildModel<TModel>, snapshot: ModelSnapshot): TModel;
  /**
   * Create a model instance from raw data (no relations).
   *
   * This is the data-only hydration path, used by the query builder when
   * converting a raw DB row into a model instance. Relations are NOT restored
   * here — use `fromSnapshot` when restoring from a cache snapshot that
   * includes relation data.
   *
   * @example
   * ```typescript
   * // Query builder internals:
   * const user = User.hydrate(rawRow);
   * ```
   */
  static hydrate<TModel extends Model = Model>(this: ChildModel<TModel>, data: Record<string, unknown>): TModel;
  /**
   * Convert the model into JSON
   */
  toJSON(): Record<string, unknown>;
}
//#endregion
export { Model };
//# sourceMappingURL=model.d.mts.map