/**
 * Flattened record type representing dot-notation paths mapped to their values.
 */
type FlatRecord = Record<string, unknown>;
/**
 * Represents the old and new values of a dirty column.
 */
type DirtyColumnValues = {
    oldValue: unknown;
    newValue: unknown;
};
/**
 * Tracks changes to model data by maintaining snapshots of initial and current state.
 *
 * The tracker stores both raw (nested) and flattened (dot-notation) versions of the data
 * to accurately detect modifications, additions, and removals at any nesting level.
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
export declare class DatabaseDirtyTracker {
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
    protected readonly dirtyColumns: Set<string>;
    /**
     * Set of column names (dot-notation paths) that existed initially but have been removed.
     */
    protected readonly removedColumns: Set<string>;
    constructor(data: Record<string, unknown>);
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
    getDirtyColumns(): string[];
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
    hasChanges(): boolean;
    /**
     * Check if the given column is dirty (changed)
     */
    isDirty(column: string): boolean;
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
    getRemovedColumns(): string[];
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
    getDirtyColumnsWithValues(): Record<string, DirtyColumnValues>;
    /**
     * Replaces the current data snapshot entirely and recomputes the diff.
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
    replaceCurrentData(data: Record<string, unknown>): void;
    /**
     * Merges a partial payload into the current snapshot and recomputes the diff.
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
    mergeChanges(partial: Record<string, unknown>): void;
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
    unset(columns: string | string[]): void;
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
    reset(data?: Record<string, unknown>): void;
    /**
     * Flattens the given data object.
     * Can be overridden by subclasses to change flattening behavior.
     */
    protected flattenData(data: Record<string, unknown>): FlatRecord;
    /**
     * Recomputes the dirty and removed column sets by comparing initial and current snapshots.
     *
     * This method is called internally after any operation that modifies the current data.
     * It iterates through all keys in both flattened snapshots and determines which columns
     * have been modified or removed.
     *
     * @protected
     */
    protected updateDirtyState(): void;
    /**
     * Recursively merges source object into target object, performing a deep merge.
     *
     * For nested objects, the merge is recursive. For arrays and primitives, the source
     * value replaces the target value. All values are cloned to prevent reference sharing.
     *
     * @param target - The object to merge into
     * @param source - The object to merge from
     * @private
     */
    protected mergeIntoRaw(target: Record<string, unknown>, source: Record<string, unknown>): void;
    /**
     * Deletes a field from the current raw data using a dot-notation path.
     *
     * Supports nested paths (e.g., "address.city") and array indices (e.g., "items.0").
     * If any segment in the path doesn't exist, the operation is a no-op.
     *
     * @param path - The dot-notation path to the field to delete
     * @private
     */
    protected deleteFromRaw(path: string): void;
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
    protected resolveSegment(container: unknown, segment: string): unknown;
    /**
     * Creates a deep clone of the provided data.
     *
     * @param data - The data to clone
     * @returns A deep clone of the data
     * @private
     */
    protected cloneData<T>(data: T): T;
}
export {};
//# sourceMappingURL=database-dirty-tracker.d.ts.map