import { get, set } from "@mongez/reinforcements";
import { DatabaseWriter } from "../../writer/database-writer";
import type { Model } from "../model";

/**
 * Whether a subclass (or an intermediate base below `Model`) set the static
 * itself. The base `Model` initialises several statics (strictMode,
 * autoGenerateId, incrementIdBy, deletedAtColumn), so comparing to
 * `undefined` would never let data-source defaults apply.
 */
function isExplicitStatic(ModelClass: any, key: string): boolean {
  let current = ModelClass;

  // The base Model is the class whose parent is `Function.prototype`; its own
  // initialisers are framework fallbacks, not explicit choices.
  while (current && Object.getPrototypeOf(current) !== Function.prototype) {
    if (Object.prototype.hasOwnProperty.call(current, key) && current[key] !== undefined) {
      return true;
    }

    current = Object.getPrototypeOf(current);
  }

  return false;
}

export function applyDefaultsToModel(ModelClass: any, defaults: any): void {
  // Only apply defaults if model doesn't have its own value

  // ============================================================================
  // ID Generation
  // ============================================================================
  if (defaults.autoGenerateId !== undefined && !isExplicitStatic(ModelClass, "autoGenerateId")) {
    ModelClass.autoGenerateId = defaults.autoGenerateId;
  }
  if (defaults.initialId !== undefined && !isExplicitStatic(ModelClass, "initialId")) {
    ModelClass.initialId = defaults.initialId;
  }
  if (defaults.randomInitialId !== undefined && !isExplicitStatic(ModelClass, "randomInitialId")) {
    ModelClass.randomInitialId = defaults.randomInitialId;
  }
  if (defaults.incrementIdBy !== undefined && !isExplicitStatic(ModelClass, "incrementIdBy")) {
    ModelClass.incrementIdBy = defaults.incrementIdBy;
  }
  if (defaults.randomIncrement !== undefined && !isExplicitStatic(ModelClass, "randomIncrement")) {
    ModelClass.randomIncrement = defaults.randomIncrement;
  }

  // ============================================================================
  // Timestamps
  // ============================================================================
  if (defaults.createdAtColumn !== undefined && !isExplicitStatic(ModelClass, "createdAtColumn")) {
    ModelClass.createdAtColumn = defaults.createdAtColumn;
  }

  if (defaults.updatedAtColumn !== undefined && !isExplicitStatic(ModelClass, "updatedAtColumn")) {
    ModelClass.updatedAtColumn = defaults.updatedAtColumn;
  }

  // ============================================================================
  // Deletion
  // ============================================================================
  if (defaults.deleteStrategy !== undefined && !isExplicitStatic(ModelClass, "deleteStrategy")) {
    ModelClass.deleteStrategy = defaults.deleteStrategy;
  }
  if (defaults.deletedAtColumn !== undefined && !isExplicitStatic(ModelClass, "deletedAtColumn")) {
    ModelClass.deletedAtColumn = defaults.deletedAtColumn;
  }
  if (defaults.trashTable !== undefined && !isExplicitStatic(ModelClass, "trashTable")) {
    // Handle function-based trash table
    if (typeof defaults.trashTable === "function") {
      ModelClass.trashTable = defaults.trashTable(ModelClass.table);
    } else {
      ModelClass.trashTable = defaults.trashTable;
    }
  }

  // ============================================================================
  // Validation
  // ============================================================================
  if (defaults.strictMode !== undefined && !isExplicitStatic(ModelClass, "strictMode")) {
    ModelClass.strictMode = defaults.strictMode;
  }
}

export async function generateModelNextId(model: Model): Promise<number | string> {
  const writer = new DatabaseWriter(model);
  await writer.generateNextId();
  return model.id!;
}

export async function performAtomicUpdate(
  model: Model,
  operations: Record<string, unknown>,
): Promise<number> {
  return model.self().atomic({ [model.self().primaryKey]: model.trustedPrimaryKey }, operations);
}

/**
 * Apply an atomic delta to the local value without marking the field dirty.
 * The database already holds the change, so a later `save()` must not send a
 * stale `$set` for it. Other pending changes stay dirty.
 */
function applyLocalDelta(model: Model, field: string, delta: number): void {
  const tracker = model.dirtyTracker;
  const fieldWasDirty = tracker.isDirty(field);
  const value = (get(model.data, field, 0) as number) + delta;

  set(model.data, field, value);

  // A removed column can't be replayed after a baseline reset, so fall back to
  // plain dirty tracking for that rare case.
  if (fieldWasDirty || tracker.getRemovedColumns().length > 0) {
    tracker.setAtPath(field, value);
    return;
  }

  const pending = tracker.getDirtyColumnsWithValues();
  const baseline = structuredClone(model.data) as Record<string, unknown>;

  for (const [column, values] of Object.entries(pending)) {
    set(baseline, column, values.oldValue);
  }

  tracker.reset(baseline);

  for (const [column, values] of Object.entries(pending)) {
    tracker.setAtPath(column, values.newValue);
  }
}

export async function performAtomicIncrement<T extends string>(
  model: Model,
  field: T,
  amount = 1,
): Promise<number> {
  const result = await performAtomicUpdate(model, { $inc: { [field]: amount } });
  applyLocalDelta(model, field, amount);
  return result;
}

export async function performAtomicDecrement<T extends string>(
  model: Model,
  field: T,
  amount = 1,
): Promise<number> {
  const result = await performAtomicUpdate(model, { $inc: { [field]: -amount } });
  applyLocalDelta(model, field, -amount);
  return result;
}
