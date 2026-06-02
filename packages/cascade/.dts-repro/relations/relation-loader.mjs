import { getModelFromRegistry, resolveModelName } from "../model/register-model.mjs";
import { inferBelongsToForeignKey, inferHasForeignKey, inferPivotKey, inferPivotTable } from "./key-conventions.mjs";
import { isLazy } from "@mongez/reinforcements";
//#region ../../@warlock.js/cascade/src/relations/relation-loader.ts
/**
* @fileoverview Core relation loading logic for the Cascade ORM.
*
* The RelationLoader is responsible for efficiently loading related models
* while preventing N+1 query problems through batch loading strategies.
*
* @module @warlock.js/cascade/relations/relation-loader
*/
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
function attachLoadedRelation(model, name, value) {
	const modelWithRelations = model;
	if (!modelWithRelations.loadedRelations) modelWithRelations.loadedRelations = /* @__PURE__ */ new Map();
	const relations = modelWithRelations.loadedRelations;
	relations.set(name, value);
	Object.defineProperty(model, name, {
		configurable: true,
		enumerable: true,
		get() {
			return relations.get(name);
		},
		set(next) {
			relations.set(name, next);
		}
	});
}
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
var RelationLoader = class RelationLoader {
	/**
	* The model instances to load relations for.
	*/
	models;
	/**
	* The model class constructor.
	*/
	modelClass;
	/**
	* Creates a new RelationLoader instance.
	*
	* @param models - The model instances to load relations for
	* @param modelClass - The model class constructor
	*/
	constructor(models, modelClass) {
		this.models = models;
		this.modelClass = modelClass;
	}
	/**
	* Read the configured relation conventions from this model's data
	* source. Returns `undefined` when no overrides are set — the inference
	* helpers fall back to framework defaults in that case.
	*/
	get relationDefaults() {
		try {
			return this.modelClass.getDataSource()?.relationDefaults;
		} catch {
			return;
		}
	}
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
	async load(relations, constraints) {
		if (this.models.length === 0) return;
		const relationNames = Array.isArray(relations) ? relations : [relations];
		for (const relationName of relationNames) {
			const constraint = constraints?.[relationName];
			const callbackConstraint = typeof constraint === "function" ? constraint : void 0;
			await this.loadRelation(relationName, callbackConstraint);
		}
	}
	/**
	* Loads a single relation, handling nested relations via dot notation.
	*
	* @param name - The relation name, possibly with dot notation for nesting
	* @param constraint - Optional constraint callback
	*/
	async loadRelation(name, constraint) {
		const path = this.parseNestedRelation(name);
		const rootRelation = path[0];
		const definition = this.getRelationDefinition(rootRelation);
		if (!definition) throw new Error(`Relation "${rootRelation}" is not defined on model "${this.modelClass.name}". Make sure to define it in the static 'relations' property.`);
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
		if (path.length > 1) await this.loadNestedRelations(rootRelation, path.slice(1), constraint);
	}
	/**
	* Loads a hasMany relation for all models.
	*
	* @param name - The relation name
	* @param definition - The relation definition
	* @param constraint - Optional constraint callback
	*/
	async loadHasMany(name, definition, constraint) {
		const RelatedModel = this.resolveModelClass(definition.model);
		const localKey = definition.localKey ?? this.modelClass.primaryKey ?? "id";
		const foreignKey = definition.foreignKey ?? inferHasForeignKey(this.modelClass.name, this.relationDefaults);
		const localKeyValues = this.collectKeyValues(localKey);
		if (localKeyValues.length === 0) {
			this.setRelationOnModels(name, () => []);
			return;
		}
		const query = RelatedModel.query().whereIn(foreignKey, localKeyValues);
		if (constraint) constraint(query);
		const relatedRecords = await query.get();
		const recordsByForeignKey = this.groupBy(relatedRecords, foreignKey);
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
	async loadHasOne(name, definition, constraint) {
		const RelatedModel = this.resolveModelClass(definition.model);
		const localKey = definition.localKey ?? this.modelClass.primaryKey ?? "id";
		const foreignKey = definition.foreignKey ?? inferHasForeignKey(this.modelClass.name, this.relationDefaults);
		const localKeyValues = this.collectKeyValues(localKey);
		if (localKeyValues.length === 0) {
			this.setRelationOnModels(name, () => null);
			return;
		}
		const query = RelatedModel.query().whereIn(foreignKey, localKeyValues);
		if (constraint) constraint(query);
		const relatedRecords = await query.get();
		const recordsByForeignKey = /* @__PURE__ */ new Map();
		for (const record of relatedRecords) {
			const fkValue = record.get(foreignKey);
			if (!recordsByForeignKey.has(fkValue)) recordsByForeignKey.set(fkValue, record);
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
	async loadBelongsTo(name, definition, constraint) {
		const RelatedModel = this.resolveModelClass(definition.model);
		const foreignKey = definition.foreignKey ?? inferBelongsToForeignKey(name, this.relationDefaults);
		const ownerKey = definition.localKey ?? RelatedModel.primaryKey ?? "id";
		const foreignKeyValues = this.collectKeyValues(foreignKey);
		if (foreignKeyValues.length === 0) {
			this.setRelationOnModels(name, () => null);
			return;
		}
		const query = RelatedModel.query().whereIn(ownerKey, foreignKeyValues);
		if (constraint) constraint(query);
		const relatedRecords = await query.get();
		const recordsByOwnerKey = /* @__PURE__ */ new Map();
		for (const record of relatedRecords) {
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
	async loadBelongsToMany(name, definition, constraint) {
		const RelatedModel = this.resolveModelClass(definition.model);
		const relatedModelName = resolveModelName(definition.model);
		const pivotTable = definition.pivot ?? inferPivotTable(this.modelClass.name, relatedModelName, this.relationDefaults);
		const localKey = definition.pivotLocalKey ?? this.modelClass.primaryKey ?? "id";
		const pivotLocalKey = definition.localKey ?? inferPivotKey(this.modelClass.name, this.relationDefaults);
		const pivotForeignKey = definition.foreignKey ?? inferPivotKey(relatedModelName, this.relationDefaults);
		const relatedKey = definition.pivotForeignKey ?? RelatedModel.primaryKey ?? "id";
		const localKeyValues = this.collectKeyValues(localKey);
		if (localKeyValues.length === 0) {
			this.setRelationOnModels(name, () => []);
			return;
		}
		const pivotRecords = await this.modelClass.getDataSource().driver.queryBuilder(pivotTable).whereIn(pivotLocalKey, localKeyValues).get();
		if (pivotRecords.length === 0) {
			this.setRelationOnModels(name, () => []);
			return;
		}
		const relatedIds = [...new Set(pivotRecords.map((p) => p[pivotForeignKey]))];
		const relatedQuery = RelatedModel.query().whereIn(relatedKey, relatedIds);
		if (constraint) constraint(relatedQuery);
		const relatedRecords = await relatedQuery.get();
		const relatedById = /* @__PURE__ */ new Map();
		for (const record of relatedRecords) relatedById.set(record.get(relatedKey), record);
		const relationshipMap = /* @__PURE__ */ new Map();
		for (const pivot of pivotRecords) {
			const localValue = pivot[pivotLocalKey];
			const foreignValue = pivot[pivotForeignKey];
			const relatedRecord = relatedById.get(foreignValue);
			if (relatedRecord) {
				if (!relationshipMap.has(localValue)) relationshipMap.set(localValue, []);
				relationshipMap.get(localValue).push(relatedRecord);
			}
		}
		this.setRelationOnModels(name, (model) => {
			const keyValue = model.get(localKey);
			return relationshipMap.get(keyValue) ?? [];
		});
	}
	/**
	* Loads nested relations recursively.
	*
	* @param parentRelation - The name of the parent relation
	* @param remainingPath - The remaining path segments to load
	* @param constraint - Optional constraint callback
	*/
	async loadNestedRelations(parentRelation, remainingPath, constraint) {
		const relatedModels = [];
		for (const model of this.models) {
			const loaded = this.getLoadedRelation(model, parentRelation);
			if (Array.isArray(loaded)) relatedModels.push(...loaded);
			else if (loaded) relatedModels.push(loaded);
		}
		if (relatedModels.length === 0) return;
		const parentDefinition = this.getRelationDefinition(parentRelation);
		if (!parentDefinition) return;
		const nestedLoader = new RelationLoader(relatedModels, this.resolveModelClass(parentDefinition.model));
		const nextRelation = remainingPath.join(".");
		await nestedLoader.load(nextRelation, constraint ? { [nextRelation]: constraint } : void 0);
	}
	/**
	* Parses a dot-notation relation path into segments.
	*
	* @param path - The relation path (e.g., "posts.comments.author")
	* @returns An array of relation names
	*/
	parseNestedRelation(path) {
		return path.split(".");
	}
	/**
	* Resolves a model class from the registry by name.
	*
	* @param name - The registered model name
	* @returns The model class constructor
	* @throws Error if the model is not found in the registry
	*/
	resolveModelClass(model) {
		if (typeof model === "function") return model;
		if (isLazy(model)) return model.resolve();
		const ModelClass = getModelFromRegistry(model);
		if (!ModelClass) {
			const callerName = this.modelClass.name || "unknown";
			throw new Error(`Cannot resolve relation target — model "${model}" is not registered.\n  Caller: ${callerName} (relation target reference)\n  Common causes:\n    - The target model is missing the @RegisterModel() decorator\n    - The target model's module is not imported anywhere at startup\n    - Circular import between the caller and target — one of them sees\n      the other as undefined during module load\n  Fix: add an explicit \`import "<path-to-${model}-model>";\` to your app's\n  entry point so the decorator runs before any query consults this relation.\n  Alternative: declare the relation with \`lazy(() => ${model})\` instead of a string\n  to bind directly to the class (no registry lookup needed).`);
		}
		return ModelClass;
	}
	/**
	* Gets the relation definition from the model class.
	*
	* @param name - The relation name
	* @returns The relation definition or undefined
	*/
	getRelationDefinition(name) {
		return this.modelClass.relations?.[name];
	}
	/**
	* Collects unique key values from all models.
	*
	* @param key - The key to collect values for
	* @returns An array of unique key values
	*/
	collectKeyValues(key) {
		const values = /* @__PURE__ */ new Set();
		for (const model of this.models) {
			const value = model.get(key);
			if (value !== void 0 && value !== null) values.add(value);
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
	groupBy(records, key) {
		const groups = /* @__PURE__ */ new Map();
		for (const record of records) {
			const keyValue = record.get(key);
			if (!groups.has(keyValue)) groups.set(keyValue, []);
			groups.get(keyValue).push(record);
		}
		return groups;
	}
	/**
	* Sets a relation value on all models using a getter function.
	*
	* @param name - The relation name
	* @param getter - Function that returns the relation value for each model
	*/
	setRelationOnModels(name, getter) {
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
	getLoadedRelation(model, name) {
		return model.loadedRelations?.get(name);
	}
	/**
	* Sets a loaded relation on a model instance.
	*
	* @param model - The model instance
	* @param name - The relation name
	* @param value - The relation value
	*/
	setLoadedRelation(model, name, value) {
		attachLoadedRelation(model, name, value);
	}
};
//#endregion
export { RelationLoader, attachLoadedRelation };

//# sourceMappingURL=relation-loader.mjs.map