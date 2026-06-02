import { getModelDeletedEvent, getModelUpdatedEvent } from "./model-events.mjs";
import "./sync-context.mjs";
import { SyncManager } from "./sync-manager.mjs";
import events from "@mongez/events";
//#region ../../@warlock.js/cascade/src/sync/model-sync-operation.ts
/**
* Model sync operation class.
*
* Manages a single sync relationship between a source and target model.
* Subscribes to source model events and triggers sync operations when
* the source is updated or deleted.
*
* @module cascade-next/sync/model-sync-operation
*/
/**
* Manages a single model sync operation.
*
* Subscribes to source model events (updated, deleted) and triggers
* sync operations to update embedded data in target models.
*
* @example
* ```typescript
* // Created via modelSync.sync() or Model.sync()
* const operation = new ModelSyncOperation(Category, Product, "category", false);
* operation
*   .embed("embedMinimal")
*   .watchFields(["name", "slug"])
*   .unsetOnDelete();
* ```
*/
var ModelSyncOperation = class {
	/**
	* Configuration for this sync operation.
	*/
	config;
	/**
	* Active event subscriptions for cleanup.
	*/
	subscriptions = [];
	/**
	* Whether this operation is currently subscribed to events.
	*/
	isSubscribed = false;
	/**
	* Create a new model sync operation.
	*
	* @param sourceModel - Source model class that triggers sync
	* @param targetModel - Target model class that receives data
	* @param targetField - Field path in target model
	* @param isMany - Whether this syncs to an array field
	*/
	constructor(sourceModelClass, targetModelClass, targetField, isMany) {
		this.config = {
			sourceModel: sourceModelClass,
			targetModel: targetModelClass,
			targetField,
			isMany,
			embedKey: "embedData",
			identifierField: "id",
			maxSyncDepth: 3,
			watchFields: [],
			unsetOnDelete: false,
			removeOnDelete: false
		};
		this.subscribe();
	}
	/**
	* Set the embed method to call on source model.
	*
	* @param embed - getter property name (e.g., "embedData", "embedMinimal") Or Array of fields
	* @returns This operation for chaining
	*
	* @example
	* ```typescript
	* Category.sync(Product, "category").embed("embedMinimal");
	* ```
	*/
	embed(method) {
		this.config.embedKey = method;
		return this;
	}
	/**
	* Set the identifier field for array matching.
	* Required when syncing to array fields (syncMany).
	*
	* @param field - Field name used as identifier (default: "id")
	* @returns This operation for chaining
	*
	* @example
	* ```typescript
	* Tag.syncMany(Post, "tags").identifyBy("tagId");
	* ```
	*/
	identifyBy(field) {
		this.config.identifierField = field;
		return this;
	}
	/**
	* Set the maximum sync depth for chained operations.
	*
	* @param depth - Maximum depth (default: 3)
	* @returns This operation for chaining
	*
	* @example
	* ```typescript
	* Category.sync(Product, "category").maxDepth(2);
	* ```
	*/
	maxDepth(depth) {
		this.config.maxSyncDepth = depth;
		return this;
	}
	/**
	* Set which fields to watch for changes.
	* Sync only triggers when these fields change.
	*
	* @param fields - Array of field names to watch (empty = all)
	* @returns This operation for chaining
	*
	* @example
	* ```typescript
	* Category.sync(Product, "category").watchFields(["name", "slug"]);
	* ```
	*/
	watchFields(fields) {
		this.config.watchFields = fields;
		return this;
	}
	/**
	* Unset the target field when source is deleted.
	*
	* @returns This operation for chaining
	*
	* @example
	* ```typescript
	* Category.sync(Product, "category").unsetOnDelete();
	* ```
	*/
	unsetOnDelete() {
		this.config.unsetOnDelete = true;
		return this;
	}
	/**
	* Delete target documents when source is deleted.
	*
	* @returns This operation for chaining
	*
	* @example
	* ```typescript
	* User.sync(Profile, "user").removeOnDelete();
	* ```
	*/
	removeOnDelete() {
		this.config.removeOnDelete = true;
		return this;
	}
	/**
	* Subscribe to source model events.
	* Called automatically in constructor.
	*/
	subscribe() {
		if (this.isSubscribed) return;
		const sourceModel = this.config.sourceModel;
		this.subscriptions.push(events.subscribe(getModelUpdatedEvent(sourceModel), this.handleModelUpdated));
		this.subscriptions.push(events.subscribe(getModelDeletedEvent(sourceModel), this.handleModelDeleted));
		this.isSubscribed = true;
	}
	/**
	* Unsubscribe from all events and cleanup.
	* Called automatically when using modelSync.register().
	*/
	unsubscribe() {
		for (const subscription of this.subscriptions) subscription.unsubscribe?.();
		this.subscriptions.length = 0;
		this.isSubscribed = false;
	}
	/**
	* Cleanup the sync operations
	*/
	$cleanup() {
		return this.unsubscribe();
	}
	/**
	* Handle model updated event.
	* Triggers sync to update embedded data in target models.
	*/
	handleModelUpdated = async (model, changedFields) => {
		if (!this.shouldSync(changedFields)) return;
		try {
			const primaryKey = this.config.sourceModel.primaryKey || "id";
			const sourceId = model.get(primaryKey);
			if (!sourceId) return;
			const driver = this.config.sourceModel.getDataSource().driver;
			await new SyncManager(this.config.sourceModel, driver).syncUpdateWithConfig(sourceId, model, changedFields, this.buildSyncConfig());
		} catch (error) {
			console.error(`[ModelSync] Failed to sync ${this.config.sourceModel.name} -> ${this.config.targetModel.name}:`, error);
		}
	};
	/**
	* Handle model deleted event.
	* Triggers unset or remove based on configuration.
	*/
	handleModelDeleted = async (model) => {
		if (!this.config.unsetOnDelete && !this.config.removeOnDelete) return;
		try {
			const primaryKey = this.config.sourceModel.primaryKey || "id";
			const sourceId = model.get(primaryKey);
			if (!sourceId) return;
			const driver = this.config.sourceModel.getDataSource().driver;
			if (this.config.removeOnDelete) await this.removeTargetDocuments(sourceId, driver);
			else if (this.config.unsetOnDelete) await new SyncManager(this.config.sourceModel, driver).syncDeleteWithConfig(sourceId, this.buildSyncConfig());
		} catch (error) {
			console.error(`[ModelSync] Failed to handle delete for ${this.config.sourceModel.name}:`, error);
		}
	};
	/**
	* Check if sync should proceed based on watched fields.
	*/
	shouldSync(changedFields) {
		if (this.config.watchFields.length === 0) return true;
		return this.config.watchFields.some((field) => changedFields.includes(field));
	}
	/**
	* Build sync config compatible with SyncManager.
	*/
	buildSyncConfig() {
		return {
			targetField: this.config.targetField,
			isMany: this.config.isMany,
			embedKey: this.config.embedKey,
			identifierField: this.config.identifierField,
			maxSyncDepth: this.config.maxSyncDepth,
			preventCircularSync: true,
			watchFields: this.config.watchFields,
			unsetOnDelete: this.config.unsetOnDelete,
			targetModelClass: this.config.targetModel
		};
	}
	/**
	* Remove target documents that reference the deleted source.
	*/
	async removeTargetDocuments(sourceId, driver) {
		const filter = this.config.isMany ? { [`${this.config.targetField}.${this.config.identifierField}`]: sourceId } : { [`${this.config.targetField}.${this.config.identifierField}`]: sourceId };
		await driver.deleteMany(this.config.targetModel.table, filter);
	}
	/**
	* Get the current configuration (for debugging/testing).
	*/
	getConfig() {
		return { ...this.config };
	}
};
//#endregion
export { ModelSyncOperation };

//# sourceMappingURL=model-sync-operation.mjs.map