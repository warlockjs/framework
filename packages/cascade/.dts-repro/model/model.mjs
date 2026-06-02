import { ModelEvents } from "../events/model-events.mjs";
import { getAllModelsFromRegistry, getModelFromRegistry } from "./register-model.mjs";
import { RelationLoader, attachLoadedRelation } from "../relations/relation-loader.mjs";
import { modelSync } from "../sync/model-sync.mjs";
import { decrementField, getBooleanField, getFieldValue, getNumberField, getOnlyFields, getStringField, hasField, incrementField, mergeFields, setFieldValue, unsetFields } from "./methods/accessor-methods.mjs";
import { deleteOneRecord, deleteRecords, destroyModel } from "./methods/delete-methods.mjs";
import { checkHasChanges, checkIsDirty, getDirtyColumns, getDirtyColumnsWithValues, getRemovedColumns } from "./methods/dirty-methods.mjs";
import { cloneModel, deepFreezeObject, hydrateModel, modelFromSnapshot, modelToSnapshot, replaceModelData, serializeModel } from "./methods/hydration-methods.mjs";
import { emitModelEvent, offModelEvent, onModelEvent, onceModelEvent } from "./methods/instance-event-methods.mjs";
import { applyDefaultsToModel, generateModelNextId, performAtomicDecrement, performAtomicIncrement, performAtomicUpdate } from "./methods/meta-methods.mjs";
import { attachPivotRelation, detachPivotRelation, pivotRelation } from "./methods/pivot-methods.mjs";
import { buildNewQueryBuilder, buildQuery, countRecords, decreaseField, findAll, findAndReplaceRecord, findAndUpdateRecords, findById, findFirst, findLast, findLatest, findOneAndDeleteRecord, findOneAndUpdateRecord, increaseField, paginateRecords, performAtomic, resolveDataSource, updateById } from "./methods/query-methods.mjs";
import { restoreAllRecords, restoreRecord } from "./methods/restore-methods.mjs";
import { addGlobalModelScope, addLocalModelScope, removeGlobalModelScope, removeLocalModelScope } from "./methods/scope-methods.mjs";
import { modelToJSON } from "./methods/serialization-methods.mjs";
import { cleanupModelEvents, getGlobalEvents, getModelEvents, offStaticEvent, onStaticEvent, onceStaticEvent } from "./methods/static-event-methods.mjs";
import { createManyRecords, createRecord, findOrCreateRecord, saveModel, upsertRecord } from "./methods/write-methods.mjs";
//#region ../../@warlock.js/cascade/src/model/model.ts
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
var Model = class Model {
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
	static table;
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
	static resource;
	/**
	* Resource columns
	* Define what columns should be sent to the resource (if any) when converting to JSON
	*/
	static resourceColumns;
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
	static toJsonColumns;
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
	static dataSource;
	/**
	* Query builder class
	*/
	static builder;
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
	static primaryKey = "id";
	/**
	* Embeded fields when document is Being embeded
	*/
	static embed;
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
	static schema;
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
	static strictMode = "strip";
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
	static autoGenerateId = true;
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
	static initialId;
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
	static randomInitialId;
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
	static incrementIdBy = 1;
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
	static randomIncrement;
	/**
	* Created at column name.
	*/
	static createdAtColumn;
	/**
	* Updated at column name.
	*/
	static updatedAtColumn;
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
	static deleteStrategy;
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
	static deletedAtColumn = "deletedAt";
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
	static trashTable;
	/**
	* Global scopes that are automatically applied to all queries.
	* These scopes are inherited by child models.
	*/
	static globalScopes = /* @__PURE__ */ new Map();
	/**
	* Local scopes that can be manually applied to queries.
	* These are reusable query snippets that developers opt into.
	*/
	static localScopes = /* @__PURE__ */ new Map();
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
	static relations = {};
	/**
	* Flag indicating whether this model instance represents a new (unsaved) record.
	*
	* - `true`: The model has not been persisted to the database yet
	* - `false`: The model represents an existing database record
	*
	* This flag is used by the writer to determine whether to perform an insert or update.
	*/
	isNew = true;
	/**
	* The raw mutable data backing this model instance.
	*
	* All field accessors (get, set, merge, etc.) operate on this object.
	*/
	data;
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
	dirtyTracker;
	/**
	* Model instance events.
	* Allows registering listeners for lifecycle events on this specific instance.
	*/
	events = new ModelEvents();
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
	loadedRelations = /* @__PURE__ */ new Map();
	/**
	* Column name for active status.
	*/
	isActiveColumn = "isActive";
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
	constructor(initialData = {}) {
		this.data = initialData;
		this.dirtyTracker = this.self().getDriver().getDirtyTracker(this.data);
	}
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
	async load(...relations) {
		const ModelClass = this.constructor;
		await new RelationLoader([this], ModelClass).load(relations);
		return this;
	}
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
	isLoaded(relationName) {
		return this.loadedRelations.has(relationName);
	}
	/**
	* Set relation manually
	*
	* @param relationName
	* @param relationData
	*/
	setRelation(relationName, relationData) {
		attachLoadedRelation(this, relationName, relationData);
	}
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
	getRelation(relationName) {
		return this.loadedRelations.get(relationName);
	}
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
	static getModel(name) {
		return getModelFromRegistry(name);
	}
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
	static getAllModels() {
		return getAllModelsFromRegistry();
	}
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
	static sync(TargetModel, targetField) {
		return modelSync.sync(this, TargetModel, targetField);
	}
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
	static syncMany(TargetModel, targetField) {
		return modelSync.syncMany(this, TargetModel, targetField);
	}
	/**
	* Get model id
	*/
	get id() {
		return this.get("id");
	}
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
	get uuid() {
		return this.get("id");
	}
	get(field, defaultValue) {
		return getFieldValue(this, field, defaultValue);
	}
	only(fields) {
		return getOnlyFields(this, fields);
	}
	/**
	* Get a string value
	*/
	string(key, defaultValue) {
		return getStringField(this, key, defaultValue);
	}
	/**
	* Get a number value
	*/
	number(key, defaultValue) {
		return getNumberField(this, key, defaultValue);
	}
	/**
	* Get a boolean value
	*/
	boolean(key, defaultValue) {
		return getBooleanField(this, key, defaultValue);
	}
	set(field, value) {
		return setFieldValue(this, field, value);
	}
	has(field) {
		return hasField(this, field);
	}
	increment(field, amount) {
		return incrementField(this, field, amount);
	}
	decrement(field, amount) {
		return decrementField(this, field, amount);
	}
	unset(...fields) {
		return unsetFields(this, ...fields);
	}
	merge(values) {
		return mergeFields(this, values);
	}
	/**
	* Perform atomoic update from current model instance
	* Please note that it would require the id to be existing in the current
	* model instance
	* @returns number of affected records
	*/
	async atomicUpdate(operations) {
		return performAtomicUpdate(this, operations);
	}
	/**
	* Perform atomic increment
	* This would issue a query update and update the given field without
	* saving the model
	*/
	async atomicIncrement(field, amount = 1) {
		return performAtomicIncrement(this, field, amount);
	}
	/**
	* Perform atomic decrement
	* This would issue a query update and update the given field without
	* saving the model
	*/
	async atomicDecrement(field, amount = 1) {
		return performAtomicDecrement(this, field, amount);
	}
	/**
	* Determine if current model is active
	*/
	get isActive() {
		return this.get(this.isActiveColumn);
	}
	/**
	* Get created at date
	*/
	get createdAt() {
		const createdAtColumn = this.self().createdAtColumn;
		if (!createdAtColumn) return;
		return this.get(createdAtColumn);
	}
	/**
	* Get updated at date
	*/
	get updatedAt() {
		const updatedAtColumn = this.self().updatedAtColumn;
		if (!updatedAtColumn) return;
		return this.get(updatedAtColumn);
	}
	/**
	* Check if current model record is created by the given user model
	*/
	isCreatedBy(user) {
		return this.get(`createdBy.id`) === user.id;
	}
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
	hasChanges() {
		return checkHasChanges(this);
	}
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
	isDirty(column) {
		return checkIsDirty(this, column);
	}
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
	getDirtyColumnsWithValues() {
		return getDirtyColumnsWithValues(this);
	}
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
	getRemovedColumns() {
		return getRemovedColumns(this);
	}
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
	getDirtyColumns() {
		return getDirtyColumns(this);
	}
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
	async emitEvent(event, context) {
		return emitModelEvent(this, event, context);
	}
	/**
	* Register a listener for a model lifecycle event on this instance.
	*
	* @param event - Event name (e.g., "saving", "updated")
	* @param listener - Callback function
	* @returns Unsubscribe function
	*/
	on(event, listener) {
		return onModelEvent(this, event, listener);
	}
	/**
	* Register a one-time listener for a model lifecycle event on this instance.
	*
	* @param event - Event name
	* @param listener - Callback function
	* @returns Unsubscribe function
	*/
	once(event, listener) {
		return onceModelEvent(this, event, listener);
	}
	/**
	* Remove a listener from this instance.
	*
	* @param event - Event name
	* @param listener - Callback function to remove
	*/
	off(event, listener) {
		offModelEvent(this, event, listener);
	}
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
	static getDataSource() {
		return resolveDataSource(this);
	}
	/**
	* Get driver instance
	*/
	static getDriver() {
		return this.getDataSource().driver;
	}
	/**
	* Generate next id and set it to current model's id
	*/
	async generateNextId() {
		return generateModelNextId(this);
	}
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
	static applyModelDefaults(defaults) {
		applyDefaultsToModel(this, defaults);
	}
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
	static addGlobalScope(name, callback, options = {}) {
		addGlobalModelScope(this, name, callback, options);
	}
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
	static removeGlobalScope(name) {
		removeGlobalModelScope(this, name);
	}
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
	static addScope(name, callback) {
		addLocalModelScope(this, name, callback);
	}
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
	static removeScope(name) {
		removeLocalModelScope(this, name);
	}
	/**
	* Create a new query builder for this model
	*/
	static query() {
		return buildQuery(this, Model);
	}
	static with(...args) {
		return this.query().with(...args);
	}
	static withCount(...args) {
		return this.query().withCount(...args);
	}
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
	static joinWith(...relations) {
		return this.query().joinWith(...relations);
	}
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
	static newQueryBuilder() {
		return buildNewQueryBuilder(this);
	}
	/**
	* Get First matched record for the given filter
	*/
	static async first(filter) {
		return findFirst(this, filter);
	}
	/**
	* Get last matched record for the given filter
	*/
	static async last(filter) {
		return findLast(this, filter);
	}
	static where(...args) {
		return this.query().where(...args);
	}
	/**
	* Count the number of records in the table
	* @param filter - The filter to apply to the query
	*/
	static count(filter) {
		return countRecords(this, filter);
	}
	/**
	* Find record by id
	*/
	static async find(id) {
		return findById(this, id);
	}
	/**
	* Get all records from the table
	*
	* @param filter - The filter to apply to the query
	* @returns All records from the table
	*/
	static async all(filter) {
		return findAll(this, filter);
	}
	/**
	* Perform pagination
	*/
	static async paginate(options = {}) {
		return paginateRecords(this, options);
	}
	/**
	* Get latest records from the table
	*
	* @param filter - The filter to apply to the query
	*/
	static async latest(filter) {
		return findLatest(this, filter);
	}
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
	static increase(filter, field, amount) {
		return increaseField(this, filter, field, amount);
	}
	/**
	* Decrement the given field by the given amount using atomic update
	* @example ```typescript
	* // Decrease age by 1 for user id 1
	* User.decrement({id: 1}, "age", 1);
	* // Decrease age by 1 and views by 2 for user id 1
	* User.decrement({id: 1}, {age: 1, views: 2});
	* ```
	*/
	static decrease(filter, field, amount) {
		return decreaseField(this, filter, field, amount);
	}
	/**
	* Perform atomic operation
	* Example
	*
	* ```typescript
	* const user = await User.atomic({id: 1}, {$inc: {age: 1}})
	* Returns user model with updated age
	*/
	static async atomic(filter, operations) {
		return performAtomic(this, filter, operations);
	}
	/**
	* Perform an atomic update for the given id
	*/
	static async update(id, data) {
		return updateById(this, id, data);
	}
	/**
	* Find one and update multiple records that matches the provided filter and return the updated record
	* @param filter - Filter conditions
	* @param update - Update operations ($set, $unset, $inc)
	* @returns The updated records
	*/
	static async findAndUpdate(filter, update) {
		return findAndUpdateRecords(this, filter, update);
	}
	/**
	* Find one and update a single record that matches the provided filter and return the updated record
	* @param filter - Filter conditions
	* @param update - Update operations ($set, $unset, $inc)
	* @returns The updated record or null
	*/
	static async findOneAndUpdate(filter, update) {
		return findOneAndUpdateRecord(this, filter, update);
	}
	/**
	* Find and replace the entire document that matches the provided filter and return the replaced document
	*/
	static async findAndReplace(filter, document) {
		return findAndReplaceRecord(this, filter, document);
	}
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
	async destroy(options) {
		return destroyModel(this, options);
	}
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
	async attach(relation, ids, pivotData) {
		return attachPivotRelation(this, relation, ids, pivotData);
	}
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
	async detach(relation, ids) {
		return detachPivotRelation(this, relation, ids);
	}
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
	pivot(relation) {
		return pivotRelation(this, relation);
	}
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
	self() {
		return this.constructor;
	}
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
	clone() {
		return cloneModel(this);
	}
	/**
	* Recursively freezes an object and all its nested properties.
	*
	* @param obj - The object to freeze
	* @returns The frozen object
	*/
	deepFreeze(obj) {
		return deepFreezeObject(obj);
	}
	/**
	* Get table name
	*/
	getTableName() {
		return this.self().table;
	}
	/**
	* Get primary key name
	*/
	getPrimaryKey() {
		return this.self().primaryKey;
	}
	/**
	* Get model schema
	*/
	getSchema() {
		return this.self().schema;
	}
	/**
	* Check if schema has the given key
	*/
	schemaHas(key) {
		return this.self().schema?.schema[key] !== void 0;
	}
	/**
	* Get strict mode
	*/
	getStrictMode() {
		return this.self().strictMode;
	}
	/**
	* Get data source (Connection)
	*/
	getConnection() {
		return this.self().getDataSource();
	}
	/**
	* Delete all matching documents from the table.
	*/
	static async delete(filter) {
		return deleteRecords(this, filter);
	}
	/**
	* Delete a single matching document from the table.
	*/
	static async deleteOne(filter) {
		return deleteOneRecord(this, filter);
	}
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
	static async restore(id, options) {
		return restoreRecord(this, id, options);
	}
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
	static async restoreAll(options) {
		return restoreAllRecords(this, options);
	}
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
	static async create(data) {
		return createRecord(this, data);
	}
	/**
	* Create many documents and return an array of created models
	*/
	static async createMany(data) {
		return createManyRecords(this, data);
	}
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
	static async findOrCreate(filter, data) {
		return findOrCreateRecord(this, filter, data);
	}
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
	static async upsert(filter, data, options) {
		return upsertRecord(this, filter, data, options);
	}
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
	static async updateOrCreate(filter, data, options) {
		return await this.upsert(filter, data, options);
	}
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
	static async findOneAndDelete(filter, options) {
		return findOneAndDeleteRecord(this, filter, options);
	}
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
	get embedData() {
		return this.self().embed ? this.only(this.self().embed) : this.data;
	}
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
	static $cleanup() {
		cleanupModelEvents(this);
	}
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
	static events() {
		return getModelEvents(this);
	}
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
	static on(event, listener) {
		return onStaticEvent(this, event, listener);
	}
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
	static once(event, listener) {
		return onceStaticEvent(this, event, listener);
	}
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
	static off(event, listener) {
		offStaticEvent(this, event, listener);
	}
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
	static globalEvents() {
		return getGlobalEvents();
	}
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
	replaceData(data) {
		replaceModelData(this, data);
	}
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
	async save(options) {
		return saveModel(this, options);
	}
	/**
	* Serialize the model data for storage in the database.
	*
	* Uses the driver's `serialize` to apply driver-specific type transformations
	* (e.g. Date → ISO string, BigInt → string for Postgres).
	*
	* **Not** the same as `toSnapshot` — this is a DB write concern, not a cache concern.
	*/
	serialize() {
		return serializeModel(this);
	}
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
	toSnapshot() {
		return modelToSnapshot(this);
	}
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
	static fromSnapshot(snapshot) {
		return modelFromSnapshot(this, snapshot);
	}
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
	static hydrate(data) {
		return hydrateModel(this, data);
	}
	/**
	* Convert the model into JSON
	*/
	toJSON() {
		return modelToJSON(this);
	}
};
//#endregion
export { Model };

//# sourceMappingURL=model.mjs.map