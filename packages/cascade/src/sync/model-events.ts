/**
 * Model sync event name helpers.
 *
 * Provides type-safe event names for model sync operations.
 * Avoids hardcoded string literals throughout the codebase.
 *
 * @module cascade-next/sync/model-events
 */

import events from "@mongez/events";
import type { ChildModel, Model } from "../model/model";

/**
 * Event name prefix for all model sync events.
 */
export const MODEL_EVENT_PREFIX = "model";

/**
 * Model sync event types.
 */
export const ModelSyncEventType = {
  UPDATED: "updated",
  DELETED: "deleted",
} as const;

export type ModelSyncEventTypeName = (typeof ModelSyncEventType)[keyof typeof ModelSyncEventType];

/**
 * Resolve the identity used in event names.
 *
 * Class names collide across packages (e.g. auth's `User` and an app `User`),
 * so key on the table plus the data source when available and fall back to
 * the class name only for models without a table.
 */
function getModelEventKey(modelClass: ChildModel<Model>): string {
  const table = modelClass.table;

  if (!table) {
    return modelClass.name;
  }

  const source = modelClass.dataSource;
  const sourceName = typeof source === "string" ? source : source?.name;

  return sourceName ? `${sourceName}:${table}` : table;
}

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
export function getModelUpdatedEvent(modelClass: ChildModel<Model>): string {
  return `${MODEL_EVENT_PREFIX}.${getModelEventKey(modelClass)}.${ModelSyncEventType.UPDATED}`;
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
export function getModelDeletedEvent(modelClass: ChildModel<Model>): string {
  return `${MODEL_EVENT_PREFIX}.${getModelEventKey(modelClass)}.${ModelSyncEventType.DELETED}`;
}

/**
 * Get the event name for a model by name string.
 *
 * @param modelName - The model class name
 * @param eventType - The event type
 * @returns Event name string
 *
 * @example
 * ```typescript
 * const eventName = getModelEvent("Category", "updated");
 * // Returns: "model.Category.updated"
 * ```
 */
export function getModelEvent(modelName: string, eventType: ModelSyncEventTypeName): string {
  return `${MODEL_EVENT_PREFIX}.${modelName}.${eventType}`;
}

/**
 * Legacy event name for a model: `model.<ClassName>.<event>`.
 *
 * @deprecated Use the table-keyed name from `getModelUpdatedEvent` / `getModelDeletedEvent`.
 * The class-name form is still emitted in 5.21 for compatibility and will be removed later.
 */
export function getLegacyModelEvent(
  modelClass: ChildModel<Model>,
  eventType: ModelSyncEventTypeName,
): string {
  return getModelEvent(modelClass.name, eventType);
}

/**
 * Trigger a model sync event under both names: the deprecated class-name form first,
 * then the table-keyed form. The second is skipped when both names are identical,
 * so a listener on either form fires exactly once.
 */
export async function triggerModelEvent(
  modelClass: ChildModel<Model>,
  eventType: ModelSyncEventTypeName,
  ...args: unknown[]
): Promise<void> {
  const legacy = getLegacyModelEvent(modelClass, eventType);
  const current = getModelEvent(getModelEventKey(modelClass), eventType);

  // Deprecated class-name form, kept for 5.21 compatibility.
  await events.triggerAll(legacy, ...args);

  if (current !== legacy) {
    await events.triggerAll(current, ...args);
  }
}
