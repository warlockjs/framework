import { SeedContext, SeedResult } from "./types";

export type Seeder = {
  /**
   * Seed name
   */
  name: string;
  /**
   * Whether to enable it
   */
  enabled?: boolean;
  /**
   * Seed description
   */
  description?: string;
  /**
   * List of dependent seeds to run first
   */
  dependsOn?: string[];
  /**
   * Whether to run it once
   */
  once?: boolean;
  /**
   * Seed execution order
   */
  order?: number;
  /**
   * Batch size.
   *
   * Surfaced to `run()` as {@link SeedContext.batchSize} (defaulting to this
   * value, or `0` when unset) so a seed can forward it to
   * `Model.createMany(rows, { batchSize })`.
   */
  batchSize?: number;
  /**
   * Run seed.
   *
   * Receives a {@link SeedContext} exposing:
   * - `track` — registers the records this seed creates so they can be undone
   *   by `warlock seed --drop`. Auto-derives `recordsCreated` from the track
   *   count; an explicitly returned {@link SeedResult} is an optional fallback.
   * - `now` — the injectable clock to read instead of an ambient `new Date()` /
   *   `dayjs()`, so historical seeds and the seeds-log share one overridable
   *   clock.
   * - `batchSize` — the suggested bulk-insert batch size (from this seeder's
   *   `batchSize`, default `0`).
   *
   * The `ctx` parameter is optional at the call site — an existing zero-arg
   * `run()` keeps working unchanged.
   */
  run(ctx: SeedContext): Promise<SeedResult | void>;
};

/**
 * Create a new seeder
 */
export function seeder(seeder: Seeder) {
  return seeder;
}
