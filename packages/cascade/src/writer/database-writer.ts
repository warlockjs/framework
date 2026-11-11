import { when } from "@mongez/reinforcements";
import { getSealConfig, v, type ObjectValidator } from "@warlock.js/seal";
import type {
  DriverContract,
  InsertResult,
  UpdateOperations,
  UpdateResult,
} from "../contracts/database-driver.contract";
import type {
  WriterContract,
  WriterOptions,
  WriterResult,
} from "../contracts/database-writer.contract";
import { mergeDriverFields } from "../model/methods/accessor-methods";
import { generateModelId } from "../model/generate-model-id";
import type { ChildModel, Model } from "../model/model";
import { enqueueSyncFanout } from "../sync/sync-fanout";
import { triggerModelEvent } from "../sync/model-events";
import type { StrictMode } from "../types";
import { DatabaseWriterValidationError } from "../validation";
import { afterCommit } from "../transactions/after-commit";
import type { DataSource } from "./../data-source/data-source";

/**
 * One top-level field touched by an update: written back whole (a column, or
 * a field assigned as a whole), or leaf by leaf (nested changes).
 */
type UpdateField = { whole: boolean; replaced: boolean; leaves: string[] };

/** Validation schemas a model class reuses across saves (see `validationSchemas()`). */
type CachedValidationSchemas = {
  schema: ObjectValidator;
  strictMode: StrictMode;
  createdAtColumn: unknown;
  updatedAtColumn: unknown;
  deletedAtColumn: unknown;
  systemKeys: string[];
  base: ObjectValidator;
  insert: ObjectValidator;
};

const validationSchemaCache = new WeakMap<object, CachedValidationSchemas>();

/** Marks a path that does not exist (a stored `undefined` is a value). */
const MISSING = Symbol("missing");

/** Read a dot path through own properties of plain objects. */
function getPath(value: unknown, path: string): unknown {
  let current = value;

  for (const segment of path.split(".")) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return MISSING;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Database writer service that orchestrates model persistence.
 *
 * Handles the complete save pipeline:
 * 1. Check for changes (skip if no changes and not new)
 * 2. Emit `saving` event (for data enrichment)
 * 3. Emit `validating` event
 * 4. Validate and cast data via @warlock.js/seal schema
 * 5. Emit `validated` event
 * 6. Generate ID (for new NoSQL records)
 * 7. Emit `creating`/`updating` events
 * 8. Execute insert or update via driver
 * 9. Merge returned data into model
 * 10. Reset dirty tracker and update `isNew` flag
 * 11. Emit `saved` and `created`/`updated` events
 *
 * @example
 * ```typescript
 * const user = new User({ name: "Alice", email: "alice@example.com" });
 * const writer = new DatabaseWriter(user);
 * await writer.save();
 *
 * console.log(user.get("id")); // 1 (auto-generated)
 * console.log(user.get("_id")); // ObjectId("...")
 *
 * // Update existing record
 * user.set("name", "Alice Smith");
 * await writer.save();
 * // Only updates the "name" field (partial update)
 *
 * // Silent save (no events)
 * await writer.save({ skipEvents: true });
 * ```
 */
export class DatabaseWriter implements WriterContract {
  /** The model instance being persisted */
  private readonly model: Model;

  /** Dirty columns an update validation dropped (strip mode); never written. */
  private readonly unvalidatedColumns = new Set<string>();

  /**
   * Top-level fields an update validation dropped whole (strip mode). Nothing
   * below them is set.
   */
  private readonly droppedFields = new Set<string>();

  /**
   * Dropped fields that were assigned as a whole (`set("field", {...})`): the
   * removals that assignment caused are not written either. An explicit
   * `unset("field.key")` still is, like an unset of a top-level column.
   */
  private readonly droppedReplacedFields = new Set<string>();

  /** Model constructor reference */
  private readonly ctor: ChildModel<Model>;

  /** Data source containing driver and ID generator */
  private readonly dataSource: DataSource;

  /** Database driver for executing queries */
  private readonly driver: DriverContract;

  /** Table/collection name */
  private readonly table: string;

  /** Primary key field name */
  private readonly primaryKey: string;

  /** Validation schema (if defined) */
  private readonly schema?: ObjectValidator;

  /** Strict mode configuration */
  private readonly strictMode: StrictMode;

  /**
   * Create a new writer instance for a model.
   *
   * @param model - The model instance to persist
   *
   * @example
   * ```typescript
   * const user = new User({ name: "Alice" });
   * const writer = new DatabaseWriter(user);
   * await writer.save();
   * ```
   */
  public constructor(model: Model) {
    this.model = model;
    this.ctor = model.constructor as ChildModel<Model>;
    this.dataSource = this.ctor.getDataSource();
    this.driver = this.dataSource.driver;
    this.table = this.ctor.table;
    this.primaryKey = this.ctor.primaryKey;
    this.schema = this.ctor.schema;
    this.strictMode = this.ctor.strictMode;
  }

  /**
   * Save the model instance to the database.
   *
   * @param options - Save options
   * @returns Result with success status, document, and metadata
   * @throws {ValidationError} If validation fails
   */
  public async save(options: WriterOptions = {}): Promise<WriterResult> {
    const isInsert = this.model.isNew;

    // 1. Check if model has changes (skip if no changes and not new)
    if (!isInsert && !this.model.hasChanges()) {
      return {
        success: true,
        document: this.model.data,
        isNew: false,
        modifiedCount: 0,
      };
    }

    // 2. Emit saving event (before validation for data enrichment)
    if (!options.skipEvents) {
      await this.model.emitEvent("saving", {
        isInsert,
        options,
        mode: isInsert ? "insert" : "update",
      });
    }

    // 3-4. Execute insert or update (validation happens inside each path)
    let result: InsertResult | UpdateResult;

    if (isInsert) {
      result = await this.performInsert(options);
    } else {
      await this.validateAndCast(false, options);
      result = await this.performUpdate(options);
    }

    // 5. Reset dirty tracker and update isNew flag
    const changedFields = isInsert ? [] : this.model.getDirtyColumns();

    // Snapshot the diff first: the reset below clears it, and `saved` /
    // `updated` listeners (and code after the save) still need to see it.
    const changes = isInsert ? {} : this.model.getDirtyColumnsWithValues();
    this.model.setLastSaveChanges(changes);
    this.model.dirtyTracker.reset();
    this.model.isNew = false;

    // 6. Emit post-save events
    if (!options.skipEvents) {
      const context = {
        isInsert,
        options,
        mode: isInsert ? "insert" : "update",
        changes,
        changedColumns: changedFields,
      };

      await this.model.emitEvent("saved", context);

      // A `saved` listener may save again, which replaces the model's last
      // changes; put this save's back before the next event.
      this.model.setLastSaveChanges(changes);
      await this.model.emitEvent(isInsert ? "created" : "updated", context);
      this.model.setLastSaveChanges(changes);
    }

    // 7. Trigger sync operations after COMMIT (inside a transaction they are
    // queued, so a rolled-back write never fans out). Failures are logged.
    if (!options.skipSync && !isInsert) {
      afterCommit(() => this.triggerSync(changedFields));
    }

    return {
      success: true,
      document: this.model.data,
      isNew: isInsert,
      modifiedCount: isInsert ? undefined : (result as UpdateResult).modifiedCount,
    };
  }

  /**
   * Validate and cast model data using the schema.
   *
   * Updates the model's data in-place with validated/casted values.
   *
   * @param isInsert - Whether this is an insert operation
   * @param options - Save options
   * @throws {ValidationError} If validation fails
   * @private
   */
  private async validateAndCast(isInsert: boolean, options: WriterOptions): Promise<void> {
    // Emit validating event
    if (!options.skipEvents) {
      await this.model.emitEvent("validating", {
        isInsert,
        options,
        mode: isInsert ? "insert" : "update",
      });
    }

    // Skip validation if requested or no schema defined
    if (options.skipValidation || !this.schema) {
      return;
    }

    // Clone full schema for insert, partial (dirty fields only) for updates.
    //
    // An update validates ONLY the dirty fields and merges back only those
    // keys: columns the schema does not list (migration-added, withCount, ...)
    // are never touched, so they can no longer be turned into `$unset`.
    //
    // A nested change is reported as leaf paths (`profile.role`); it is
    // validated through its top-level field, with the whole current value of
    // that field, so nested data follows the schema and `strictMode` exactly
    // like a top-level column does.
    const updateFields = isInsert ? undefined : this.collectUpdateFields();
    const dataToValidate: Record<string, unknown> = isInsert
      ? this.model.data
      : Object.fromEntries(
          Array.from(updateFields!.keys()).map((field) => [field, this.model.data[field]]),
        );

    const schemas = this.validationSchemas(this.schema);
    const validationSchema = isInsert
      ? schemas.insert
      : schemas.base.clone([...Object.keys(dataToValidate), ...schemas.systemKeys]);

    // Run validation
    const result = await v.validate(validationSchema, dataToValidate, {
      context: {
        model: this.model,
      },
      ...getSealConfig(),
    });

    if (!result.isValid) {
      const error = new DatabaseWriterValidationError(
        `[${this.model.constructor.name} Model] ${isInsert ? "Insert" : "Update"} Validation failed`,
        result.errors,
      );
      if (!options.skipEvents) {
        await this.model.emitEvent("validated", { result, error });
      }
      throw error;
    }

    // Update model data with validated/casted data
    if (isInsert) {
      this.model.replaceData(result.data);
    } else {
      const validated = result.data as Record<string, unknown>;

      for (const [column, field] of updateFields!) {
        if (!(column in validated)) {
          if (dataToValidate[column] === null && column in validationSchema.schema) {
            // An explicit null on a KNOWN column that passed validation: an
            // optional, non-nullable leaf coalesces null to "absent" in seal, so
            // it is missing from the result. It is a deliberate "clear this
            // column", not an unknown one to strip. A required column never
            // gets here: its rule rejects the null and validation throws.
            this.model.set(column, null);
          } else {
            // Dropped by strictMode "strip": never write an unvalidated field,
            // nor anything below it.
            this.unvalidatedColumns.add(column);
            this.droppedFields.add(column);

            // Assigned as a whole: the keys it lost are part of the dropped
            // value, so their removal is not written either.
            if (field.replaced) {
              this.droppedReplacedFields.add(column);
            }
          }

          continue;
        }

        if (field.whole) {
          this.model.set(column, validated[column]);
          continue;
        }

        // Partial nested change: write back only the changed leaves, so the
        // update stays partial and siblings keep their stored values.
        for (const leaf of field.leaves) {
          // Unset by the caller: its removal is written as before. An explicit
          // unset wins over a schema `.default()`, as it does for a column.
          if (getPath(this.model.data, leaf) === MISSING) {
            continue;
          }

          const value = getPath(validated[column], leaf.slice(column.length + 1));

          if (value !== MISSING) {
            this.model.set(leaf, value);
          } else {
            // Present in the data but dropped by the field's schema.
            this.unvalidatedColumns.add(leaf);
          }
        }
      }
    }

    // Emit validated event
    if (!options.skipEvents) {
      await this.model.emitEvent("validated", { result });
    }
  }

  /**
   * The model's validation schemas, built once per model class and reused by
   * every save until `schema`, `strictMode` or a system column name changes.
   *
   * The framework-managed system columns (id / _id / timestamps / soft-delete
   * deletedAt) are whitelisted so a model carrying them validates cleanly
   * instead of being stripped (strictMode "strip") or rejected ("fail"). Each
   * timestamp/soft-delete column is added only when configured (truthy). The
   * whitelist applies to BOTH insert and update: on insert a caller may supply
   * a backdated createdAt (data migrations, imports).
   *
   * `base` is never validated itself (an update clones the dirty fields from
   * it); `insert` is a copy of it that every insert validates with.
   */
  private validationSchemas(schema: ObjectValidator): CachedValidationSchemas {
    const ctor = this.ctor;
    const cached = validationSchemaCache.get(ctor);

    if (
      cached &&
      cached.schema === schema &&
      cached.strictMode === this.strictMode &&
      cached.createdAtColumn === ctor.createdAtColumn &&
      cached.updatedAtColumn === ctor.updatedAtColumn &&
      cached.deletedAtColumn === ctor.deletedAtColumn
    ) {
      return cached;
    }

    const systemColumns = {
      id: v.scalar().optional(),
      _id: v.any().optional(),
      ...when(ctor.createdAtColumn, () => ({
        [ctor.createdAtColumn as string]: v.date().optional(),
      })),
      ...when(ctor.updatedAtColumn, () => ({
        [ctor.updatedAtColumn as string]: v.date().optional(),
      })),
      ...when(ctor.deletedAtColumn, () => ({
        [ctor.deletedAtColumn as string]: v.date().optional(),
      })),
    };

    // Seal validators are immutable: each configuration call returns a new
    // validator, so the result must be kept.
    let base: ObjectValidator = schema.extend(systemColumns);

    if (this.strictMode === "strip") {
      base = base.stripUnknown();
    } else if (this.strictMode === "fail") {
      base = base.allowUnknown(false);
    } else if (this.strictMode === "allow") {
      base = base.allowUnknown(true);
    }

    const entry: CachedValidationSchemas = {
      schema,
      strictMode: this.strictMode,
      createdAtColumn: ctor.createdAtColumn,
      updatedAtColumn: ctor.updatedAtColumn,
      deletedAtColumn: ctor.deletedAtColumn,
      systemKeys: Object.keys(systemColumns),
      base,
      insert: base.clone(),
    };

    validationSchemaCache.set(ctor, entry);

    return entry;
  }

  /**
   * Group the dirty columns of an update by the top-level field they live in.
   *
   * A dirty column that is itself a key of the data (scalars, arrays, dates,
   * every SQL column) is validated and written back whole, as before. A leaf
   * path (`profile.role`, reported for nested changes) is validated through
   * its top-level field and written back leaf by leaf. A field assigned as a
   * whole (`set("profile", {...})`) is written back whole.
   */
  private collectUpdateFields(): Map<string, UpdateField> {
    const data = this.model.data as Record<string, unknown>;
    const fields = new Map<string, UpdateField>();

    const fieldOf = (column: string): UpdateField => {
      let field = fields.get(column);

      if (!field) {
        field = { whole: false, replaced: false, leaves: [] };
        fields.set(column, field);
      }

      return field;
    };

    for (const column of this.model.getDirtyColumns()) {
      if (column in data) {
        fieldOf(column).whole = true;
        continue;
      }

      const separator = column.indexOf(".");

      if (separator <= 0) {
        continue;
      }

      const root = column.slice(0, separator);

      if (root in data) {
        fieldOf(root).leaves.push(column);
      }
    }

    for (const root of this.model.dirtyTracker.getReplacedColumns()) {
      if (root in data) {
        const field = fieldOf(root);
        field.whole = true;
        field.replaced = true;
      }
    }

    return fields;
  }

  /** Whether a dirty column sits in a field the update validation dropped. */
  private isUnvalidated(column: string): boolean {
    if (this.unvalidatedColumns.has(column)) {
      return true;
    }

    const separator = column.indexOf(".");

    return separator > 0 && this.droppedFields.has(column.slice(0, separator));
  }

  /**
   * Validate, cast and id-generate a not-yet-persisted model for `upsert()`.
   *
   * Runs the insert-mode pipeline (schema, casts, strictMode, Mongo `id`) but
   * does not write; the caller sends the resulting data through the driver.
   */
  public async prepareForUpsert(): Promise<void> {
    await this.validateAndCast(true, {});
    await this.generateNextId();
  }

  /**
   * Perform an insert operation.
   *
   * @param options - Save options
   * @returns Insert result
   * @private
   */
  private async performInsert(options: WriterOptions): Promise<InsertResult> {
    const dataToInsert = await this.prepareForInsert(options);

    // INSERT: use full validated data
    let result: InsertResult;

    try {
      result = await this.driver.insert(this.table, dataToInsert);
    } catch (error) {
      throw this.mapUniqueViolation(error, true);
    }

    // Merge returned data (e.g., generated _id, timestamps)
    // Note: We use merge here because the result might not include all fields
    // (e.g., our generated 'id' field), and we don't want to lose them
    mergeDriverFields(this.model, result.document as Record<string, unknown>);

    // Reset dirty tracker immediately after merge to prevent
    // database-generated fields (like _id) from being marked as dirty
    this.model.dirtyTracker.reset();

    return result;
  }

  /**
   * Run the insert pipeline (validation, casting, id generation, timestamps,
   * `validating`/`validated`/`creating` hooks) WITHOUT writing.
   *
   * `save()` uses this for its insert path, so bulk inserts and single inserts
   * cannot drift. The caller is responsible for sending the returned document
   * to the driver.
   *
   * @param options - Save options (e.g. `skipEvents`, `skipValidation`)
   * @returns The prepared document to insert
   */
  public async prepareForInsert(options: WriterOptions = {}): Promise<Record<string, unknown>> {
    // Validate and cast data
    await this.validateAndCast(true, options);

    // Generate ID if needed (NoSQL only)
    await this.generateNextId();

    // Get data to insert (already validated and casted)
    const dataToInsert = this.model.data;

    // Add createdAt and updatedAt to the data (using resolved column names)
    // The column names are already resolved through the hierarchy:
    // Model static property > Database config > Driver defaults > undefined
    //
    // Only stamp createdAt when the caller did NOT supply one, so a backdated
    // value (e.g. data migrations / imports) is honored instead of overwritten.
    // This mirrors the upsert path's guard. updatedAt is always stamped to
    // reflect the moment the record is persisted.
    const createdAtColumn = this.ctor.createdAtColumn;

    if (createdAtColumn && dataToInsert[createdAtColumn] == null) {
      dataToInsert[createdAtColumn] = new Date();
    }

    const updatedAtColumn = this.ctor.updatedAtColumn;
    if (updatedAtColumn) {
      dataToInsert[updatedAtColumn] = new Date();
    }

    // Emit creating event
    if (!options.skipEvents) {
      await this.model.emitEvent("creating");
    }

    return dataToInsert;
  }

  /**
   * Perform an update operation.
   *
   * @param options - Save options
   * @returns Update result
   * @private
   */
  private async performUpdate(options: WriterOptions): Promise<UpdateResult> {
    // Emit updating event
    if (!options.skipEvents) {
      await this.model.emitEvent("updating");
    }

    // Update the updatedAt timestamp (using resolved column name)
    const updatedAtColumn = this.ctor.updatedAtColumn;
    if (updatedAtColumn) {
      this.model.set(updatedAtColumn, new Date());
    }

    if (options.replace) {
      const document = await this.driver.replace(
        this.table,
        this.buildPrimaryKeyFilter(),
        this.model.data,
      );

      if (document) {
        this.model.replaceData(document as Record<string, unknown>);
      }

      return { modifiedCount: document ? 1 : 0 };
    }

    // Build operations from dirty tracker
    const operations = this.buildUpdateOperations();

    // Nothing left to write once identity columns are excluded — don't hand the
    // driver an empty update document (MongoDB rejects one).
    if (Object.keys(operations).length === 0) {
      return { modifiedCount: 0 };
    }

    // Execute update with operations
    try {
      return await this.driver.update(this.table, this.buildPrimaryKeyFilter(), operations);
    } catch (error) {
      throw this.mapUniqueViolation(error, false);
    }
  }

  /**
   * Map a driver unique-constraint violation (Postgres 23505, MongoDB 11000)
   * to a field validation error, so a lost `unique` race never surfaces as a
   * 500. Any other error is returned untouched.
   */
  private mapUniqueViolation(error: unknown, isInsert: boolean): unknown {
    const err = error as
      | {
          code?: string | number;
          detail?: string;
          keyPattern?: Record<string, unknown>;
          message?: string;
        }
      | undefined;

    if (err?.code !== "23505" && err?.code !== 11000 && err?.code !== "11000") {
      return error;
    }

    let field: string | undefined;

    if (err.keyPattern) {
      field = Object.keys(err.keyPattern)[0];
    } else {
      // Postgres: "Key (email)=(x) already exists."
      field = /Key \(([^)]+)\)=/
        .exec(err.detail ?? "")?.[1]
        ?.split(",")[0]
        ?.trim();
    }

    if (!field) {
      // Mongo: "index: email_1 dup key"
      field = /index: (\S+?)_-?1\b/.exec(err.message ?? "")?.[1];
    }

    return new DatabaseWriterValidationError(
      `[${this.model.constructor.name} Model] ${isInsert ? "Insert" : "Update"} Validation failed`,
      [
        {
          type: "unique",
          error: `The ${field ?? "value"} must be unique`,
          input: field ?? "id",
        },
      ],
    );
  }

  /**
   * Build the filter that pins a write to the row this model was loaded from.
   *
   * It reads `model.trustedPrimaryKey` — the value captured when the instance
   * became persisted — NOT the current value in `model.data`. The current value
   * is reachable by mass assignment (`model.merge(req.body)`), so deriving the
   * filter from it let a request body redirect the UPDATE to another document.
   *
   * @returns Filter matching the originally loaded record
   * @private
   */
  private buildPrimaryKeyFilter(): Record<string, unknown> {
    return { [this.primaryKey]: this.model.trustedPrimaryKey };
  }

  /**
   * Generate ID for the model if auto-generation is enabled.
   *
   * @private
   */
  public async generateNextId(): Promise<void> {
    if (!this.ctor.autoGenerateId || this.model.get("id")) {
      return;
    }

    const id = await generateModelId(this.ctor);

    if (id === undefined) {
      return;
    }

    this.model.set("id", id);
  }

  /**
   * Build update operations from the model's dirty tracker.
   *
   * Handles both modified fields ($set) and removed fields ($unset).
   *
   * @returns Update operations for the driver
   * @private
   *
   * @example
   * ```typescript
   * // Model with changes
   * user.set("name", "Alice");
   * user.unset("tempField");
   *
   * const operations = this.buildUpdateOperations();
   * // {
   * //   $set: { name: "Alice" },
   * //   $unset: { tempField: 1 }
   * // }
   * ```
   */
  private buildUpdateOperations(): UpdateOperations {
    const operations: UpdateOperations = {};

    // Identity columns are never written by an update. The filter pins the row
    // by its captured primary key, so a dirty `id`/`_id` can only come from
    // mass assignment or an explicit set() — either way, rewriting the key of
    // an existing row corrupts identity (and `_id` is immutable in MongoDB).
    // Changing a primary key is a deliberate operation: use the atomic/raw APIs.
    const identityColumns = new Set([this.primaryKey, "id", "_id"]);

    // Top-level fields assigned/unset as a whole (`set("nested", obj)`,
    // `unset("nested")`) are written as ONE value. Per-leaf operations can only
    // report the leaves that changed or vanished, so a nested object replaced with
    // one that has fewer keys would keep its removed keys' empty parents in the
    // stored document. Dotted-path sets (`set("nested.a", v)`) and merges are
    // partial by intent and keep going through the per-leaf path below.
    const replacedColumns = this.model.dirtyTracker
      .getReplacedColumns()
      .filter((column) => !identityColumns.has(column) && !this.isUnvalidated(column));

    // A leaf under a whole-written field must not be sent too: MongoDB rejects
    // an update touching both `nested` and `nested.a`.
    const isUnderReplaced = (column: string): boolean =>
      replacedColumns.some((root) => column === root || column.startsWith(`${root}.`));

    // Get dirty columns (modified fields)
    const dirtyColumns = this.model
      .getDirtyColumns()
      .filter(
        (column) =>
          !identityColumns.has(column) && !this.isUnvalidated(column) && !isUnderReplaced(column),
      );

    if (dirtyColumns.length > 0) {
      operations.$set = {};
      for (const column of dirtyColumns) {
        const value = this.model.get(column);
        if (value === undefined) continue;

        operations.$set[column] = this.model.get(column);
      }
    }

    // Get removed columns, collapsed to the highest path that is actually gone so
    // a parent emptied by an unset is removed too instead of left behind as `{}`.
    const removedColumns = this.model.dirtyTracker
      .getRemovedPaths()
      .filter(
        (column) =>
          !identityColumns.has(column) &&
          !isUnderReplaced(column) &&
          !this.droppedReplacedFields.has(column.split(".")[0] as string),
      );

    if (removedColumns.length > 0) {
      operations.$unset = {};
      for (const column of removedColumns) {
        operations.$unset[column] = 1;
      }
    }

    for (const column of replacedColumns) {
      const value = this.model.get(column);

      if (value === undefined) {
        operations.$unset ??= {};
        operations.$unset[column] = 1;
        continue;
      }

      operations.$set ??= {};
      operations.$set[column] = value;
    }

    return operations;
  }

  /**
   * Trigger sync operations after successful save.
   *
   * Emits a model.updated event that ModelSyncOperation listens to.
   * The sync is handled by registered sync operations, not directly here.
   *
   * @param changedFields - Fields that were changed (for filtering)
   * @private
   */
  private triggerSync(changedFields: string[]): void {
    enqueueSyncFanout({
      sourceModel: this.ctor.name,
      operation: "update",
      execute: () => triggerModelEvent(this.ctor, "updated", this.model, changedFields),
    });
  }
}
