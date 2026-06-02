import { getModelUpdatedEvent } from "../sync/model-events.mjs";
import { DatabaseWriterValidationError } from "../validation/database-writer-validation-error.mjs";
import "../validation/index.mjs";
import events from "@mongez/events";
import { getSealConfig, v } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/writer/database-writer.ts
/**
* Database writer service that orchestrates model persistence.
*
* Handles the complete save pipeline:
* 1. Check for changes (skip if no changes and not new)
* 2. Emit `saving` event (for data enrichment)
* 3. Emit `validating` event
* 4. Validate and cast data via @warlock.js/seal schema
* 5. Emit `validated` event
* 6. Generate ID (for new NoSQL records)
* 7. Emit `creating`/`updating` events
* 8. Execute insert or update via driver
* 9. Merge returned data into model
* 10. Reset dirty tracker and update `isNew` flag
* 11. Emit `saved` and `created`/`updated` events
*
* @example
* ```typescript
* const user = new User({ name: "Alice", email: "alice@example.com" });
* const writer = new DatabaseWriter(user);
* await writer.save();
*
* console.log(user.get("id")); // 1 (auto-generated)
* console.log(user.get("_id")); // ObjectId("...")
*
* // Update existing record
* user.set("name", "Alice Smith");
* await writer.save();
* // Only updates the "name" field (partial update)
*
* // Silent save (no events)
* await writer.save({ skipEvents: true });
* ```
*/
var DatabaseWriter = class {
	/** The model instance being persisted */
	model;
	/** Model constructor reference */
	ctor;
	/** Data source containing driver and ID generator */
	dataSource;
	/** Database driver for executing queries */
	driver;
	/** Table/collection name */
	table;
	/** Primary key field name */
	primaryKey;
	/** Validation schema (if defined) */
	schema;
	/** Strict mode configuration */
	strictMode;
	/**
	* Create a new writer instance for a model.
	*
	* @param model - The model instance to persist
	*
	* @example
	* ```typescript
	* const user = new User({ name: "Alice" });
	* const writer = new DatabaseWriter(user);
	* await writer.save();
	* ```
	*/
	constructor(model) {
		this.model = model;
		this.ctor = model.constructor;
		this.dataSource = this.ctor.getDataSource();
		this.driver = this.dataSource.driver;
		this.table = this.ctor.table;
		this.primaryKey = this.ctor.primaryKey;
		this.schema = this.ctor.schema;
		this.strictMode = this.ctor.strictMode;
	}
	/**
	* Save the model instance to the database.
	*
	* @param options - Save options
	* @returns Result with success status, document, and metadata
	* @throws {ValidationError} If validation fails
	*/
	async save(options = {}) {
		const isInsert = this.model.isNew;
		if (!isInsert && !this.model.hasChanges()) return {
			success: true,
			document: this.model.data,
			isNew: false,
			modifiedCount: 0
		};
		if (!options.skipEvents) await this.model.emitEvent("saving", {
			isInsert,
			options,
			mode: isInsert ? "insert" : "update"
		});
		await this.validateAndCast(isInsert, options);
		let result;
		if (isInsert) result = await this.performInsert(options);
		else result = await this.performUpdate(options);
		const changedFields = isInsert ? [] : this.model.getDirtyColumns();
		this.model.dirtyTracker.reset();
		this.model.isNew = false;
		if (!options.skipEvents) {
			await this.model.emitEvent("saved");
			await this.model.emitEvent(isInsert ? "created" : "updated");
		}
		if (!options.skipSync && !isInsert) this.triggerSync(changedFields);
		return {
			success: true,
			document: this.model.data,
			isNew: isInsert,
			modifiedCount: isInsert ? void 0 : result.modifiedCount
		};
	}
	/**
	* Validate and cast model data using the schema.
	*
	* Updates the model's data in-place with validated/casted values.
	*
	* @param isInsert - Whether this is an insert operation
	* @param options - Save options
	* @throws {ValidationError} If validation fails
	* @private
	*/
	async validateAndCast(isInsert, options) {
		if (!options.skipEvents) await this.model.emitEvent("validating", {
			isInsert,
			options,
			mode: isInsert ? "insert" : "update"
		});
		if (options.skipValidation || !this.schema) return;
		const validationSchema = isInsert ? this.schema.clone() : this.schema.clone(Object.keys(this.model.data)).extend({
			id: v.scalar().optional(),
			_id: v.any().optional(),
			[this.ctor.createdAtColumn]: v.date().optional(),
			[this.ctor.updatedAtColumn]: v.date().optional()
		});
		if (this.strictMode === "strip") validationSchema.stripUnknown();
		else if (this.strictMode === "fail") validationSchema.allowUnknown(false);
		else if (this.strictMode === "allow") validationSchema.allowUnknown(true);
		const result = await v.validate(validationSchema, this.model.data, {
			context: { model: this.model },
			...getSealConfig()
		});
		if (!result.isValid) {
			console.trace(result.errors);
			const error = new DatabaseWriterValidationError(`[${this.model.constructor.name} Model] ${isInsert ? "Insert" : "Update"} Validation failed`, result.errors);
			if (!options.skipEvents) await this.model.emitEvent("validated", {
				result,
				error
			});
			throw error;
		}
		this.model.replaceData(result.data);
		if (!options.skipEvents) await this.model.emitEvent("validated", { result });
	}
	/**
	* Perform an insert operation.
	*
	* @param options - Save options
	* @returns Insert result
	* @private
	*/
	async performInsert(options) {
		await this.generateNextId();
		const dataToInsert = this.model.data;
		const createdAtColumn = this.ctor.createdAtColumn;
		if (createdAtColumn) dataToInsert[createdAtColumn] = /* @__PURE__ */ new Date();
		const updatedAtColumn = this.ctor.updatedAtColumn;
		if (updatedAtColumn) dataToInsert[updatedAtColumn] = /* @__PURE__ */ new Date();
		if (!options.skipEvents) await this.model.emitEvent("creating");
		const result = await this.driver.insert(this.table, dataToInsert);
		this.model.merge(result.document);
		this.model.dirtyTracker.reset();
		return result;
	}
	/**
	* Perform an update operation.
	*
	* @param options - Save options
	* @returns Update result
	* @private
	*/
	async performUpdate(options) {
		if (!options.skipEvents) await this.model.emitEvent("updating");
		const updatedAtColumn = this.ctor.updatedAtColumn;
		if (updatedAtColumn) this.model.set(updatedAtColumn, /* @__PURE__ */ new Date());
		if (options.replace) {
			const document = await this.driver.replace(this.table, { [this.primaryKey]: this.model.get(this.primaryKey) }, this.model.data);
			if (document) this.model.replaceData(document);
			return { modifiedCount: document ? 1 : 0 };
		}
		const operations = this.buildUpdateOperations();
		const filter = { [this.primaryKey]: this.model.get(this.primaryKey) };
		return await this.driver.update(this.table, filter, operations);
	}
	/**
	* Generate ID for the model if auto-generation is enabled.
	*
	* @private
	*/
	async generateNextId() {
		if (!this.ctor.autoGenerateId || this.model.get("id")) return;
		const idGenerator = this.dataSource.idGenerator;
		if (!idGenerator) return;
		const initialId = this.resolveInitialId();
		const incrementIdBy = this.resolveIncrementBy();
		const id = await idGenerator.generateNextId({
			table: this.table,
			initialId,
			incrementIdBy
		});
		this.model.set("id", id);
	}
	/**
	* Build update operations from the model's dirty tracker.
	*
	* Handles both modified fields ($set) and removed fields ($unset).
	*
	* @returns Update operations for the driver
	* @private
	*
	* @example
	* ```typescript
	* // Model with changes
	* user.set("name", "Alice");
	* user.unset("tempField");
	*
	* const operations = this.buildUpdateOperations();
	* // {
	* //   $set: { name: "Alice" },
	* //   $unset: { tempField: 1 }
	* // }
	* ```
	*/
	buildUpdateOperations() {
		const operations = {};
		const dirtyColumns = this.model.getDirtyColumns();
		if (dirtyColumns.length > 0) {
			operations.$set = {};
			for (const column of dirtyColumns) {
				if (this.model.get(column) === void 0) continue;
				operations.$set[column] = this.model.get(column);
			}
		}
		const removedColumns = this.model.getRemovedColumns();
		if (removedColumns.length > 0) {
			operations.$unset = {};
			for (const column of removedColumns) operations.$unset[column] = 1;
		}
		return operations;
	}
	/**
	* Resolve the initial ID from model configuration.
	*
	* Priority:
	* 1. Model.initialId (explicit value)
	* 2. Model.randomInitialId (random or function)
	* 3. Default: 1
	*
	* @returns The initial ID value
	* @private
	*/
	resolveInitialId() {
		if (this.ctor.initialId) return this.ctor.initialId;
		if (this.ctor.randomInitialId) return typeof this.ctor.randomInitialId === "function" ? this.ctor.randomInitialId() : this.randomInt(1e4, 499999);
		return 1;
	}
	/**
	* Resolve the increment value from model configuration.
	*
	* Priority:
	* 1. Model.incrementIdBy (explicit value)
	* 2. Model.randomIncrement (random or function)
	* 3. Default: 1
	*
	* @returns The increment value
	* @private
	*/
	resolveIncrementBy() {
		if (this.ctor.incrementIdBy) return this.ctor.incrementIdBy;
		if (this.ctor.randomIncrement) return typeof this.ctor.randomIncrement === "function" ? this.ctor.randomIncrement() : this.randomInt(1, 10);
		return 1;
	}
	/**
	* Generate a random integer between min and max (inclusive).
	*
	* @param min - Minimum value
	* @param max - Maximum value
	* @returns Random integer
	* @private
	*/
	randomInt(min, max) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}
	/**
	* Trigger sync operations after successful save.
	*
	* Emits a model.updated event that ModelSyncOperation listens to.
	* The sync is handled by registered sync operations, not directly here.
	*
	* @param changedFields - Fields that were changed (for filtering)
	* @private
	*/
	async triggerSync(changedFields) {
		await events.triggerAll(getModelUpdatedEvent(this.ctor), this.model, changedFields);
	}
};
//#endregion
export { DatabaseWriter };

//# sourceMappingURL=database-writer.mjs.map