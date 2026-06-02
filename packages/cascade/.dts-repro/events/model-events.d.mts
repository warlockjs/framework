import { DeleteStrategy } from "../types.mjs";
import { ModelSchema } from "../model/model.types.mjs";
import { Model } from "../model/model.mjs";
import { QueryBuilderContract } from "../contracts/query-builder.contract.mjs";
//#region ../../@warlock.js/cascade/src/events/model-events.d.ts
type OnValidatingEventContext = {
  isInsert: boolean;
  mode: "insert" | "update";
};
type OnSavingEventContext = {
  isInsert: boolean;
  mode: "insert" | "update";
};
type OnDeletingEventContext = {
  strategy: DeleteStrategy;
  primaryKeyValue: string | number;
  primaryKey: string;
};
type OnDeletedEventContext = OnDeletingEventContext & {
  deletedCount: number;
  trashRecord?: Record<string, unknown>;
};
type OnFetchingEventContext = {
  table: string;
  modelClass: any;
};
type OnHydratingEventContext = {
  query: QueryBuilderContract;
  hydrateCallback?: (data: any, index: number) => any;
};
type OnFetchedEventContext = {
  query: QueryBuilderContract;
  rawRecords: any[];
  duration: number;
};
/**
 * Lifecycle events understood by Cascade models.
 *
 * The list mirrors the hooks in the legacy ORM so downstream code can subscribe
 * with consistent semantics.
 */
type ModelEventName = "initializing" | "fetching" | "hydrating" | "fetched" | "validating" | "validated" | "saving" | "saved" | "creating" | "created" | "updating" | "updated" | "deleting" | "deleted" | "restoring" | "restored";
/** Signature of an event listener registered against a model lifecycle hook. */
type ModelEventListener<TModel, TContext = unknown> = (model: TModel, context: TContext) => void | Promise<void>;
/**
 * Light-weight async event emitter used to power model lifecycle hooks.
 *
 * The implementation intentionally avoids any external dependency so we can
 * re-use it in drivers, writers, and other core services without pulling in
 * heavier event libraries.
 */
declare class ModelEvents<TModel> {
  readonly listeners: Map<ModelEventName, Set<ModelEventListener<TModel, unknown>>>;
  /**
   * Register a listener for the given event.
   * Returns an unsubscribe function for convenience.
   */
  on<TContext = unknown>(event: ModelEventName, listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Register a listener that automatically unsubscribes after the first call.
   */
  once<TContext = unknown>(event: ModelEventName, listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Deregister a listener for the given event.
   */
  off<TContext = unknown>(event: ModelEventName, listener: ModelEventListener<TModel, TContext>): void;
  /**
   * Emit an event to all registered listeners.
   */
  emit<TContext = unknown>(event: ModelEventName, model: TModel, context: TContext): Promise<void>;
  /**
   * Emit events for fetching
   */
  emitFetching<TContext = unknown>(query: QueryBuilderContract, context?: TContext): Promise<void>;
  /**
   * Remove all registered listeners.
   */
  clear(): void;
  /**
   * Registers a listener for the "saving" event.
   *
   * Fired before a model is persisted (both insert and update), and before validation.
   * Use this hook for data enrichment and preparation (e.g., setting createdBy, updatedBy).
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onSaving<TContext = OnSavingEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "saved" event.
   *
   * Fired after a model has been successfully persisted.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onSaved<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "creating" event.
   *
   * Fired before a new model is inserted into the database.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onCreating<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "created" event.
   *
   * Fired after a new model has been successfully inserted.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onCreated<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "updating" event.
   *
   * Fired before an existing model is updated in the database.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onUpdating<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "updated" event.
   *
   * Fired after an existing model has been successfully updated.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onUpdated<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "deleting" event.
   *
   * Fired before a model is deleted from the database.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onDeleting<TContext = OnDeletingEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "deleted" event.
   *
   * Fired after a model has been successfully deleted.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onDeleted<TContext = OnDeletedEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "validating" event.
   *
   * Fired before model validation is performed.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onValidating<TContext = OnValidatingEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "validated" event.
   *
   * Fired after model validation has completed.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onValidated<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "fetching" event.
   *
   * Fired before a query is executed to fetch models.
   * Receives the query builder instance, allowing modification before execution.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onFetching<TContext = OnFetchingEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "hydrating" event.
   *
   * Fired after raw records are fetched but before they are hydrated into model instances.
   * Allows modification of raw data before hydration.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onHydrating<TContext = OnHydratingEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "fetched" event.
   *
   * Fired after models have been fetched and hydrated.
   * Receives hydrated model instances and query context.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onFetched<TContext = OnFetchedEventContext>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "restoring" event.
   *
   * Fired before a soft-deleted model is restored.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onRestoring<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Registers a listener for the "restored" event.
   *
   * Fired after a soft-deleted model has been successfully restored.
   *
   * @param listener - The callback to invoke
   * @returns An unsubscribe function
   */
  onRestored<TContext = unknown>(listener: ModelEventListener<TModel, TContext>): () => void;
  /**
   * Ensures a listener set exists for the given event.
   *
   * @param event - The event name
   * @returns The listener set for the event
   * @private
   */
  private ensureListenerSet;
}
/**
 * Global event emitter invoked for every model instance, regardless of type.
 * Useful for cross-cutting concerns like auditing or request-scoped enrichment.
 */
declare const globalModelEvents: ModelEvents<Model<ModelSchema>>;
//#endregion
export { ModelEventListener, ModelEventName, ModelEvents, OnDeletedEventContext, globalModelEvents };
//# sourceMappingURL=model-events.d.mts.map