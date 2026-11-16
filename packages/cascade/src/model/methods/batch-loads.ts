import { currentContextScope } from "@warlock.js/context";
import { databaseTransactionContext } from "../../context/database-transaction-context";
import { RelationLoader } from "../../relations/relation-loader";
import type { ChildModel, Model } from "../model";
import { findById } from "./query-methods";

type Deferred<TValue> = {
  resolve: (value: TValue) => void;
  reject: (error: unknown) => void;
};

type PendingLoad = Deferred<void> & { model: Model; relations: string[] };
type PendingFind = Deferred<Model | null> & { id: string | number };

/**
 * Pending calls, grouped by context scope and then by model class. A batch
 * runs in the scope of its first call, so calls made under other context
 * stores (another request, another tenant's `run()`) never join it: a global
 * scope reading the current tenant sees the caller's own tenant.
 */
type PendingByScope<TPending> = Map<object, Map<ChildModel<Model>, TPending[]>>;

const pendingLoads: PendingByScope<PendingLoad> = new Map();

const pendingFinds: PendingByScope<PendingFind> = new Map();

/**
 * Add `pending` to the queue of the current scope and model class. Returns
 * the queue to flush when this call opened it, otherwise `undefined`.
 */
function enqueue<TPending>(
  registry: PendingByScope<TPending>,
  ModelClass: ChildModel<Model>,
  pending: TPending,
): (() => TPending[]) | undefined {
  const scope = currentContextScope();
  let byClass = registry.get(scope);

  if (!byClass) {
    byClass = new Map();
    registry.set(scope, byClass);
  }

  const queue = byClass.get(ModelClass);

  if (queue) {
    queue.push(pending);
    return undefined;
  }

  byClass.set(ModelClass, [pending]);

  return () => {
    const owner = registry.get(scope);
    const taken = owner?.get(ModelClass) ?? [];

    owner?.delete(ModelClass);

    if (owner?.size === 0) registry.delete(scope);

    return taken;
  };
}

/**
 * Whether calls of the model class are collected per tick. Off for a model
 * with `static batchLoads = false` and inside a transaction, where every
 * query must run on that transaction's own session in call order.
 */
function isBatching(ModelClass: ChildModel<Model>): boolean {
  return ModelClass.batchLoads !== false && !databaseTransactionContext.hasActiveTransaction();
}

/**
 * `model.load(...relations)` for one model.
 *
 * Calls for the same model class and the same relations made in one tick
 * (`Promise.all(posts.map((post) => post.load("author")))`) run as one
 * relation load over all their models. A lone call loads exactly as before.
 */
export function loadRelationsBatched(model: Model, relations: string[]): Promise<void> {
  const ModelClass = model.self();

  if (!isBatching(ModelClass)) {
    return new RelationLoader([model], ModelClass).load(relations);
  }

  return new Promise<void>((resolve, reject) => {
    const take = enqueue(pendingLoads, ModelClass, { model, relations, resolve, reject });

    if (take) {
      queueMicrotask(() => void flushLoads(ModelClass, take()));
    }
  });
}

async function flushLoads(ModelClass: ChildModel<Model>, queue: PendingLoad[]): Promise<void> {
  const groups = new Map<string, PendingLoad[]>();

  for (const pending of queue) {
    const key = JSON.stringify(pending.relations);
    const group = groups.get(key) ?? [];

    group.push(pending);
    groups.set(key, group);
  }

  await Promise.all(
    [...groups.values()].map(async (group) => {
      // The same instance asked for twice is loaded once.
      const models = [...new Set(group.map((pending) => pending.model))];

      const relations = group[0]!.relations;

      try {
        await new RelationLoader(models, ModelClass).load(relations);

        for (const pending of group) pending.resolve();
      } catch (error) {
        if (models.length === 1) {
          for (const pending of group) pending.reject(error);
          return;
        }

        // One model's value can fail the whole load (a malformed key): each
        // call then loads on its own and gets its own result or error.
        for (const pending of group) {
          new RelationLoader([pending.model], ModelClass)
            .load(relations)
            .then(pending.resolve, pending.reject);
        }
      }
    }),
  );
}

/**
 * `Model.find(id)`.
 *
 * `find()` calls for the same model class made in one tick run as one
 * `whereIn` query on the primary key. A lone call, a repeated id and any call
 * inside a transaction keep the single-row query.
 */
export function findByIdBatched<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  id: string | number,
): Promise<TModel | null> {
  if (!isBatching(ModelClass)) {
    return findById(ModelClass, id);
  }

  return new Promise<Model | null>((resolve, reject) => {
    const take = enqueue(pendingFinds, ModelClass, { id, resolve, reject });

    if (take) {
      queueMicrotask(() => void flushFinds(ModelClass, take()));
    }
  }) as Promise<TModel | null>;
}

async function flushFinds(ModelClass: ChildModel<Model>, queue: PendingFind[]): Promise<void> {
  // The first call per id takes part in the batch; a repeat of the same id
  // gets its own instance from a single-row query.
  const batched = new Map<string, PendingFind>();
  const repeats: PendingFind[] = [];

  for (const pending of queue) {
    const key = String(pending.id);

    if (batched.has(key)) {
      repeats.push(pending);
    } else {
      batched.set(key, pending);
    }
  }

  const single = (pending: PendingFind) => {
    findById(ModelClass, pending.id).then(pending.resolve, pending.reject);
  };

  repeats.forEach(single);

  if (batched.size === 1) {
    single([...batched.values()][0]!);
    return;
  }

  try {
    const ids = [...batched.values()].map((pending) => pending.id);
    const rows = await ModelClass.query().whereIn(ModelClass.primaryKey, ids).get();
    const byId = new Map(rows.map((row) => [String(row.get(ModelClass.primaryKey)), row]));
    const unmatched: PendingFind[] = [];

    for (const [key, pending] of batched) {
      const row = byId.get(key);

      if (row) {
        byId.delete(key);
        pending.resolve(row);
      } else {
        unmatched.push(pending);
      }
    }

    // A row left over matched an id the database compares differently
    // (`"05"` for `5`, an upper-case UUID): those calls fall back to their own
    // single-row query. When every row was claimed, an unmatched id has no row.
    for (const pending of unmatched) {
      if (byId.size > 0) single(pending);
      else pending.resolve(null);
    }
  } catch {
    // One id can fail the whole query (a malformed UUID on PostgreSQL): each
    // call then runs its own single-row query and gets its own result or error.
    for (const pending of batched.values()) single(pending);
  }
}
