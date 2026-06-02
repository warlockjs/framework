//#region ../../@warlock.js/cascade/src/sync/model-events.ts
/**
* Event name prefix for all model sync events.
*/
const MODEL_EVENT_PREFIX = "model";
/**
* Model sync event types.
*/
const ModelSyncEventType = {
	UPDATED: "updated",
	DELETED: "deleted"
};
/**
* Get the event name for a model update.
*
* @param modelClass - The model class
* @returns Event name string (e.g., "model.Category.updated")
*
* @example
* ```typescript
* const eventName = getModelUpdatedEvent(Category);
* // Returns: "model.Category.updated"
* ```
*/
function getModelUpdatedEvent(modelClass) {
	return `${MODEL_EVENT_PREFIX}.${modelClass.name}.${ModelSyncEventType.UPDATED}`;
}
/**
* Get the event name for a model deletion.
*
* @param modelClass - The model class
* @returns Event name string (e.g., "model.Category.deleted")
*
* @example
* ```typescript
* const eventName = getModelDeletedEvent(Category);
* // Returns: "model.Category.deleted"
* ```
*/
function getModelDeletedEvent(modelClass) {
	return `${MODEL_EVENT_PREFIX}.${modelClass.name}.${ModelSyncEventType.DELETED}`;
}
//#endregion
export { getModelDeletedEvent, getModelUpdatedEvent };

//# sourceMappingURL=model-events.mjs.map