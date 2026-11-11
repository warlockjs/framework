import { areEqual, clone } from "@mongez/reinforcements";
import { isPlainObject } from "@mongez/supportive-is";
import { pruneEmptyParents } from "./utils/prune-empty-parents";
import { assertSafeFieldPath, assertSafeValueKeys } from "./utils/safe-path";

function canBeFlatten(object: unknown): boolean {
  return isPlainObject(object);
}

/**
 * A fix for flatten as non-plain object is being flatten as well which it should not be
 */
function flatten(
  object: Record<string, unknown>,
  separator = ".",
  keepNestedOriginalObject = false,
  parent?: string,
  root: Record<string, unknown> = {},
) {
  if (canBeFlatten(object) === false) {
    return object;
  }
  // object = toPlainObject(object);
  for (const key of Object.keys(object)) {
    const value = object[key];
    const keyChain = parent ? parent + separator + key : key;
    if ((Array.isArray(value) && value.length === 0) || typeof value === "function") {
      root[keyChain] = value;
    } else if (canBeFlatten(value)) {
      if (keepNestedOriginalObject) {
        root[keyChain] = value;
      }
      flatten(
        value as Record<string, unknown>,
        separator,
        keepNestedOriginalObject,
        keyChain,
        root,
      );
    } else {
      root[keyChain] = value;
    }
  }
  return root;
}

/**
 * Flattened record type representing dot-notation paths mapped to their values.
 */
type FlatRecord = Record<string, unknown>;

/**
 * Represents the old and new values of a dirty column.
 */
type DirtyColumnValues = { oldValue: unknown; newValue: unknown };

/**
 * Tracks changes to model data by maintaining snapshots of initial and current state.
 *
 * The tracker stores both raw (nested) and flattened (dot-notation) versions of the data
 * to accurately detect modifications, additions, and removals at any nesting level.
 *
 * Cost model: construction copies the data once (the baseline). The current
 * snapshot starts as the baseline itself and copies a top-level field only the
 * first time a write reaches inside it, so fields nobody touched stay shared and
 * compare by reference. Writes only record the change; the flat map and the diff
 * are rebuilt once, on the next read (`getDirtyColumns()`, `hasChanges()`, ...).
 * Subclasses that read `currentFlattened`, `dirtyColumns` or `removedColumns`
 * directly call {@link refreshDirtyState} first.
 *
 * @example
 * ```typescript
 * const tracker = new DatabaseDirtyTracker({ name: "Alice", age: 30 });
 * tracker.mergeChanges({ age: 31 });
 * console.log(tracker.hasChanges()); // true
 * console.log(tracker.getDirtyColumns()); // ["age"]
 * console.log(tracker.getDirtyColumnsWithValues());
 * // { age: { oldValue: 30, newValue: 31 } }
 * ```
 */
export class DatabaseDirtyTracker {
  /**
   * The initial raw data snapshot taken at construction or last reset.
   * Used as the baseline for comparison.
   */
  protected initialRaw: Record<string, unknown>;

  /**
   * The current raw data snapshot reflecting all changes made via merge/unset.
   */
  protected currentRaw: Record<string, unknown>;

  /**
   * Flattened version of the initial data using dot-notation keys.
   * Example: { "address.city": "NYC" }
   */
  protected initialFlattened: FlatRecord;

  /**
   * Flattened version of the current data using dot-notation keys.
   */
  protected currentFlattened: FlatRecord;

  /**
   * Set of column names (dot-notation paths) that have been modified.
   */
  protected readonly dirtyColumns = new Set<string>();

  /**
   * Set of column names (dot-notation paths) that existed initially but have been removed.
   */
  protected readonly removedColumns = new Set<string>();

  /**
   * Top-level fields that were assigned or unset as a whole (`set("nested", obj)`,
   * `unset("nested")`) since the last reset. Dotted-path writes
   * (`set("nested.a", v)`) and `mergeChanges` are partial by intent and never
   * land here. See {@link getReplacedColumns}.
   */
  protected readonly replacedRoots = new Set<string>();

  /**
   * Whether `currentRaw` is the tracker's own top-level object. Until the first
   * write it IS `initialRaw` (nothing changed, so nothing to copy).
   */
  private currentIsCopy = false;

  /**
   * Top-level fields of `currentRaw` that hold the tracker's own copy. Every
   * other field is shared with `initialRaw` and must be copied before a write
   * reaches inside it. Ignored while {@link ownsAllRoots} is set.
   */
  private readonly ownedRoots = new Set<string>();

  /** Set by `replaceCurrentData()`: every field of `currentRaw` is a fresh copy. */
  private ownsAllRoots = false;

  /** A write happened since the flat map and the diff were last rebuilt. */
  private stale = false;

  public constructor(data: Record<string, unknown>) {
    this.initialRaw = this.cloneData(data);
    this.currentRaw = this.initialRaw;

    this.initialFlattened = this.flattenData(this.initialRaw);
    // Nothing can differ yet: current and initial are the same snapshot.
    this.currentFlattened = this.initialFlattened;
  }

  /**
   * Returns the list of dirty columns using dot-notation.
   *
   * A column is considered dirty if its value has changed compared to the initial snapshot.
   *
   * @returns An array of column names (dot-notation paths) that have been modified
   *
   * @example
   * ```typescript
   * tracker.mergeChanges({ name: "Bob", "address.city": "LA" });
   * tracker.getDirtyColumns(); // ["name", "address.city"]
   * ```
   */
  public getDirtyColumns(): string[] {
    this.refreshDirtyState();

    return Array.from(this.dirtyColumns);
  }

  /**
   * Removed columns collapsed to the highest path that no longer exists.
   *
   * `getRemovedColumns()` reports leaves (`"a.b.c"`). Unsetting just that leaf
   * would keep `a` and `a.b` in the stored document as empty objects whenever
   * the unset emptied them (and `unset()` prunes those parents). This returns
   * the path to actually `$unset`: the shortest prefix that is gone from the
   * current data, which is the leaf itself when its parents still hold other
   * keys.
   *
   * @returns Distinct paths to remove
   */
  public getRemovedPaths(): string[] {
    this.refreshDirtyState();

    const paths = new Set<string>();

    for (const column of this.removedColumns) {
      const segments = column.split(".");
      let container: unknown = this.currentRaw;
      let path = column;

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index] as string;

        if (
          container === null ||
          typeof container !== "object" ||
          !(segment in (container as Record<string, unknown>))
        ) {
          path = segments.slice(0, index + 1).join(".");
          break;
        }

        container = (container as Record<string, unknown>)[segment];
      }

      paths.add(path);
    }

    return Array.from(paths);
  }

  /**
   * Top-level fields whose nested object must be written as a WHOLE value.
   *
   * Per-leaf diffing cannot express "this object is now exactly this": it only
   * reports the leaves that changed or vanished, so a key removed from a nested
   * object leaves its (now empty) parents behind in the stored document. A field
   * that was assigned or unset as a whole therefore reports here, and the writer
   * sends one `$set` (or `$unset`) for it instead of per-leaf operations.
   *
   * A field is reported only when it was replaced via `set("field", value)` /
   * `unset("field")`, either its old or new value is a plain object, and the
   * value actually differs from the baseline. Dotted-path writes
   * (`set("field.a", v)`) and `mergeChanges` stay per-leaf, so partial updates
   * keep working. Scalars and arrays are already whole-value leaves in the diff.
   *
   * @returns Top-level column names to write as a whole
   */
  public getReplacedColumns(): string[] {
    const columns: string[] = [];

    for (const root of this.replacedRoots) {
      const initial = this.initialRaw[root];
      const current = this.currentRaw[root];

      if (!isPlainObject(initial) && !isPlainObject(current)) {
        continue;
      }

      if (initial === current || areEqual(initial, current)) {
        continue;
      }

      columns.push(root);
    }

    return columns;
  }

  /**
   * Determines whether there are any tracked changes.
   *
   * Returns `true` if any columns have been modified or removed since the initial snapshot.
   *
   * @returns `true` if there are changes, `false` otherwise
   *
   * @example
   * ```typescript
   * const tracker = new DatabaseDirtyTracker({ name: "Alice" });
   * tracker.hasChanges(); // false
   * tracker.mergeChanges({ name: "Bob" });
   * tracker.hasChanges(); // true
   * tracker.unset("name");
   * tracker.hasChanges(); // true (removed column counts as a change)
   * ```
   */
  public hasChanges(): boolean {
    this.refreshDirtyState();

    return (
      this.dirtyColumns.size > 0 ||
      this.removedColumns.size > 0 ||
      // A stored `{}` that was unset or replaced has no leaves, so it shows in
      // neither set above; it is still a change the writer must persist.
      this.getReplacedColumns().length > 0
    );
  }

  /**
   * Check if the given column is dirty (changed)
   */
  public isDirty(column: string): boolean {
    this.refreshDirtyState();

    return this.dirtyColumns.has(column);
  }

  /**
   * Returns the set of columns that have been removed compared to the baseline.
   *
   * A column is considered removed if it existed in the initial snapshot but has been
   * explicitly unset or deleted from the current data.
   *
   * @returns An array of column names (dot-notation paths) that have been removed
   *
   * @example
   * ```typescript
   * const tracker = new DatabaseDirtyTracker({ name: "Alice", temp: "value" });
   * tracker.unset("temp");
   * tracker.getRemovedColumns(); // ["temp"]
   * ```
   */
  public getRemovedColumns(): string[] {
    this.refreshDirtyState();

    return Array.from(this.removedColumns);
  }

  /**
   * Provides a mapping of dirty columns to their previous and current values.
   *
   * This is useful for generating audit logs, building partial update payloads,
   * or displaying change summaries to users.
   *
   * @returns A record mapping each dirty column to an object containing oldValue and newValue
   *
   * @example
   * ```typescript
   * const tracker = new DatabaseDirtyTracker({ name: "Alice", age: 30 });
   * tracker.mergeChanges({ age: 31 });
   * tracker.getDirtyColumnsWithValues();
   * // { age: { oldValue: 30, newValue: 31 } }
   * ```
   */
  public getDirtyColumnsWithValues(): Record<string, DirtyColumnValues> {
    this.refreshDirtyState();

    const result: Record<string, DirtyColumnValues> = {};

    for (const column of this.dirtyColumns) {
      const hasCurrent =
        this.currentFlattened[column] !== undefined || column in this.currentFlattened;

      result[column] = {
        oldValue: this.initialFlattened[column],
        newValue: hasCurrent ? this.currentFlattened[column] : undefined,
      };
    }

    return result;
  }

  /**
   * Replaces the current data snapshot entirely; the diff is rebuilt on the next read.
   *
   * This is useful when you want to replace all current data with a new set,
   * while keeping the initial baseline for comparison.
   *
   * @param data - The new data to set as the current snapshot
   *
   * @example
   * ```typescript
   * const tracker = new DatabaseDirtyTracker({ name: "Alice" });
   * tracker.replaceCurrentData({ name: "Bob", email: "bob@example.com" });
   * tracker.getDirtyColumns(); // ["name", "email"]
   * ```
   */
  public replaceCurrentData(data: Record<string, unknown>): void {
    this.currentRaw = this.cloneData(data);
    this.currentIsCopy = true;
    this.ownsAllRoots = true;
    this.ownedRoots.clear();
    this.stale = true;
  }

  /**
   * Merges a partial payload into the current snapshot; the diff is rebuilt on the next read.
   *
   * This performs a deep merge, preserving existing nested structures while
   * updating only the specified fields.
   *
   * @param partial - Partial data to merge into the current snapshot
   *
   * @example
   * ```typescript
   * const tracker = new DatabaseDirtyTracker({ name: "Alice", address: { city: "NYC" } });
   * tracker.mergeChanges({ address: { zip: "10001" } });
   * // Current data: { name: "Alice", address: { city: "NYC", zip: "10001" } }
   * tracker.getDirtyColumns(); // ["address.zip"]
   * ```
   */
  public mergeChanges(partial: Record<string, unknown>): void {
    // Check everything before writing anything, so a refused payload leaves
    // the snapshot untouched.
    for (const key of Object.keys(partial)) {
      if (key.includes(".")) {
        assertSafeFieldPath(key);
      }
    }

    assertSafeValueKeys(partial);

    this.beginWrite();

    for (const [key, value] of Object.entries(partial)) {
      if (isPlainObject(value) && this.hasOwnPlainObject(this.currentRaw, key)) {
        // Deep-merged in place: needs the tracker's own copy of the field.
        this.ownRoot(key);
      } else {
        // Replaced by a fresh copy of `value`.
        this.claimRoot(key);
      }
    }

    this.mergeIntoRaw(this.currentRaw, partial);
  }

  /**
   * Replaces the value at a dot-notation path (no deep merge), mirroring
   * `model.set()` so stale nested keys are detected as removed.
   *
   * @throws Error when a path segment is `__proto__`, `constructor` or
   *   `prototype`, or the value carries a `__proto__` key
   */
  public setAtPath(path: string, value: unknown): void {
    assertSafeFieldPath(path);
    assertSafeValueKeys(value, path);

    const segments = path.split(".");

    this.beginWrite();

    if (segments.length === 1) {
      this.replacedRoots.add(path);
      this.claimRoot(path);
    } else {
      this.ownRoot(segments[0] as string);
    }

    let container = this.currentRaw as Record<string, unknown>;

    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] as string;

      if (!isPlainObject(container[segment]) && !Array.isArray(container[segment])) {
        container[segment] = {};
      }

      container = container[segment] as Record<string, unknown>;
    }

    container[segments[segments.length - 1] as string] = this.cloneData(value);
  }

  /**
   * Explicitly removes one or more columns from the current data.
   *
   * Supports both single column names and arrays of column names.
   * Columns can be specified using dot-notation for nested paths.
   *
   * @param columns - A single column name or an array of column names to remove
   *
   * @example
   * ```typescript
   * tracker.unset("tempField");
   * tracker.unset(["field1", "field2", "nested.field"]);
   * tracker.getRemovedColumns(); // ["tempField", "field1", "field2", "nested.field"]
   * ```
   */
  public unset(columns: string | string[]): void {
    const targets = Array.isArray(columns) ? columns : [columns];

    for (const path of targets) {
      assertSafeFieldPath(path);
    }

    this.beginWrite();

    for (const path of targets) {
      if (!path.includes(".")) {
        this.replacedRoots.add(path);
        this.claimRoot(path);
      } else {
        this.ownRoot(path.split(".")[0] as string);
      }

      this.deleteFromRaw(path);
    }
  }

  /**
   * Resets both the initial and current snapshots to the provided data.
   *
   * If no data is provided, the current snapshot becomes the new baseline.
   * This clears all tracked changes and removed columns.
   *
   * @param data - Optional new data to use as the baseline. If omitted, uses current data.
   *
   * @example
   * ```typescript
   * const tracker = new DatabaseDirtyTracker({ name: "Alice" });
   * tracker.mergeChanges({ name: "Bob" });
   * tracker.hasChanges(); // true
   * tracker.reset(); // Make current state the new baseline
   * tracker.hasChanges(); // false
   *
   * // Or reset to entirely new data:
   * tracker.reset({ name: "Charlie", age: 25 });
   * ```
   */
  public reset(data?: Record<string, unknown>): void {
    if (data) {
      this.initialRaw = this.cloneData(data);
      this.initialFlattened = this.flattenData(this.initialRaw);
    } else if (this.currentIsCopy) {
      this.initialRaw = this.adoptCurrentAsBaseline();
      this.initialFlattened = this.flattenData(this.initialRaw);
    }
    // Otherwise nothing was written since the last snapshot: the current data
    // IS the baseline, so the baseline stays as it is.

    this.currentRaw = this.initialRaw;
    this.currentFlattened = this.initialFlattened;
    this.currentIsCopy = false;
    this.ownedRoots.clear();
    this.ownsAllRoots = false;
    this.stale = false;

    this.dirtyColumns.clear();
    this.removedColumns.clear();
    this.replacedRoots.clear();
  }

  /**
   * Rebuild the flat map and the diff if a write happened since the last
   * rebuild. Every public reader calls this first; a subclass reading
   * `currentFlattened`, `dirtyColumns` or `removedColumns` directly must too.
   */
  protected refreshDirtyState(): void {
    if (!this.stale) {
      return;
    }

    this.stale = false;
    this.currentFlattened = this.flattenData(this.currentRaw);
    this.updateDirtyState();
  }

  /**
   * The current snapshot as a new baseline. Fields the tracker wrote are copied
   * (their values may have been handed out by `getDirtyColumnsWithValues()`,
   * and a caller mutating one must not move the baseline); untouched fields are
   * already shared with the old baseline and are reused as they are.
   */
  private adoptCurrentAsBaseline(): Record<string, unknown> {
    if (this.ownsAllRoots) {
      return this.cloneData(this.currentRaw);
    }

    const baseline = Object.create(Object.getPrototypeOf(this.currentRaw)) as Record<
      string,
      unknown
    >;

    for (const key of Object.keys(this.currentRaw)) {
      const value = this.currentRaw[key];
      baseline[key] = this.ownedRoots.has(key) ? this.cloneData(value) : value;
    }

    return baseline;
  }

  /**
   * Start a write: give `currentRaw` its own top-level object the first time
   * (fields stay shared with the baseline until a write reaches inside one) and
   * mark the diff as out of date.
   */
  private beginWrite(): void {
    if (!this.currentIsCopy) {
      const copy = Object.create(Object.getPrototypeOf(this.currentRaw)) as Record<string, unknown>;

      for (const key of Object.keys(this.currentRaw)) {
        copy[key] = this.currentRaw[key];
      }

      this.currentRaw = copy;
      this.currentIsCopy = true;
      this.ownedRoots.clear();
      this.ownsAllRoots = false;
    }

    this.stale = true;
  }

  /**
   * Copy a top-level field of `currentRaw` before a write reaches inside it,
   * so the baseline (which may share it) never changes.
   */
  private ownRoot(root: string): void {
    if (this.ownsAllRoots || this.ownedRoots.has(root)) {
      return;
    }

    this.ownedRoots.add(root);

    if (Object.prototype.hasOwnProperty.call(this.currentRaw, root)) {
      this.currentRaw[root] = this.cloneData(this.currentRaw[root]);
    }
  }

  /** Record that a top-level field is about to be replaced by a fresh copy. */
  private claimRoot(root: string): void {
    if (!this.ownsAllRoots) {
      this.ownedRoots.add(root);
    }
  }

  /** Whether `container` has an OWN property `key` holding a plain object. */
  private hasOwnPlainObject(container: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(container, key) && isPlainObject(container[key]);
  }

  /**
   * Flattens the given data object.
   * Can be overridden by subclasses to change flattening behavior.
   */
  protected flattenData(data: Record<string, unknown>): FlatRecord {
    return flatten(data);
  }

  /**
   * Recomputes the dirty and removed column sets by comparing initial and current snapshots.
   *
   * Called by {@link refreshDirtyState} on the first read after a write.
   * It iterates through all keys in both flattened snapshots and determines which columns
   * have been modified or removed.
   *
   * @protected
   */
  protected updateDirtyState(): void {
    this.dirtyColumns.clear();
    this.removedColumns.clear();

    const keys = new Set([
      ...Object.keys(this.initialFlattened),
      ...Object.keys(this.currentFlattened),
    ]);

    for (const key of keys) {
      const hasCurrent = this.currentFlattened[key] !== undefined || key in this.currentFlattened;
      const hasInitial = this.initialFlattened[key] !== undefined || key in this.initialFlattened;

      if (!hasCurrent && hasInitial) {
        this.removedColumns.add(key);
      }

      const initialValue = this.initialFlattened[key];
      const currentValue = hasCurrent ? this.currentFlattened[key] : undefined;

      // Untouched fields share their values with the baseline, so the cheap
      // identity check settles most keys before the deep comparison.
      if (!Object.is(initialValue, currentValue) && !areEqual(initialValue, currentValue)) {
        this.dirtyColumns.add(key);
      }
    }
  }

  /**
   * Recursively merges source object into target object, performing a deep merge.
   *
   * Only **plain** objects are merged recursively. Everything else — arrays,
   * primitives, and class instances such as `Date` / `Map` / `Set` / `RegExp` —
   * replaces the target value. All values are cloned to prevent reference sharing.
   *
   * The plain-object guard is load-bearing, not tidiness. A bare
   * `typeof value === "object"` also matches a `Date`, and `Object.entries(date)`
   * is `[]` — so merging a `Date` over a column that already held a `Date`
   * recursed into it, copied nothing, and left the old value in the snapshot.
   * The column then never went dirty and `save()` returned
   * `{ success: true, modifiedCount: 0 }` without issuing an `UPDATE`. This is
   * the same lesson `canBeFlatten` above already encodes.
   *
   * @param target - The object to merge into
   * @param source - The object to merge from
   * @private
   */
  protected mergeIntoRaw(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(source)) {
      if (key === "__proto__") {
        // Throws, naming the key.
        assertSafeValueKeys(source);
      }

      // Only descend into the target's OWN objects: an inherited one would be
      // a prototype, and the merge would write into every object in the process.
      if (isPlainObject(value) && this.hasOwnPlainObject(target, key)) {
        this.mergeIntoRaw(target[key] as Record<string, unknown>, value as Record<string, unknown>);
        continue;
      }

      target[key] = this.cloneData(value);
    }
  }

  /**
   * Deletes a field from the current raw data using a dot-notation path.
   *
   * Supports nested paths (e.g., "address.city") and array indices (e.g., "items.0").
   * If any segment in the path doesn't exist, the operation is a no-op.
   *
   * @param path - The dot-notation path to the field to delete
   * @private
   */
  protected deleteFromRaw(path: string): void {
    assertSafeFieldPath(path);

    const segments = path.split(".");
    let container: unknown = this.currentRaw;

    for (let index = 0; index < segments.length - 1; index += 1) {
      if (container === undefined || container === null) {
        return;
      }

      const segment = segments[index] as string;
      if (segment === undefined) {
        return;
      }

      container = this.resolveSegment(container, segment);
    }

    if (container === undefined || container === null) {
      return;
    }

    const lastSegment = segments[segments.length - 1];
    if (lastSegment === undefined) {
      return;
    }
    if (Array.isArray(container)) {
      const numericIndex = Number(lastSegment);
      if (!Number.isNaN(numericIndex)) {
        container.splice(numericIndex, 1);
      }
      return;
    }

    if (typeof container === "object") {
      const existed = lastSegment in (container as Record<string, unknown>);

      delete (container as Record<string, unknown>)[lastSegment];

      // Drop parents this unset just emptied; a parent that was already `{}` is
      // left alone because nothing was removed from it.
      if (existed) {
        pruneEmptyParents(this.currentRaw, path);
      }
    }
  }

  /**
   * Resolves a single segment of a dot-notation path within a container.
   *
   * Handles both object property access and array index access.
   *
   * @param container - The object or array to access
   * @param segment - The property name or array index as a string
   * @returns The value at the specified segment, or undefined if not found
   * @private
   */
  protected resolveSegment(container: unknown, segment: string): unknown {
    if (Array.isArray(container)) {
      const numericIndex = Number(segment);
      if (Number.isNaN(numericIndex)) {
        return undefined;
      }

      return container[numericIndex];
    }

    // Own properties only: an inherited one is a prototype, never stored data.
    if (
      container &&
      typeof container === "object" &&
      Object.prototype.hasOwnProperty.call(container, segment)
    ) {
      return (container as Record<string, unknown>)[segment];
    }

    return undefined;
  }

  /**
   * Creates a deep clone of the provided data.
   *
   * @param data - The data to clone
   * @returns A deep clone of the data
   * @private
   */
  protected cloneData<T>(data: T): T {
    return clone(data);
  }
}
