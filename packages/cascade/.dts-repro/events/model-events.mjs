//#region ../../@warlock.js/cascade/src/events/model-events.ts
/**
* Light-weight async event emitter used to power model lifecycle hooks.
*
* The implementation intentionally avoids any external dependency so we can
* re-use it in drivers, writers, and other core services without pulling in
* heavier event libraries.
*/
var ModelEvents = class {
	listeners = /* @__PURE__ */ new Map();
	/**
	* Register a listener for the given event.
	* Returns an unsubscribe function for convenience.
	*/
	on(event, listener) {
		this.ensureListenerSet(event).add(listener);
		return () => this.off(event, listener);
	}
	/**
	* Register a listener that automatically unsubscribes after the first call.
	*/
	once(event, listener) {
		const wrapper = async (model, context) => {
			try {
				await listener(model, context);
			} finally {
				this.off(event, wrapper);
			}
		};
		return this.on(event, wrapper);
	}
	/**
	* Deregister a listener for the given event.
	*/
	off(event, listener) {
		const listeners = this.listeners.get(event);
		if (!listeners) return;
		listeners.delete(listener);
		if (listeners.size === 0) this.listeners.delete(event);
	}
	/**
	* Emit an event to all registered listeners.
	*/
	async emit(event, model, context) {
		const listeners = this.listeners.get(event);
		if (!listeners || listeners.size === 0) return;
		for (const listener of Array.from(listeners)) await listener(model, context);
	}
	/**
	* Emit events for fetching
	*/
	async emitFetching(query, context) {
		await this.emit("fetching", query, context);
	}
	/**
	* Remove all registered listeners.
	*/
	clear() {
		this.listeners.clear();
	}
	/**
	* Registers a listener for the "saving" event.
	*
	* Fired before a model is persisted (both insert and update), and before validation.
	* Use this hook for data enrichment and preparation (e.g., setting createdBy, updatedBy).
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onSaving(listener) {
		return this.on("saving", listener);
	}
	/**
	* Registers a listener for the "saved" event.
	*
	* Fired after a model has been successfully persisted.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onSaved(listener) {
		return this.on("saved", listener);
	}
	/**
	* Registers a listener for the "creating" event.
	*
	* Fired before a new model is inserted into the database.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onCreating(listener) {
		return this.on("creating", listener);
	}
	/**
	* Registers a listener for the "created" event.
	*
	* Fired after a new model has been successfully inserted.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onCreated(listener) {
		return this.on("created", listener);
	}
	/**
	* Registers a listener for the "updating" event.
	*
	* Fired before an existing model is updated in the database.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onUpdating(listener) {
		return this.on("updating", listener);
	}
	/**
	* Registers a listener for the "updated" event.
	*
	* Fired after an existing model has been successfully updated.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onUpdated(listener) {
		return this.on("updated", listener);
	}
	/**
	* Registers a listener for the "deleting" event.
	*
	* Fired before a model is deleted from the database.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onDeleting(listener) {
		return this.on("deleting", listener);
	}
	/**
	* Registers a listener for the "deleted" event.
	*
	* Fired after a model has been successfully deleted.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onDeleted(listener) {
		return this.on("deleted", listener);
	}
	/**
	* Registers a listener for the "validating" event.
	*
	* Fired before model validation is performed.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onValidating(listener) {
		return this.on("validating", listener);
	}
	/**
	* Registers a listener for the "validated" event.
	*
	* Fired after model validation has completed.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onValidated(listener) {
		return this.on("validated", listener);
	}
	/**
	* Registers a listener for the "fetching" event.
	*
	* Fired before a query is executed to fetch models.
	* Receives the query builder instance, allowing modification before execution.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onFetching(listener) {
		return this.on("fetching", listener);
	}
	/**
	* Registers a listener for the "hydrating" event.
	*
	* Fired after raw records are fetched but before they are hydrated into model instances.
	* Allows modification of raw data before hydration.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onHydrating(listener) {
		return this.on("hydrating", listener);
	}
	/**
	* Registers a listener for the "fetched" event.
	*
	* Fired after models have been fetched and hydrated.
	* Receives hydrated model instances and query context.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onFetched(listener) {
		return this.on("fetched", listener);
	}
	/**
	* Registers a listener for the "restoring" event.
	*
	* Fired before a soft-deleted model is restored.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onRestoring(listener) {
		return this.on("restoring", listener);
	}
	/**
	* Registers a listener for the "restored" event.
	*
	* Fired after a soft-deleted model has been successfully restored.
	*
	* @param listener - The callback to invoke
	* @returns An unsubscribe function
	*/
	onRestored(listener) {
		return this.on("restored", listener);
	}
	/**
	* Ensures a listener set exists for the given event.
	*
	* @param event - The event name
	* @returns The listener set for the event
	* @private
	*/
	ensureListenerSet(event) {
		let listeners = this.listeners.get(event);
		if (!listeners) {
			listeners = /* @__PURE__ */ new Set();
			this.listeners.set(event, listeners);
		}
		return listeners;
	}
};
/**
* Global event emitter invoked for every model instance, regardless of type.
* Useful for cross-cutting concerns like auditing or request-scoped enrichment.
*/
const globalModelEvents = new ModelEvents();
//#endregion
export { ModelEvents, globalModelEvents };

//# sourceMappingURL=model-events.mjs.map