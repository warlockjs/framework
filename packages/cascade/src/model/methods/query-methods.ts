import type {
  AtomicUpdate,
  AtomicUpdateOptions,
  FindOneAndUpdateOptions,
  PaginationOptions,
  PaginationResult,
  QueryBuilderContract,
} from "../../contracts";
import type { DataSource } from "../../data-source/data-source";
import { dataSourceRegistry } from "../../data-source/data-source-registry";
import { sanitizeFilter } from "../../utils/sanitize-filter";
import type { ChildModel, GlobalScopeDefinition, Model } from "../model";
import { warnUndeclaredSensitiveFields } from "./serialization-methods";

export function buildQuery<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  BaseModel: typeof Model,
): QueryBuilderContract<TModel> {
  const queryBuilder = ModelClass.newQueryBuilder<TModel>();
  const qb = queryBuilder;

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

  ModelClass.events().emitFetching(queryBuilder, {
    table: ModelClass.table,
    modelClass: ModelClass,
  });

  queryBuilder.hydrate((data: any) => {
    return ModelClass.hydrate(data);
  });

  // Eager-loading runs inside the driver's `get()` so it works for any
  // builder construction path (Model.query, Model.newQueryBuilder, custom
  // subclassed builders). This hook only handles the model-level `fetched`
  // event emission.
  queryBuilder.onFetched(async (models: any[]) => {
    await ModelClass.events().emit("fetched", models as any, {});
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

/**
 * Pin a driver-level write to the rows the model's global scopes (tenant, soft
 * delete) allow. The driver write APIs take a raw filter and never see scopes,
 * so the target ids are resolved through the scoped query builder and added to
 * the filter. `null` means no visible row matches: the write must be a no-op.
 */
export async function scopeWriteFilter(
  ModelClass: ChildModel<any>,
  filter: Record<string, unknown>,
  single: boolean,
): Promise<Record<string, unknown> | null> {
  const primaryKey = ModelClass.primaryKey;
  const ids = await ModelClass.query().where(filter).pluck(primaryKey);

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
): Promise<Record<string, unknown>> {
  const scoped = await scopeWriteFilter(ModelClass, filter, true);

  if (scoped) {
    return scoped;
  }

  const hidden = await ModelClass.query().withoutGlobalScopes().where(filter).exists();

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
  const scoped = options?.upsert
    ? await scopeUpsertFilter(ModelClass, resolved)
    : await scopeWriteFilter(ModelClass, resolved, false);

  if (!scoped) {
    return 0;
  }

  const result = await ModelClass.getDriver().atomic(
    ModelClass.table,
    scoped,
    operations,
    toDriverOptions(options),
  );

  return result.modifiedCount + (result.upsertedCount ?? 0);
}

export async function updateById<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  id: string | number,
  data: Record<string, unknown>,
): Promise<number> {
  const scoped = await scopeWriteFilter(ModelClass, { [ModelClass.primaryKey]: id }, true);

  if (!scoped) {
    return 0;
  }

  const result = await ModelClass.getDriver().update(ModelClass.table, scoped, { $set: data });
  return result.modifiedCount;
}

export async function findAndUpdateRecords<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  update: AtomicUpdate,
  options?: Omit<AtomicUpdateOptions, "trustedFilter">,
): Promise<TModel[]> {
  await performAtomic(ModelClass, filter, update, { ...options, trustedFilter: false });
  return await ModelClass.query().where(filter).get();
}

export async function findOneAndUpdateRecord<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  filter: Record<string, unknown>,
  update: AtomicUpdate,
  options?: FindOneAndUpdateOptions,
): Promise<TModel | null> {
  const resolved = resolveFilter(filter, options);
  const scoped = options?.upsert
    ? await scopeUpsertFilter(ModelClass, resolved)
    : await scopeWriteFilter(ModelClass, resolved, true);

  if (!scoped) return null;

  const result = await ModelClass.getDriver().findOneAndUpdate(
    ModelClass.table,
    scoped,
    update,
    toDriverOptions(options),
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
