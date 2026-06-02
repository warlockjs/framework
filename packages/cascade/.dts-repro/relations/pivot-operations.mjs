import { resolveModelClass, resolveModelName } from "../model/register-model.mjs";
import { inferPivotKey, inferPivotTable } from "./key-conventions.mjs";
//#region ../../@warlock.js/cascade/src/relations/pivot-operations.ts
/**
* Manages pivot table operations for many-to-many relationships.
*
* Provides attach, detach, sync, and toggle operations for managing
* the connections between two models through a pivot table.
*
* @example
* ```typescript
* const pivotOps = new PivotOperations(post, "tags", tagsDefinition);
*
* // Attach tags
* await pivotOps.attach([1, 2, 3]);
*
* // Attach with pivot data
* await pivotOps.attach([4], { addedBy: userId });
*
* // Detach specific tags
* await pivotOps.detach([2]);
*
* // Sync (replace all)
* await pivotOps.sync([1, 5, 6]);
*
* // Toggle (attach if missing, detach if present)
* await pivotOps.toggle([1, 7]);
* ```
*/
var PivotOperations = class {
	/**
	* The model instance performing the pivot operation.
	*/
	model;
	/**
	* The name of the relation.
	*/
	relationName;
	/**
	* The relation definition with pivot table configuration.
	*/
	definition;
	/**
	* The model class of the source model.
	*/
	modelClass;
	/**
	* Creates a new PivotOperations instance.
	*
	* @param model - The model instance performing the operation
	* @param relationName - The name of the belongsToMany relation
	* @param definition - The relation definition
	* @param modelClass - The model class constructor
	*/
	constructor(model, relationName, definition, modelClass) {
		if (definition.type !== "belongsToMany") throw new Error(`Pivot operations are only available for belongsToMany relations. Relation "${relationName}" is of type "${definition.type}".`);
		this.model = model;
		this.relationName = relationName;
		this.definition = definition;
		this.modelClass = modelClass;
	}
	/**
	* Read the configured relation conventions from this pivot's owning
	* data source. Returns `undefined` when no overrides are set.
	*/
	get relationDefaults() {
		try {
			return this.modelClass.getDataSource()?.relationDefaults;
		} catch {
			return;
		}
	}
	/**
	* Attaches one or more related models via the pivot table.
	*
	* Creates new records in the pivot table linking this model to the
	* specified related model IDs. Existing attachments are not duplicated.
	*
	* @param ids - The IDs of the related models to attach
	* @param pivotData - Optional additional data to store in the pivot record
	*
	* @example
	* ```typescript
	* // Attach tags to a post
	* await post.attach("tags", [1, 2, 3]);
	*
	* // Attach with additional pivot data
	* await post.attach("tags", [4], { addedBy: currentUserId });
	* ```
	*/
	async attach(ids, pivotData) {
		if (ids.length === 0) return;
		const { pivotTable, localKeyValue, pivotLocalKey, pivotForeignKey } = this.getPivotConfig();
		const existingIds = await this.getExistingPivotIds();
		const newIds = ids.filter((id) => !existingIds.has(id));
		if (newIds.length === 0) return;
		const records = newIds.map((id) => ({
			[pivotLocalKey]: localKeyValue,
			[pivotForeignKey]: id,
			...pivotData
		}));
		await this.modelClass.getDataSource().driver.insertMany(pivotTable, records);
	}
	/**
	* Detaches one or more related models from the pivot table.
	*
	* Removes records from the pivot table. If no IDs are specified,
	* all attachments for this model are removed.
	*
	* @param ids - Optional IDs to detach. If omitted, detaches all.
	*
	* @example
	* ```typescript
	* // Detach specific tags
	* await post.detach("tags", [2, 3]);
	*
	* // Detach all tags
	* await post.detach("tags");
	* ```
	*/
	async detach(ids) {
		const { pivotTable, localKeyValue, pivotLocalKey, pivotForeignKey } = this.getPivotConfig();
		const dataSource = this.modelClass.getDataSource();
		const filter = { [pivotLocalKey]: localKeyValue };
		if (ids && ids.length > 0) filter[pivotForeignKey] = { $in: ids };
		await dataSource.driver.deleteMany(pivotTable, filter);
	}
	/**
	* Synchronizes the pivot table to match the specified IDs.
	*
	* Attaches any new IDs and detaches any IDs not in the list.
	* After sync, the pivot table will contain exactly the specified IDs.
	*
	* @param ids - The IDs that should be attached after sync
	* @param pivotData - Optional data for newly attached records
	*
	* @example
	* ```typescript
	* // Set tags to exactly [1, 3, 5], removing any others
	* await post.sync("tags", [1, 3, 5]);
	* ```
	*/
	async sync(ids, pivotData) {
		const existingIds = await this.getExistingPivotIds();
		const newIdSet = new Set(ids);
		const toDetach = [];
		for (const existingId of existingIds) if (!newIdSet.has(existingId)) toDetach.push(existingId);
		const toAttach = ids.filter((id) => !existingIds.has(id));
		if (toDetach.length > 0) await this.detach(toDetach);
		if (toAttach.length > 0) await this.attach(toAttach, pivotData);
	}
	/**
	* Toggles the attachment status of the specified IDs.
	*
	* For each ID: if attached, detaches it; if not attached, attaches it.
	*
	* @param ids - The IDs to toggle
	* @param pivotData - Optional data for newly attached records
	*
	* @example
	* ```typescript
	* // Toggle tags - attached become detached, detached become attached
	* await post.toggle("tags", [1, 4]);
	* ```
	*/
	async toggle(ids, pivotData) {
		if (ids.length === 0) return;
		const existingIds = await this.getExistingPivotIds();
		const toAttach = [];
		const toDetach = [];
		for (const id of ids) if (existingIds.has(id)) toDetach.push(id);
		else toAttach.push(id);
		if (toDetach.length > 0) await this.detach(toDetach);
		if (toAttach.length > 0) await this.attach(toAttach, pivotData);
	}
	/**
	* Gets the pivot table configuration.
	*
	* @returns The pivot configuration object
	*/
	getPivotConfig() {
		const conventions = this.relationDefaults;
		const relatedModelName = resolveModelName(this.definition.model);
		const pivotTable = this.definition.pivot ?? inferPivotTable(this.modelClass.name, relatedModelName, conventions);
		const RelatedModel = resolveModelClass(this.definition.model);
		const localKey = this.definition.pivotLocalKey ?? this.modelClass.primaryKey ?? "id";
		const pivotLocalKey = this.definition.localKey ?? inferPivotKey(this.modelClass.name, conventions);
		const pivotForeignKey = this.definition.foreignKey ?? inferPivotKey(relatedModelName, conventions);
		const relatedKey = this.definition.pivotForeignKey ?? RelatedModel?.primaryKey ?? "id";
		return {
			pivotTable,
			localKeyValue: this.model.get(localKey),
			pivotLocalKey,
			pivotForeignKey,
			relatedKey
		};
	}
	/**
	* Gets all currently attached IDs from the pivot table.
	*
	* @returns A set of attached foreign key values
	*/
	async getExistingPivotIds() {
		const { pivotTable, localKeyValue, pivotLocalKey, pivotForeignKey } = this.getPivotConfig();
		const records = await this.modelClass.getDataSource().driver.queryBuilder(pivotTable).select([pivotForeignKey]).where(pivotLocalKey, localKeyValue).get();
		const ids = /* @__PURE__ */ new Set();
		for (const record of records) {
			const id = record[pivotForeignKey];
			if (id !== void 0 && id !== null) ids.add(id);
		}
		return ids;
	}
};
/**
* Creates a PivotOperations instance for a model and relation.
*
* @param model - The model instance
* @param relationName - The name of the belongsToMany relation
* @returns A PivotOperations instance
* @throws Error if the relation is not a belongsToMany or not defined
*/
function createPivotOperations(model, relationName) {
	const ModelClass = model.constructor;
	const relations = ModelClass.relations;
	if (!relations || !relations[relationName]) throw new Error(`Relation "${relationName}" is not defined on model "${ModelClass.name}".`);
	return new PivotOperations(model, relationName, relations[relationName], ModelClass);
}
//#endregion
export { PivotOperations, createPivotOperations };

//# sourceMappingURL=pivot-operations.mjs.map