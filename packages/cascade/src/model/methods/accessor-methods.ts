import { get, merge, only, set, unset } from "@mongez/reinforcements";
import { pruneEmptyParents } from "../../utils/prune-empty-parents";
import type { Model } from "../model";

/**
 * Sentinel symbol to distinguish a genuinely missing field from a field
 * whose value is `undefined`. Encapsulated here — callers use `hasField()`.
 */
const MISSING_VALUE = Symbol("missing");

export function getFieldValue(model: Model, field: string, defaultValue?: unknown): any {
  return get(model.data, field, defaultValue);
}

export function setFieldValue(model: Model, field: string, value: unknown): Model {
  const path = String(field);
  set(model.data, path, value);

  model.dirtyTracker.setAtPath(path, value);

  return model;
}

export function hasField(model: Model, field: string): boolean {
  return get(model.data, field, MISSING_VALUE as any) !== MISSING_VALUE;
}

export function incrementField(model: Model, field: string, amount?: number): Model {
  const value = getFieldValue(model, field, 0) as number;
  const incrementedValue = value + (amount ?? 1);
  return setFieldValue(model, field, incrementedValue);
}

export function decrementField(model: Model, field: string, amount?: number): Model {
  const value = getFieldValue(model, field, 0) as number;
  const decrementedValue = value - (amount ?? 1);
  return setFieldValue(model, field, decrementedValue);
}

/**
 * Remove fields from the model data.
 *
 * Unsetting the last key of a nested object also removes the parents that this
 * unset left empty (`unset("a.b")` on `{ a: { b: 1 } }` leaves `{}`, not
 * `{ a: {} }`). A parent is pruned only when this unset emptied it: an object
 * the user stored as `{}` is never touched, and arrays are never pruned.
 */
export function unsetFields(model: Model, ...fields: string[]): Model {
  const existing = fields.filter(field => hasField(model, field));

  model.data = unset(model.data, fields);

  for (const field of existing) {
    pruneEmptyParents(model.data, field);
  }

  model.dirtyTracker.unset(fields);

  return model;
}

/**
 * Identity columns that a mass-assignment payload may never carry into an
 * already-persisted model. `merge()` is the method request bodies reach
 * (`model.merge(req.body)` / `save({ merge })`), and the primary key is what
 * the UPDATE filter is built from — letting it through means a payload of
 * `{ id: "<victim-id>" }` rewrites which document the save targets. Both the
 * configured primary key and the two framework identity columns are dropped,
 * because `id` and `_id` are managed by the writer/driver either way.
 *
 * A NEW model is untouched: creating with an explicit id is a legitimate flow,
 * and the writer itself merges the driver-returned document (`_id`, defaults)
 * back onto the instance before it is marked persisted.
 */
function stripIdentityColumns(
  model: Model,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (model.isNew) return values;

  const identityColumns = new Set([model.getPrimaryKey(), "id", "_id"]);
  const blockedKeys = Object.keys(values).filter(key => identityColumns.has(key));

  if (blockedKeys.length === 0) return values;

  // Copy — the caller's object (often the request body itself) is not ours to mutate.
  const safeValues = { ...values };
  for (const key of blockedKeys) {
    delete safeValues[key];
  }

  return safeValues;
}

export function mergeFields(model: Model, values: Record<string, unknown>): Model {
  return mergeDriverFields(model, stripIdentityColumns(model, values));
}

/**
 * Merge a document the DRIVER produced (generated `_id`, `RETURNING *`, DB
 * defaults) back onto the model, identity columns included.
 *
 * Framework-internal counterpart of {@link mergeFields}: the write pipeline is
 * the one caller allowed to set identity columns on an already-persisted
 * instance, because the values come from the database rather than from a
 * request. Never route caller-supplied data through this.
 */
export function mergeDriverFields(model: Model, values: Record<string, unknown>): Model {
  model.data = merge(model.data, values) as any;
  model.dirtyTracker.mergeChanges(values);
  return model;
}

export function getOnlyFields(model: Model, fields: string[]): Record<string, unknown> {
  return only(model.data, fields);
}

export function getStringField(model: Model, key: string, defaultValue?: string): string | undefined {
  return getFieldValue(model, key, defaultValue) as string | undefined;
}

export function getNumberField(model: Model, key: string, defaultValue?: number): number | undefined {
  return getFieldValue(model, key, defaultValue) as number | undefined;
}

export function getBooleanField(model: Model, key: string, defaultValue?: boolean): boolean | undefined {
  return getFieldValue(model, key, defaultValue) as boolean | undefined;
}
