import type { DevtoolsAiRollupDelta, DevtoolsAiRollupStore } from "../types";
import { deltaToIncrements, rowToRecord, type DevtoolsAiRollupRow } from "./mapping";
import { rollupId } from "./extract";
import { DevtoolsAiRollupIncrementError } from "./increment-error";

/** The part of cascade's query builder this store uses. */
interface RowQuery {
  where(field: string, operator: string, value: unknown): RowQuery;
  lean(): RowQuery;
  get(): Promise<DevtoolsAiRollupRow[]>;
  delete(): Promise<number>;
}

/** Rows written in one go; each row is its own atomic statement, so this only bounds open queries. */
const INCREMENT_CONCURRENCY = 10;

/**
 * The production `DevtoolsAiRollupStore`: table/collection
 * `devtools_ai_rollups` in the app database through `@warlock.js/cascade`
 * (model `DevtoolsAiRollupRow`, migration `DevtoolsAiRollupsMigration`).
 * `increment` runs one atomic `$inc` upsert per delta keyed by `id`
 * (`$setOnInsert` the dimensions, `$set` `updated_at`), so every process adds
 * into the same rows. When some upserts fail it throws
 * `DevtoolsAiRollupIncrementError` with the unsaved deltas. `verify` checks the table exists and answers `false`
 * when it does not. Imports cascade lazily.
 *
 * Both drivers support the upsert: MongoDB natively, PostgreSQL as
 * `INSERT … ON CONFLICT (id) DO UPDATE` (the id is the primary key, the filter
 * names it, and the inserted row takes the `$inc` amounts as its values).
 */
export async function createCascadeAiRollupStore(
  options: { now?: () => number } = {},
): Promise<DevtoolsAiRollupStore> {
  const now = options.now ?? Date.now;
  const { DevtoolsAiRollupRow: Rollups } = await import("../../production/store/models");

  // Throws when the app has no data source.
  Rollups.getDataSource();

  const query = () => Rollups.query() as unknown as RowQuery;

  return {
    async verify() {
      try {
        return await Rollups.getDriver().blueprint.tableExists(Rollups.table);
      } catch {
        return false;
      }
    },
    async increment(deltas) {
      // Every delta is tried; the ones that failed are reported so a retry never adds a saved one twice.
      const unwritten: DevtoolsAiRollupDelta[] = [];
      let firstError: unknown;

      for (let start = 0; start < deltas.length; start += INCREMENT_CONCURRENCY) {
        const chunk = deltas.slice(start, start + INCREMENT_CONCURRENCY);
        const settled = await Promise.allSettled(
          chunk.map(async (delta) => {
            const increments = deltaToIncrements(delta);
            const operations: Record<string, Record<string, unknown>> = {
              $set: { updated_at: now() },
              $setOnInsert: {
                hour: delta.hour,
                agent: delta.agent,
                model: delta.model,
                provider: delta.provider,
              },
            };

            // An empty `$inc` is an error on MongoDB.
            if (Object.keys(increments).length > 0) operations.$inc = increments;

            await Rollups.atomic({ id: rollupId(delta) }, operations as never, {
              upsert: true,
              trustedFilter: true,
            });
          }),
        );

        settled.forEach((outcome, index) => {
          if (outcome.status === "fulfilled") return;

          firstError ??= outcome.reason;
          unwritten.push(chunk[index]!);
        });
      }

      if (unwritten.length === 0) return;

      if (unwritten.length === deltas.length) throw firstError;

      throw new DevtoolsAiRollupIncrementError(unwritten, {
        written: deltas.length - unwritten.length,
        cause: firstError,
      });
    },
    async list(filter) {
      const target = query()
        .lean()
        .where("hour", ">=", filter.fromHour)
        .where("hour", "<", filter.toHour);

      if (filter.agent !== undefined) target.where("agent", "=", filter.agent);
      if (filter.model !== undefined) target.where("model", "=", filter.model);
      if (filter.provider !== undefined) target.where("provider", "=", filter.provider);

      return (await target.get()).map(rowToRecord);
    },
    async prune(beforeHour) {
      return query().where("hour", "<", beforeHour).delete();
    },
  };
}
