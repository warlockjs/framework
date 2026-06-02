import { ChildModel } from "../model/model.types.mjs";
import { ModelSyncContract, ModelSyncOperationContract } from "./types.mjs";
import { Model } from "../model/model.mjs";

//#region ../../@warlock.js/cascade/src/sync/model-sync.d.ts
/**
 * ModelSync facade implementation.
 *
 * Manages sync operation registration with scoped cleanup support.
 * Uses a registration stack to track operations created during
 * a `register()` callback for proper HMR cleanup.
 *
 * @example
 * ```typescript
 * // In events file
 * export const cleanup = modelSync.register(() => {
 *   Category.sync(Product, "category");
 *   Tag.syncMany(Post, "tags").identifyBy("id");
 * });
 * ```
 */
declare class ModelSyncFacade implements ModelSyncContract {
  /**
   * All active sync operations.
   */
  private readonly operations;
  /**
   * Stack for tracking operations during register() callbacks.
   * Each element is an array of operations created in that scope.
   */
  private readonly registrationStack;
  /**
   * Create a sync operation for a single embedded document.
   *
   * When the source model is updated, the target model's field
   * will be updated with the embedded data.
   *
   * @param source - Source model class that triggers sync
   * @param target - Target model class that receives data
   * @param field - Field path in target model
   * @returns Sync operation for chaining configuration
   *
   * @example
   * ```typescript
   * // When Category updates, update Product.category
   * modelSync.sync(Category, Product, "category");
   *
   * // With configuration
   * modelSync.sync(Category, Product, "category")
   *   .embed("embedMinimal")
   *   .watchFields(["name", "slug"]);
   * ```
   */
  sync(source: ChildModel<Model>, target: ChildModel<Model>, field: string): ModelSyncOperationContract;
  /**
   * Create a sync operation for an array of embedded documents.
   *
   * When the source model is updated, the corresponding element
   * in the target model's array field will be updated.
   *
   * @param source - Source model class that triggers sync
   * @param target - Target model class that receives data
   * @param field - Array field path in target model
   * @returns Sync operation for chaining configuration
   *
   * @example
   * ```typescript
   * // When Tag updates, update Post.tags[i] where tags[i].id matches
   * modelSync.syncMany(Tag, Post, "tags").identifyBy("id");
   * ```
   */
  syncMany(source: ChildModel<Model>, target: ChildModel<Model>, field: string): ModelSyncOperationContract;
  /**
   * Register sync operations with automatic cleanup.
   *
   * Executes the callback function which should contain sync registrations.
   * Returns a cleanup function that unsubscribes all operations created
   * during the callback - perfect for HMR module cleanup.
   *
   * @param callback - Function that registers sync operations
   * @returns Cleanup function that unsubscribes all registered operations
   *
   * @example
   * ```typescript
   * // In src/app/blog/events/sync.ts
   * export const cleanup = modelSync.register(() => {
   *   Category.sync(Product, "category");
   *   Tag.syncMany(Post, "tags").identifyBy("id");
   *   Author.sync(Article, "author").unsetOnDelete();
   * });
   * ```
   */
  register(callback: () => void): () => void;
  /**
   * Clear all registered sync operations.
   * Useful for testing or complete reset.
   */
  clear(): void;
  /**
   * Get count of active sync operations.
   * Useful for debugging and testing.
   */
  get count(): number;
  /**
   * Track a new operation in global list and current registration scope.
   */
  private trackOperation;
}
/**
 * Global modelSync facade instance.
 *
 * Use this to register sync operations between models.
 *
 * @example
 * ```typescript
 * import { modelSync } from "@warlock.js/cascade";
 *
 * export const cleanup = modelSync.register(() => {
 *   Category.sync(Product, "category");
 * });
 * ```
 */
declare const modelSync: ModelSyncFacade;
//#endregion
export { modelSync };
//# sourceMappingURL=model-sync.d.mts.map