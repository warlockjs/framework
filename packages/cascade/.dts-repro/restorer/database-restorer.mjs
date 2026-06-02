//#region ../../@warlock.js/cascade/src/restorer/database-restorer.ts
/**
* Database restorer service that orchestrates model restoration.
*
* Handles the complete restoration pipeline:
* 1. Strategy detection (trash vs soft delete)
* 2. Record retrieval from trash table or soft-deleted records
* 3. ID conflict resolution
* 4. Event emission (restoring, restored)
* 5. Driver execution (insert back to original table, remove from trash/clear deletedAt)
*
* @example
* ```typescript
* const restorer = new DatabaseRestorer(User);
* const result = await restorer.restore(123);
*
* console.log(result.success); // true
* console.log(result.strategy); // "trash" | "soft"
* ```
*/
var DatabaseRestorer = class {
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
	* Create a new restorer instance for a model class.
	*
	* @param modelClass - The model class (static context)
	*
	* @example
	* ```typescript
	* const restorer = new DatabaseRestorer(User);
	* await restorer.restore(123);
	* ```
	*/
	constructor(modelClass) {
		this.ctor = modelClass;
		this.dataSource = modelClass.getDataSource();
		this.driver = this.dataSource.driver;
		this.table = modelClass.table;
		this.primaryKey = modelClass.primaryKey;
	}
	/**
	* Restore a single deleted record by its ID.
	*
	* @param id - The primary key value of the record to restore
	* @param options - Restorer options
	* @returns Result containing success status, strategy used, and restored record
	* @throws {Error} If record not found in trash or soft-deleted records
	* @throws {Error} If ID conflict and onIdConflict is "fail"
	*/
	async restore(id, options = {}) {
		const onIdConflict = options.onIdConflict ?? "assignNew";
		const skipEvents = options.skipEvents ?? false;
		const strategy = this.resolveStrategy(options.strategy);
		if (strategy === "permanent") throw new Error(`Cannot restore ${this.ctor.name} with ${this.primaryKey} ${id}: permanently deleted records cannot be restored.`);
		const recordData = await this.fetchRecordByStrategy(id, strategy);
		if (!recordData) throw new Error(`Cannot restore ${this.ctor.name} with ${this.primaryKey} ${id}: record not found in ${strategy === "trash" ? "trash table" : "soft-deleted records"}.`);
		const restoredData = { ...recordData };
		delete restoredData.deletedAt;
		delete restoredData.originalTable;
		const finalData = await this.handleIdConflict(restoredData, id, onIdConflict);
		const model = new this.ctor(finalData);
		if (!skipEvents) await model.emitEvent("restoring");
		if (strategy === "trash") {
			await this.driver.insert(this.table, finalData);
			model.isNew = false;
			await this.driver.delete(this.resolveTrashTable(), { [this.primaryKey]: id });
		} else if (strategy === "soft") {
			const deletedAtColumn = this.ctor.deletedAtColumn ?? "deletedAt";
			if (deletedAtColumn) {
				const filter = { [this.primaryKey]: id };
				const updateOperations = { $unset: { [deletedAtColumn]: 1 } };
				await this.driver.update(this.table, filter, updateOperations);
				model.isNew = false;
			}
		}
		if (!skipEvents) await model.emitEvent("restored");
		return {
			success: true,
			restoredCount: 1,
			strategy,
			restoredRecord: model
		};
	}
	/**
	* Restore all deleted records for the model's table.
	*
	* @param options - Restorer options
	* @returns Result containing success status, strategy used, and aggregate counts
	*/
	async restoreAll(options = {}) {
		const onIdConflict = options.onIdConflict ?? "assignNew";
		const skipEvents = options.skipEvents ?? false;
		const strategy = this.resolveStrategy(options.strategy);
		if (strategy === "permanent") throw new Error(`Cannot restore all ${this.ctor.name} records: permanently deleted records cannot be restored.`);
		const recordsToRestore = await this.fetchAllRecordsByStrategy(strategy);
		if (recordsToRestore.length === 0) return {
			success: true,
			restoredCount: 0,
			strategy
		};
		let restoredCount = 0;
		const conflicts = [];
		const restoredRecords = [];
		for (const recordData of recordsToRestore) {
			const id = recordData[this.primaryKey];
			try {
				const restoredData = { ...recordData };
				delete restoredData.deletedAt;
				delete restoredData.originalTable;
				if (await this.checkIdExists(id)) {
					if (onIdConflict === "fail") throw new Error(`Cannot restore ${this.ctor.name} with ${this.primaryKey} ${id}: ID already exists in target table.`);
					const finalData = await this.assignNewId(restoredData);
					conflicts.push({
						id,
						reason: `ID ${id} already exists, assigned new ID ${finalData[this.primaryKey]}`
					});
					const model = new this.ctor(finalData);
					if (!skipEvents) await model.emitEvent("restoring");
					if (strategy === "trash") {
						await this.driver.insert(this.table, finalData);
						model.isNew = false;
					} else if (strategy === "soft") {
						const deletedAtColumn = this.ctor.deletedAtColumn ?? "deletedAt";
						if (deletedAtColumn) {
							const filter = { [this.primaryKey]: id };
							const updateOperations = { $unset: { [deletedAtColumn]: 1 } };
							await this.driver.update(this.table, filter, updateOperations);
							model.isNew = false;
						}
					}
					restoredRecords.push(model);
					if (!skipEvents) await model.emitEvent("restored");
				} else {
					const model = new this.ctor(restoredData);
					if (!skipEvents) await model.emitEvent("restoring");
					if (strategy === "trash") {
						await this.driver.insert(this.table, restoredData);
						model.isNew = false;
					} else if (strategy === "soft") {
						const deletedAtColumn = this.ctor.deletedAtColumn ?? "deletedAt";
						if (deletedAtColumn) {
							const filter = { [this.primaryKey]: id };
							const updateOperations = { $unset: { [deletedAtColumn]: 1 } };
							await this.driver.update(this.table, filter, updateOperations);
							model.isNew = false;
						}
					}
					restoredRecords.push(model);
					if (!skipEvents) await model.emitEvent("restored");
				}
				if (strategy === "trash") {
					const trashTable = this.resolveTrashTable();
					const trashFilter = { [this.primaryKey]: id };
					await this.driver.delete(trashTable, trashFilter);
				}
				restoredCount++;
			} catch (error) {
				if (onIdConflict === "fail") throw error;
				conflicts.push({
					id,
					reason: error instanceof Error ? error.message : String(error)
				});
			}
		}
		return {
			success: true,
			restoredCount,
			restoredRecords,
			strategy,
			conflicts: conflicts.length > 0 ? conflicts : void 0
		};
	}
	/**
	* Resolve the delete strategy.
	*
	* Priority: options → model static → data source default → "permanent"
	*
	* @param strategyOption - Optional strategy override from options
	* @returns The resolved delete strategy
	* @private
	*/
	resolveStrategy(strategyOption) {
		return strategyOption ?? this.ctor.deleteStrategy ?? this.dataSource.defaultDeleteStrategy ?? "permanent";
	}
	/**
	* Fetch a record by ID based on the delete strategy.
	*
	* @param id - The primary key value
	* @param strategy - The delete strategy to use
	* @returns The record data, or null if not found
	* @private
	*/
	async fetchRecordByStrategy(id, strategy) {
		if (strategy === "trash") {
			const trashTable = this.resolveTrashTable();
			try {
				return await this.driver.queryBuilder(trashTable).where(this.primaryKey, id).first();
			} catch {
				return null;
			}
		} else if (strategy === "soft") {
			const deletedAtColumn = this.ctor.deletedAtColumn ?? "deletedAt";
			if (!deletedAtColumn) return null;
			try {
				return await this.driver.queryBuilder(this.table).where(this.primaryKey, id).whereNotNull(deletedAtColumn).first();
			} catch {
				return null;
			}
		}
		return null;
	}
	/**
	* Fetch all records based on the delete strategy.
	*
	* @param strategy - The delete strategy to use
	* @returns Array of record data
	* @private
	*/
	async fetchAllRecordsByStrategy(strategy) {
		if (strategy === "trash") {
			const trashTable = this.resolveTrashTable();
			try {
				return await this.driver.queryBuilder(trashTable).where("originalTable", this.table).get();
			} catch {
				return [];
			}
		} else if (strategy === "soft") {
			const deletedAtColumn = this.ctor.deletedAtColumn ?? "deletedAt";
			if (!deletedAtColumn) return [];
			try {
				return await this.driver.queryBuilder(this.table).whereNotNull(deletedAtColumn).get();
			} catch {
				return [];
			}
		}
		return [];
	}
	/**
	* Handle ID conflict by checking if ID exists and assigning new one if needed.
	*
	* @param recordData - The record data to restore
	* @param originalId - The original ID value
	* @param onIdConflict - Conflict resolution strategy
	* @returns Record data with potentially new ID
	* @private
	*/
	async handleIdConflict(recordData, originalId, onIdConflict) {
		if (await this.checkIdExists(originalId)) {
			if (onIdConflict === "fail") throw new Error(`Cannot restore ${this.ctor.name} with ${this.primaryKey} ${originalId}: ID already exists in target table.`);
			return await this.assignNewId(recordData);
		}
		return recordData;
	}
	/**
	* Check if an ID already exists in the target table.
	*
	* @param id - The ID to check
	* @returns True if ID exists, false otherwise
	* @private
	*/
	async checkIdExists(id) {
		try {
			return await this.driver.queryBuilder(this.table).where(this.primaryKey, id).exists();
		} catch {
			return false;
		}
	}
	/**
	* Assign a new ID to the record data.
	*
	* For MongoDB: Generates new ObjectId for `_id`, keeps `id` if it exists
	* For SQL: Removes `id` to let database auto-increment
	*
	* @param recordData - The record data
	* @returns Record data with new ID assigned
	* @private
	*/
	async assignNewId(recordData) {
		const isMongoDb = this.driver.name === "mongodb";
		const newData = { ...recordData };
		if (isMongoDb) {
			if (this.primaryKey === "_id") delete newData._id;
			else if (this.primaryKey === "id") delete newData.id;
		} else delete newData[this.primaryKey];
		return newData;
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
};
//#endregion
export { DatabaseRestorer };

//# sourceMappingURL=database-restorer.mjs.map