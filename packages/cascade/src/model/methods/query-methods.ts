import type {
  AtomicUpdate,
  AtomicUpdateOptions,
  DriverAtomicUpdateOptions,
  DriverContract,
  DriverIdOnInsert,
  FindOneAndUpdateOptions,
  PaginationOptions,
  PaginationResult,
  QueryBuilderContract,
} from "../../contracts";
import type { DataSource } from "../../data-source/data-source";
import { dataSourceRegistry } from "../../data-source/data-source-registry";
import { sanitizeFilter } from "../../utils/sanitize-filter";
import { generateModelId } from "../generate-model-id";
import type { ChildModel, GlobalScopeDefinition, Model } from "../model";
import { emitStaticEvent, hasStaticEventListeners } from "./static-event-methods";
import { warnUndeclaredSensitiveFields } from "./serialization-methods";

export function buildQuery<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  BaseModel: typeof Model,
): QueryBuilderContract<TModel> {
  const queryBuilder = ModelClass.newQueryBuilder<TModel>();

  // Collect global scopes from base Model and child model
  const allGlobalScopes = new Map<string, GlobalScopeDefinition>([
    ...BaseModel.globalScopes,
    ...ModelClass.globalScopes,
  ]);

  queryBuilder.pendingGlobalScopes = allGlobalScopes;
  queryBuilder.availableLocalScopes = ModelClass.localScopes;
  queryBuilder.disabledGlobalScopes = new Set();
  queryBuilder.relationDefinitions = ModelClass.relations;
  queryBuilder.modelClass = ModelClass;

  let fetchStartedAt = Date.now();

  // Emitted from the builder's execute path (awaited), not at construction, so
  // listener changes apply before the query runs and a throwing listener fails
  // the query instead of becoming an unhandled rejection.
  queryBuilder.onFetching(async () => {
    fetchStartedAt = Date.now();

    await emitStaticEvent(ModelClass, "fetching", queryBuilder, {
      table: ModelClass.table,
      modelClass: ModelClass,
    });
  });

  queryBuilder.onHydrating(async (records: any[], context: any) => {
    await emitStaticEvent(ModelClass, "hydrating", records as any, {
      query: queryBuilder,
      hydrateCallback: context?.hydrateCallback,
    });
  });

  // The builder passes the driver it resolved once for the whole result set.
  queryBuilder.hydrate((data: any, _index: number, driver?: DriverContract) => {
    return ModelClass.hydrate(data, driver);
  });

  // Eager-loading runs inside the driver's `get()` so it works for any
  // builder construction path (Model.query, Model.newQueryBuilder, custom
  // subclassed builders). This hook only handles the model-level `fetched`
  // event emission.
  queryBuilder.onFetched(async (models: any[], context: any) => {
    await emitStaticEvent(ModelClass, "fetched", models as any, {
      query: queryBuilder,
      rawRecords: context?.rawRecords ?? [],
      duration: context?.duration ?? Date.now() - fetchStartedAt,
    });
  });

  return queryBuilder;
}

export function buildNewQueryBuilder<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
): QueryBuilderContract<TModel> {
  const dataSource = ModelClass.getDataSource();

  if (ModelClass.builder) {
    const BuilderClass = ModelClass.builder;
    return new BuilderClass(ModelClass.table, dataSource) as QueryBuilderContract<TModel>;
  }

  const queryBuilder = dataSource.driver.queryBuilder<TModel>(ModelClass.table);
  return queryBuilder;
}

export async function findFirst<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter?: Record<string, unknown>,
): Promise<TModel | null> {
  const query = ModelClass.query();
  if (filter) {
    query.where(filter);
  }
  return query.first();
}

export async function findLast<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter?: Record<string, unknown>,
): Promise<TModel | null> {
  const query = ModelClass.query();
  if (filter) {
    query.where(filter);
  }

  return query.last();
}

export async function findAll<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter?: Record<string, unknown>,
): Promise<TModel[]> {
  const query = ModelClass.query();
  if (filter) {
    query.where(filter);
  }
  return query.get();
}

export function countRecords<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter?: Record<string, unknown>,
): Promise<number> {
  const query = ModelClass.query();
  if (filter) {
    query.where(filter);
  }
  return query.count();
}

export async function findById<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  id: string | number,
): Promise<TModel | null> {
  const query = ModelClass.query();
  return query.where(ModelClass.primaryKey, id).first();
}

export async function paginateRecords<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  options: PaginationOptions & { filter?: Record<string, unknown> } = {},
): Promise<PaginationResult<TModel>> {
  const query = ModelClass.query();
  if (options.filter) {
    query.where(options.filter);
  }

  return query.paginate({
    limit: options.limit,
    page: options.page,
    maxLimit: options.maxLimit,
  });
}

export async function findLatest<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter?: Record<string, unknown>,
): Promise<TModel[]> {
  const query = ModelClass.query();
  if (filter) {
    query.where(filter);
  }
  return (await query.latest()) as unknown as TModel[];
}

export function increaseField<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  field: string,
  amount: number,
): Promise<number> {
  const query = ModelClass.query().where(filter);
  return query.increment(field, amount);
}

export function decreaseField<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  field: string,
  amount: number,
): Promise<number> {
  const query = ModelClass.query().where(filter);
  return query.decrement(field, amount);
}

// The atomic/find-and-modify statics below forward their filter straight to
// the driver — they never pass through where(), so they must run the same
// operator-injection check themselves. Only the FILTER is sanitized; update
// operators ($set/$inc/…) are the point of these APIs and stay untouched.
//
// `trustedFilter` is the explicit, code-authored opt-out: it lets a conditional
// filter such as `{ used: { $lt: 10 } }` through. It is stripped before the
// options reach the driver.
function resolveFilter(
  filter: Record<string, unknown>,
  options: AtomicUpdateOptions | undefined,
): Record<string, unknown> {
  return options?.trustedFilter ? filter : sanitizeFilter(filter);
}

function toDriverOptions<TOptions extends AtomicUpdateOptions>(
  options: TOptions | undefined,
): Omit<TOptions, "trustedFilter"> | undefined {
  if (!options) {
    return undefined;
  }

  const { trustedFilter: _trustedFilter, ...rest } = options;

  return rest;
}

function applyWriteFilter<TModel extends Model>(
  query: QueryBuilderContract<TModel>,
  filter: Record<string, unknown>,
  trustedFilter: boolean,
): QueryBuilderContract<TModel> {
  // Query builders supplied by integrations predating `whereTrusted` can
  // still apply a code-authored filter through their regular `where` method.
  // Concrete Cascade builders implement `whereTrusted`, which is required for
  // MongoDB operator filters; retain the fallback for compatible custom
  // builders and test doubles.
  if (trustedFilter && typeof query.whereTrusted === "function") {
    return query.whereTrusted(filter);
  }

  return query.where(filter);
}

/**
 * The id a MongoDB upsert gives to a document it inserts, or `undefined` when
 * none applies. The driver generates it only after an insert, in a second write
 * keyed on `_id`, so an upsert that updates an existing document spends no id.
 */
function idOnInsertFor<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  operations: AtomicUpdate,
  options: AtomicUpdateOptions | undefined,
): DriverIdOnInsert | undefined {
  if (
    !options?.upsert ||
    !ModelClass.autoGenerateId ||
    ModelClass.getDriver().name !== "mongodb" ||
    Array.isArray(operations)
  ) {
    return undefined;
  }

  const filterId = filter.id;
  const filterConstrainsId =
    Object.hasOwn(filter, "id") &&
    (filterId === null ||
      typeof filterId !== "object" ||
      (!Array.isArray(filterId) && Object.hasOwn(filterId, "$eq")));
  const updateSuppliesId =
    Object.hasOwn(operations.$set ?? {}, "id") ||
    Object.hasOwn(operations.$setOnInsert ?? {}, "id");

  if (filterConstrainsId || updateSuppliesId) {
    return undefined;
  }

  return { field: "id", generate: () => generateModelId(ModelClass) };
}

/** Driver options for an atomic write: the public options plus the insert-time id. */
function driverWriteOptions<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  operations: AtomicUpdate,
  options: AtomicUpdateOptions | undefined,
): DriverAtomicUpdateOptions | undefined {
  const driverOptions = toDriverOptions(options);
  const idOnInsert = idOnInsertFor(ModelClass, filter, operations, options);

  return idOnInsert ? { ...driverOptions, idOnInsert } : driverOptions;
}

/**
 * Whether the model class (or an ancestor, or the base `Model`) has a global
 * scope registered.
 */
export function hasGlobalScopes(ModelClass: ChildModel<any>): boolean {
  let current: unknown = ModelClass;

  while (current && current !== Function.prototype) {
    const scopes = Object.prototype.hasOwnProperty.call(current, "globalScopes")
      ? (current as { globalScopes?: Map<string, unknown> }).globalScopes
      : undefined;

    if (scopes && scopes.size > 0) {
      return true;
    }

    current = Object.getPrototypeOf(current);
  }

  return false;
}

/**
 * Whether resolving the target rows through the model's query can be skipped
 * for a write: the query is the framework's own, no global scope narrows the
 * rows, and no `fetching` / `hydrating` / `fetched` listener would have
 * observed (or changed) that query.
 */
function writeNeedsNoScopeLookup(ModelClass: ChildModel<any>): boolean {
  return (
    usesBaseQuery(ModelClass) &&
    !hasGlobalScopes(ModelClass) &&
    !hasStaticEventListeners(ModelClass, ["fetching", "hydrating", "fetched"])
  );
}

/**
 * Whether `ModelClass.query()` is the framework's own: no custom builder class
 * and no override of `query()` / `newQueryBuilder()` that could narrow rows.
 */
function usesBaseQuery(ModelClass: ChildModel<any>): boolean {
  let root: unknown = ModelClass;

  while (typeof root === "function" && Object.getPrototypeOf(root) !== Function.prototype) {
    root = Object.getPrototypeOf(root);
  }

  if (typeof root !== "function" || root === ModelClass) {
    return false;
  }

  const base = root as unknown as ChildModel<any>;

  return (
    !ModelClass.builder &&
    ModelClass.query === base.query &&
    ModelClass.newQueryBuilder === base.newQueryBuilder
  );
}

/**
 * Pin a driver-level write to the rows the model's global scopes (tenant, soft
 * delete) allow. The driver write APIs take a raw filter and never see scopes,
 * so the target ids are resolved through the scoped query builder and added to
 * the filter. `null` means no visible row matches: the write must be a no-op.
 *
 * A model with no global scope (and no fetch listener) has nothing to pin: the
 * filter goes to the driver as it is, without the extra id lookup.
 */
export async function scopeWriteFilter(
  ModelClass: ChildModel<any>,
  filter: Record<string, unknown>,
  single: boolean,
  trustedFilter = false,
): Promise<Record<string, unknown> | null> {
  if (writeNeedsNoScopeLookup(ModelClass)) {
    return filter;
  }

  return await resolveScopedWriteFilter(ModelClass, filter, single, trustedFilter);
}

/** {@link scopeWriteFilter} without the no-scope shortcut. */
async function resolveScopedWriteFilter(
  ModelClass: ChildModel<any>,
  filter: Record<string, unknown>,
  single: boolean,
  trustedFilter: boolean,
): Promise<Record<string, unknown> | null> {
  const primaryKey = ModelClass.primaryKey;
  const query = ModelClass.query();
  const ids = await applyWriteFilter(query, filter, trustedFilter).pluck(primaryKey);

  if (ids.length === 0) {
    return null;
  }

  return { ...filter, [primaryKey]: single ? ids[0] : { $in: ids } };
}

/**
 * Scoped filter for a write that may insert (`upsert`). With no visible match
 * the driver would insert or, worse, update a row a scope hides (another
 * tenant's, a soft-deleted one), so a hidden match is refused.
 */
export async function scopeUpsertFilter(
  ModelClass: ChildModel<any>,
  filter: Record<string, unknown>,
  trustedFilter = false,
): Promise<Record<string, unknown>> {
  // No scope, listener or custom query: no row can be hidden, so the filter
  // reaches the driver as it is (an operator filter, a concurrent insert).
  if (writeNeedsNoScopeLookup(ModelClass)) {
    return filter;
  }

  // Always resolved: an upsert pinned to one visible row updates that row only.
  const scoped = await resolveScopedWriteFilter(ModelClass, filter, true, trustedFilter);

  if (scoped) {
    return scoped;
  }

  const query = ModelClass.query().withoutGlobalScopes();
  const hidden = await applyWriteFilter(query, filter, trustedFilter).exists();

  if (hidden) {
    throw new Error(
      `${ModelClass.name}: upsert matches a row hidden by a global scope (tenant or soft delete); refusing to touch it.`,
    );
  }

  return filter;
}

/**
 * Run an atomic update and return the number of documents modified plus the
 * number inserted by an `upsert`.
 */
export async function performAtomic<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  operations: AtomicUpdate,
  options?: AtomicUpdateOptions,
): Promise<number> {
  const resolved = resolveFilter(filter, options);

  if (!options?.upsert && !writeNeedsNoScopeLookup(ModelClass)) {
    const modified = await scopedAtomicWrite(ModelClass, resolved, operations, options);

    if (modified !== undefined) {
      return modified;
    }
  }

  const scoped = options?.upsert
    ? await scopeUpsertFilter(ModelClass, resolved, options?.trustedFilter)
    : await scopeWriteFilter(ModelClass, resolved, false, options?.trustedFilter);

  if (!scoped) {
    return 0;
  }

  const result = await ModelClass.getDriver().atomic(
    ModelClass.table,
    scoped,
    operations,
    driverWriteOptions(ModelClass, scoped, operations, options),
  );

  return result.modifiedCount + (result.upsertedCount ?? 0);
}

/**
 * Run an atomic write on a model with global scopes as one statement: the
 * scoped query builder applies the filter and the scopes together, so no ids
 * are resolved first. Returns `undefined` when the builder cannot do that (a
 * builder without `atomic()`, or a `fetching` / `hydrating` / `fetched`
 * listener that would have observed the lookup): the caller then resolves the
 * ids and writes to them.
 */
async function scopedAtomicWrite<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  operations: AtomicUpdate,
  options: AtomicUpdateOptions | undefined,
): Promise<number | undefined> {
  if (hasStaticEventListeners(ModelClass, ["fetching", "hydrating", "fetched"])) {
    return undefined;
  }

  const query = ModelClass.query();

  if (typeof query.atomic !== "function") {
    return undefined;
  }

  const scoped = applyWriteFilter(query, filter, options?.trustedFilter ?? false);

  return await scoped.atomic!(operations, { arrayFilters: options?.arrayFilters });
}

/**
 * Update a row by id through the model writer: the row is loaded (scopes
 * apply), merged, and saved, so the schema, strictMode, casting, `updatedAt`
 * and events all apply. Returns 1 when a row was saved, 0 when none is visible.
 */
export async function updateById<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  id: string | number,
  data: Record<string, unknown>,
): Promise<number> {
  const model = await ModelClass.query().where(ModelClass.primaryKey, id).first();

  if (!model) {
    return 0;
  }

  model.merge(data);
  await model.save();

  return 1;
}

export async function findAndUpdateRecords<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  update: AtomicUpdate,
  options?: AtomicUpdateOptions,
): Promise<TModel[]> {
  const primaryKey = ModelClass.primaryKey;
  const safeFilter = resolveFilter(filter, options);

  // Capture the matching ids first: the update usually changes the very field
  // the filter matches on, so re-querying with the filter would find nothing.
  const query = ModelClass.query();
  const ids = await applyWriteFilter(query, safeFilter, options?.trustedFilter ?? false).pluck(
    primaryKey,
  );

  if (ids.length === 0) {
    if (!options?.upsert) {
      return [];
    }

    await performAtomic(ModelClass, safeFilter, update, { ...options, trustedFilter: true });
    return await ModelClass.query().where(safeFilter).get();
  }

  // The rows exist, so the write is a plain update of every one of them: an
  // upsert pinned to a single visible row would update only the first match.
  // The ids already came from the scoped query: write to exactly those rows
  // without resolving them a second time.
  const { upsert: _upsert, ...updateOptions } = options ?? {};

  await ModelClass.getDriver().atomic(
    ModelClass.table,
    { [primaryKey]: { $in: ids } },
    update,
    toDriverOptions(updateOptions),
  );

  return await ModelClass.query().whereIn(primaryKey, ids).get();
}

export async function findOneAndUpdateRecord<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  update: AtomicUpdate,
  options?: FindOneAndUpdateOptions,
): Promise<TModel | null> {
  const resolved = resolveFilter(filter, options);
  const scoped = options?.upsert
    ? await scopeUpsertFilter(ModelClass, resolved, options?.trustedFilter)
    : await scopeWriteFilter(ModelClass, resolved, true, options?.trustedFilter);

  if (!scoped) return null;

  const result = await ModelClass.getDriver().findOneAndUpdate(
    ModelClass.table,
    scoped,
    update,
    driverWriteOptions(ModelClass, scoped, update, options),
  );
  if (!result) return null;
  return ModelClass.hydrate(result as Record<string, unknown>) as TModel;
}

export async function findAndReplaceRecord<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  document: Record<string, unknown>,
): Promise<TModel | null> {
  const scoped = await scopeWriteFilter(ModelClass, sanitizeFilter(filter), true);

  if (!scoped) return null;

  const result = await ModelClass.getDriver().replace(ModelClass.table, scoped, document);
  if (!result) return null;
  return ModelClass.hydrate(result as Record<string, unknown>) as TModel;
}

export async function findOneAndDeleteRecord<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<TModel | null> {
  const scoped = await scopeWriteFilter(ModelClass, sanitizeFilter(filter), true);

  if (!scoped) {
    return null;
  }

  const result = await ModelClass.getDriver().findOneAndDelete(ModelClass.table, scoped, options);

  if (!result) {
    return null;
  }

  const model = ModelClass.hydrate(result as Record<string, unknown>);
  model.dirtyTracker.reset();
  return model;
}

export function resolveDataSource<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
): DataSource {
  const ref = ModelClass.dataSource;
  let dataSource: DataSource;

  if (typeof ref === "string") {
    dataSource = dataSourceRegistry.get(ref);
  } else if (ref) {
    dataSource = ref;
  } else {
    dataSource = dataSourceRegistry.get();
  }

  if (!ModelClass.hasOwnProperty("_defaultsApplied")) {
    const driverDefaults = dataSource.driver.modelDefaults || {};
    const dataSourceDefaults = dataSource.modelDefaults || {};

    const mergedDefaults = {
      ...driverDefaults,
      ...dataSourceDefaults,
    };

    if (Object.keys(mergedDefaults).length > 0) {
      (ModelClass as any).applyModelDefaults(mergedDefaults);
    }

    (ModelClass as any)._defaultsApplied = true;
  }

  // First data-source resolution is the earliest per-class hook every model
  // passes through — warn here (once) if the schema carries credential-shaped
  // fields that toJSON() would expose.
  warnUndeclaredSensitiveFields(ModelClass);

  return dataSource;
}
