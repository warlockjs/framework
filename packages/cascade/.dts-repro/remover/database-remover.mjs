import { getModelDeletedEvent } from "../sync/model-events.mjs";
import events from "@mongez/events";
//#region ../../@warlock.js/cascade/src/remover/database-remover.ts
/**
* Database remover service that orchestrates model deletion.
*
* Handles the complete deletion pipeline:
* 1. Strategy resolution (options → model static → data source default)
* 2. Validation (check if model is new, has primary key)
* 3. Event emission (deleting, deleted)
* 4. Driver execution (based on strategy: trash, permanent, or soft)
* 5. Post-deletion cleanup (mark as new, reset state)
*
* @example
* ```typescript
* const user = await User.find(1);
* const remover = new DatabaseRemover(user);
* const result = await remover.destroy();
*
* console.log(result.success); // true
* console.log(result.strategy); // "trash" | "permanent" | "soft"
* ```
*/
var DatabaseRemover = class {
	/** The model instance being deleted */
	model;
	/** Model constructor reference */
	ctor;
	/** Data source containing driver */
	dataSource;
	/** Database driver for executing queries */
	driver;
	/** Table/collection name */
	table;
	/** Primary key field name */
	primaryKey;
	/**
	* Create a new remover instance for a model.
	*
	* @param model - The model instance to delete
	*
	* @example
	* ```typescript
	* const user = await User.find(1);
	* const remover = new DatabaseRemover(user);
	* await remover.destroy();
	* ```
	*/
	constructor(model) {
		this.model = model;
		this.ctor = model.constructor;
		this.dataSource = this.ctor.getDataSource();
		this.driver = this.dataSource.driver;
		this.table = this.ctor.table;
		this.primaryKey = this.ctor.primaryKey;
	}
	/**
	* Destroy (delete) the model instance from the database.
	*
	* @param options - Remover options
	* @returns Result containing success status, strategy used, and metadata
	* @throws {Error} If model is new (not saved) or if deletion fails
	*/
	async destroy(options = {}) {
		const strategy = options.strategy ?? this.ctor.deleteStrategy ?? this.dataSource.defaultDeleteStrategy ?? "permanent";
		if (this.model.isNew) throw new Error(`Cannot destroy ${this.ctor.name} instance that hasn't been saved to the database.`);
		const primaryKeyValue = this.model.get(this.primaryKey);
		if (!primaryKeyValue) throw new Error(`Cannot destroy ${this.ctor.name} instance: primary key (${this.primaryKey}) is missing.`);
		if (!options.skipEvents) await this.model.emitEvent("deleting", {
			strategy,
			primaryKeyValue,
			primaryKey: this.primaryKey
		});
		let deletedCount = 0;
		let trashRecord;
		const filter = { [this.primaryKey]: primaryKeyValue };
		const context = {
			strategy,
			primaryKeyValue,
			primaryKey: this.primaryKey
		};
		switch (strategy) {
			case "trash": {
				const trashTable = this.resolveTrashTable();
				const documentData = { ...this.model.data };
				const trashData = this.prepareTrashRecord(documentData);
				trashRecord = (await this.driver.insert(trashTable, trashData)).document;
				context.trashRecord = trashRecord;
				deletedCount = await this.driver.delete(this.table, filter) > 0 ? 1 : 0;
				break;
			}
			case "permanent":
				deletedCount = await this.driver.delete(this.table, filter) > 0 ? 1 : 0;
				break;
			case "soft": {
				const deletedAtColumn = this.ctor.deletedAtColumn;
				if (deletedAtColumn === false || deletedAtColumn === void 0) throw new Error(`Cannot perform soft delete on ${this.ctor.name}: deletedAtColumn is not configured. Set a column name or use a different delete strategy.`);
				const updateOperations = { $set: { [deletedAtColumn]: /* @__PURE__ */ new Date() } };
				deletedCount = (await this.driver.update(this.table, filter, updateOperations)).modifiedCount > 0 ? 1 : 0;
				break;
			}
		}
		if (deletedCount === 0) throw new Error(`Failed to destroy ${this.ctor.name} instance: record not found.`);
		context.deletedCount = deletedCount;
		if (strategy !== "soft") this.model.isNew = true;
		if (!options.skipEvents) await this.model.emitEvent("deleted", context);
		if (!options.skipSync) this.triggerSync();
		return {
			success: true,
			deletedCount,
			strategy,
			trashRecord
		};
	}
	/**
	* Prepare the trash record by preserving all original fields and adding deletion metadata.
	*
	* Keeps all original fields intact for easy restoration and adds:
	* - `deletedAt`: Timestamp when the record was deleted
	* - `originalTable`: The table/collection the record came from (for filtering in restoreAll)
	*
	* **ID Handling:**
	* - MongoDB with `_id`: Keeps `_id` as-is (unique across database)
	* - MongoDB with auto-increment `id`: Keeps `id` as a regular field (not primary key)
	* - SQL: Keeps original `id` as a regular field (trash table uses its own auto-increment primary key)
	*
	* The trash table should use its own primary key structure:
	* - MongoDB: Uses `_id` (ObjectId) as primary key, original `id` is just a field
	* - SQL: Uses auto-increment `trashId` as primary key, original `id` is just a field
	*
	* @param documentData - The original document data
	* @returns Prepared trash record data with all original fields + deletedAt + originalTable
	* @private
	*/
	prepareTrashRecord(documentData) {
		return {
			...documentData,
			deletedAt: /* @__PURE__ */ new Date(),
			originalTable: this.table
		};
	}
	/**
	* Resolve the trash table/collection name.
	*
	* Priority:
	* 1. Model.trashTable (if set)
	* 2. Data source defaultTrashTable (e.g., "RecycleBin" for MongoDB)
	* 3. Default pattern: `{table}Trash`
	*
	* @returns The trash table/collection name
	* @private
	*/
	resolveTrashTable() {
		if (this.ctor.trashTable) return this.ctor.trashTable;
		if (this.dataSource.defaultTrashTable) return this.dataSource.defaultTrashTable;
		return `${this.table}Trash`;
	}
	/**
	* Trigger sync operations after successful deletion.
	*
	* Emits a model.deleted event that ModelSyncOperation listens to.
	* The sync is handled by registered sync operations, not directly here.
	*
	* @private
	*/
	async triggerSync() {
		await events.triggerAll(getModelDeletedEvent(this.ctor), this.model);
	}
};
//#endregion
export { DatabaseRemover };

//# sourceMappingURL=database-remover.mjs.map