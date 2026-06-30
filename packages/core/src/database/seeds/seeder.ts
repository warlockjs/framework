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
   * Batch size
   */
  batchSize?: number;
  /**
   * Run seed.
   *
   * Receives a {@link SeedContext} exposing `track`, used to register the
   * records this seed creates so they can be undone by `warlock seed --drop`.
   * Auto-derives `recordsCreated` from the track count; an explicitly returned
   * {@link SeedResult} is an optional fallback.
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
