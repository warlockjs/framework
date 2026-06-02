import { ChildModel } from "../model/model.types.mjs";
import { ModelSyncConfig, ModelSyncOperationContract } from "./types.mjs";
import { Model } from "../model/model.mjs";

//#region ../../@warlock.js/cascade/src/sync/model-sync-operation.d.ts
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
declare class ModelSyncOperation implements ModelSyncOperationContract {
  /**
   * Configuration for this sync operation.
   */
  private readonly config;
  /**
   * Active event subscriptions for cleanup.
   */
  private readonly subscriptions;
  /**
   * Whether this operation is currently subscribed to events.
   */
  private isSubscribed;
  /**
   * Create a new model sync operation.
   *
   * @param sourceModel - Source model class that triggers sync
   * @param targetModel - Target model class that receives data
   * @param targetField - Field path in target model
   * @param isMany - Whether this syncs to an array field
   */
  constructor(sourceModelClass: ChildModel<Model>, targetModelClass: ChildModel<Model>, targetField: string, isMany: boolean);
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
  embed(method: string | string[]): this;
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
  identifyBy(field: string): this;
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
  maxDepth(depth: number): this;
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
  watchFields(fields: string[]): this;
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
  unsetOnDelete(): this;
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
  removeOnDelete(): this;
  /**
   * Subscribe to source model events.
   * Called automatically in constructor.
   */
  private subscribe;
  /**
   * Unsubscribe from all events and cleanup.
   * Called automatically when using modelSync.register().
   */
  unsubscribe(): void;
  /**
   * Cleanup the sync operations
   */
  $cleanup(): void;
  /**
   * Handle model updated event.
   * Triggers sync to update embedded data in target models.
   */
  private handleModelUpdated;
  /**
   * Handle model deleted event.
   * Triggers unset or remove based on configuration.
   */
  private handleModelDeleted;
  /**
   * Check if sync should proceed based on watched fields.
   */
  private shouldSync;
  /**
   * Build sync config compatible with SyncManager.
   */
  private buildSyncConfig;
  /**
   * Remove target documents that reference the deleted source.
   */
  private removeTargetDocuments;
  /**
   * Get the current configuration (for debugging/testing).
   */
  getConfig(): Readonly<ModelSyncConfig>;
}
//#endregion
export { ModelSyncOperation };
//# sourceMappingURL=model-sync-operation.d.mts.map