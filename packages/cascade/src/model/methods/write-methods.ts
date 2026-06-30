import { DatabaseWriter } from "../../writer/database-writer";
import type { InsertResult, WriterOptions } from "../../contracts";
import type { ChildModel, Model, ModelSchema } from "../model";
import { emitModelEvent } from "./instance-event-methods";

/**
 * Default number of rows processed per chunk by {@link createManyRecords}.
 *
 * Chunking keeps a single huge `createMany` call from flooding the driver:
 * the default path runs each chunk's `save()` calls under one `Promise.all`,
 * and the bulk path emits one multi-row `insertMany` per chunk so the
 * generated `INSERT ... VALUES (...),(...)` stays under the database's bind
 * parameter ceiling.
 */
export const DEFAULT_CREATE_MANY_BATCH_SIZE = 500;

/**
 * Options for {@link createManyRecords} (and `Model.createMany`).
 */
export type CreateManyOptions = {
  /**
   * Number of rows processed per chunk.
   *
   * @default 500 ({@link DEFAULT_CREATE_MANY_BATCH_SIZE})
   */
  batchSize?: number;

  /**
   * Route each chunk through the driver's native multi-row insert
   * (`insertMany`) instead of per-row `save()`.
   *
   * **Tradeoff:** the bulk path is 10–100× faster for large arrays but
   * SKIPS the per-row lifecycle: `saving` / `creating` / `created` / `saved`
   * events, instance hooks, and sync operations are NOT emitted. Casts,
   * timestamps, defaults and id-generation that the writer normally applies
   * ARE still applied (the rows are prepped through the same writer pipeline),
   * so persisted columns match the default path.
   *
   * @default false
   */
  bulk?: boolean;
};

export async function saveModel<TModel extends Model>(
  model: TModel,
  options?: WriterOptions & { merge?: Partial<ModelSchema> },
): Promise<TModel> {
  if (options?.merge) {
    model.merge(options.merge);
  }
  const writer = new DatabaseWriter(model);
  await writer.save(options);
  return model;
}

export async function createRecord<
  TModel extends Model,
  TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema,
>(ModelClass: ChildModel<TModel>, data: Partial<TSchema>): Promise<TModel> {
  const model = new ModelClass(data);
  await model.save();
  return model;
}

/**
 * Split an array into sequential chunks of at most `size` elements.
 *
 * @param items - The array to split.
 * @param size - Maximum chunk length (callers pass a value `>= 1`).
 * @returns An array of chunks preserving the original order.
 */
function chunkArray<TItem>(items: TItem[], size: number): TItem[][] {
  const chunks: TItem[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * Create many records, chunking the work so a huge array can't overwhelm the
 * driver.
 *
 * Two strategies are available via `options.bulk`:
 *
 * - **Default (`bulk` falsy):** each row is persisted through `save()`, so
 *   model hooks, lifecycle events, casts and generated ids are all preserved.
 *   Rows are processed in sequential chunks of `batchSize`, each chunk running
 *   under a single `Promise.all`, so an array of millions of rows can't open
 *   millions of concurrent inserts at once.
 *
 * - **Bulk (`bulk: true`):** each chunk is routed to the driver's native
 *   multi-row insert (`insertMany`) for 10–100× throughput. This SKIPS the
 *   per-row save lifecycle (no `saving` / `creating` / `created` / `saved`
 *   events, hooks, or sync). Rows are still prepped through the writer
 *   pipeline (validation, casting, timestamps, defaults, id-generation) so the
 *   persisted columns match the default path, and the values returned by the
 *   driver (generated `_id`, timestamps, SQL `RETURNING *`) are merged back
 *   onto the returned models.
 *
 * Both strategies return the created model instances (an empty array is a
 * no-op that never touches the driver).
 *
 * @param ModelClass - The model class to create records for.
 * @param data - The rows to insert.
 * @param options - Chunking / bulk options.
 * @returns The created model instances.
 *
 * @example
 * ```typescript
 * // Default: per-row save(), chunked in batches of 500
 * const users = await User.createMany(rows);
 *
 * // Bulk: one multi-row INSERT per 1000-row chunk (skips per-row hooks)
 * const users = await User.createMany(rows, { bulk: true, batchSize: 1000 });
 * ```
 */
export async function createManyRecords<
  TModel extends Model,
  TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema,
>(
  ModelClass: ChildModel<TModel>,
  data: Partial<TSchema>[],
  options: CreateManyOptions = {},
): Promise<TModel[]> {
  if (data.length === 0) {
    return [];
  }

  const batchSize =
    options.batchSize && options.batchSize > 0
      ? options.batchSize
      : DEFAULT_CREATE_MANY_BATCH_SIZE;

  const chunks = chunkArray(data, batchSize);

  if (options.bulk === true) {
    return await createManyBulk(ModelClass, chunks);
  }

  const created: TModel[] = [];

  for (const chunk of chunks) {
    const models = chunk.map((item) => new ModelClass(item)) as TModel[];

    // Reserve one contiguous id block for the whole chunk (1 counter op instead
    // of N), pre-seeding each id-less model so its per-row save() no-ops id-gen.
    await assignIdBlock(ModelClass, models);

    const chunkModels = await Promise.all(
      models.map(async (model) => {
        await model.save();
        return model;
      }),
    );

    created.push(...chunkModels);
  }

  return created;
}

/**
 * Reserve a single contiguous id block for one chunk and pre-assign the ids to
 * the models that don't already carry one, so the per-row writer's id
 * generation no-ops (its `model.get("id")` guard short-circuits). This turns N
 * per-row counter round-trips into ONE per chunk.
 *
 * Falls back to per-row generation (a no-op here) when:
 * - the model disables auto-generation (`autoGenerateId === false`) — e.g. SQL,
 *   which uses native `SERIAL`;
 * - the data source's id generator has no batch API (`generateNextIds`) — the
 *   optional contract member is feature-detected;
 * - the model uses a random initial id / increment — a random stride can't form
 *   a contiguous block, so those models keep per-row generation.
 *
 * Only models WITHOUT a caller-supplied id consume a block slot, so a chunk
 * mixing supplied and auto ids allocates exactly the right number (no gaps).
 *
 * @param ModelClass - The model class being inserted.
 * @param models - The freshly-constructed (unsaved) models for one chunk.
 */
async function assignIdBlock<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  models: TModel[],
): Promise<void> {
  if (!ModelClass.autoGenerateId || ModelClass.randomInitialId || ModelClass.randomIncrement) {
    return;
  }

  const idGenerator = ModelClass.getDataSource().idGenerator;

  if (!idGenerator || typeof idGenerator.generateNextIds !== "function") {
    return;
  }

  const idLessModels = models.filter((model) => !model.get("id"));

  if (idLessModels.length === 0) {
    return;
  }

  const ids = await idGenerator.generateNextIds({
    table: ModelClass.table,
    initialId: ModelClass.initialId || 1,
    incrementIdBy: ModelClass.incrementIdBy || 1,
    count: idLessModels.length,
  });

  // Enforce the contract at this pluggable, feature-detected boundary: a
  // non-conforming generator returning the wrong count would otherwise set
  // `id = undefined` on the unmatched rows, the per-row writer would silently
  // re-generate single ids, and the reserved block would no longer match what
  // is persisted. Fail loud instead of corrupting the sequence.
  if (ids.length !== idLessModels.length) {
    throw new Error(
      `generateNextIds returned ${ids.length} id(s) for ${idLessModels.length} row(s) on ` +
        `"${ModelClass.table}" — a batch id generator must return exactly the requested count.`,
    );
  }

  idLessModels.forEach((model, index) => {
    model.set("id", ids[index]);
  });
}

/**
 * Bulk variant of {@link createManyRecords}: prep each row through the writer
 * pipeline (validation, casting, timestamps, defaults, id-generation) without
 * touching the database, then flush each chunk with a single
 * `driver.insertMany` call.
 *
 * The writer reuse is achieved by swapping the driver's single-row `insert`
 * for a capturing stub for the lifetime of the bulk operation: running
 * `writer.save({ skipEvents, skipSync })` exercises the real prep but records
 * the prepared document instead of issuing N single-row inserts. The original
 * `insert` is always restored in `finally`.
 *
 * @param ModelClass - The model class to create records for.
 * @param chunks - Pre-chunked rows.
 * @returns The created model instances with driver-returned values merged in.
 */
async function createManyBulk<
  TModel extends Model,
  TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema,
>(ModelClass: ChildModel<TModel>, chunks: Partial<TSchema>[][]): Promise<TModel[]> {
  const dataSource = ModelClass.getDataSource();
  const driver = dataSource.driver;
  const table = ModelClass.table;
  // Keep the exact original reference so it can be restored verbatim (binding a
  // copy would, for a spied driver, replace the spy with a non-spy wrapper).
  const originalInsert = driver.insert;

  // Capture the prepared (validated/casted/timestamped/id-generated) document
  // instead of inserting it per row, so the writer's prep runs exactly once
  // per model while the actual write is deferred to a single insertMany.
  driver.insert = (async (
    _table: string,
    document: Record<string, unknown>,
  ): Promise<InsertResult> => {
    return { document };
  }) as typeof driver.insert;

  const created: TModel[] = [];

  try {
    for (const chunk of chunks) {
      const models = chunk.map((item) => new ModelClass(item)) as TModel[];

      // Reserve one contiguous id block for the whole chunk (1 counter op
      // instead of N), pre-seeding each id-less model so the per-row writer's
      // id generation no-ops.
      await assignIdBlock(ModelClass, models);

      // Prep every model through the real writer pipeline. The captured
      // `insert` keeps this off the wire while still mutating each model's
      // data with casts/timestamps/defaults/generated ids.
      const preparedDocuments = await Promise.all(
        models.map(async (model) => {
          const writer = new DatabaseWriter(model);
          await writer.save({ skipEvents: true, skipSync: true });
          return { ...model.data } as Record<string, unknown>;
        }),
      );

      const results = await driver.insertMany(table, preparedDocuments);

      // Merge driver-returned values (generated _id, timestamps, RETURNING *)
      // back onto each model so the returned instances reflect persisted state.
      models.forEach((model, index) => {
        const result = results[index] as InsertResult | Record<string, unknown> | undefined;

        if (result) {
          const returnedDocument =
            "document" in (result as Record<string, unknown>)
              ? (result as InsertResult).document
              : result;

          model.merge(returnedDocument as Record<string, unknown>);
        }

        model.dirtyTracker.reset();
        model.isNew = false;
      });

      created.push(...models);
    }
  } finally {
    driver.insert = originalInsert;
  }

  return created;
}

export async function findOrCreateRecord<
  TModel extends Model,
  TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema,
>(
  ModelClass: ChildModel<TModel>,
  filter: Partial<TSchema>,
  data: Partial<TSchema>,
): Promise<TModel> {
  const existing = await ModelClass.first(filter as Record<string, unknown>);

  if (existing) {
    return existing;
  }

  return await createRecord(ModelClass, { ...filter, ...data } as Partial<TSchema>);
}

export async function upsertRecord<
  TModel extends Model,
  TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema,
>(
  ModelClass: ChildModel<TModel>,
  filter: Partial<TSchema>,
  data: Partial<TSchema>,
  options?: Record<string, unknown>,
): Promise<TModel> {
  const driver = ModelClass.getDriver();
  const mergedData = { ...filter, ...data } as Record<string, unknown>;

  const tempModel = new ModelClass(mergedData as Partial<TSchema>);
  tempModel.isNew = true;

  await emitModelEvent(tempModel, "saving", {
    isInsert: true,
    options,
    mode: "upsert",
  });

  const createdAtColumn = ModelClass.createdAtColumn;
  const updatedAtColumn = ModelClass.updatedAtColumn;

  if (createdAtColumn !== false && createdAtColumn !== undefined) {
    const createdAtKey = createdAtColumn as string;
    if (!mergedData[createdAtKey]) {
      mergedData[createdAtKey] = new Date();
    }
  }

  if (updatedAtColumn !== false && updatedAtColumn !== undefined) {
    const updatedAtKey = updatedAtColumn as string;
    mergedData[updatedAtKey] = new Date();
  }

  await emitModelEvent(tempModel, "saving", { filter, data: mergedData, options, mode: "upsert" });

  const result = await driver.upsert(ModelClass.table, filter as Record<string, unknown>, mergedData, options);

  const model = ModelClass.hydrate(result as Record<string, unknown>) as TModel;
  model.dirtyTracker.reset();

  await emitModelEvent(model, "saved", { filter, data: result, options, mode: "upsert" });

  return model;
}
