import { BenchmarkErrorResult, BenchmarkProfilerOptions, BenchmarkStats, BenchmarkSuccessResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/benchmark/profiler.d.ts
declare class BenchmarkProfiler {
  private readonly maxSamples;
  private readonly channels;
  private readonly entries;
  private interval?;
  constructor(options?: BenchmarkProfilerOptions);
  /**
   * Record one measurement result. Called automatically by measure() when a profiler is set.
   *
   * @param result - The success or error result from measure()
   *
   * @example
   * profiler.record(result);
   */
  record(result: BenchmarkSuccessResult<unknown> | BenchmarkErrorResult): void;
  /**
   * Get aggregated stats for one operation name.
   * Computes p50/p95/p99 by sorting the ring buffer on demand.
   *
   * @param name - The operation name to get stats for.
   * @returns Stats object or undefined if no data yet.
   *
   * @example
   * const stats = profiler.stats("db-query");
   */
  stats(name: string): BenchmarkStats | undefined;
  /**
   * Get stats for all tracked operations.
   *
   * @returns A record mapping operation names to their stats.
   *
   * @example
   * const all = profiler.allStats();
   */
  allStats(): Record<string, BenchmarkStats>;
  /**
   * Send allStats() to all registered channels.
   *
   * @example
   * await profiler.flush();
   */
  flush(): Promise<void>;
  /**
   * Clear ring buffer for one or all operations.
   * Does NOT reset unbounded total/error counters.
   *
   * @param name - Optional operation name. If omitted, clears all ring buffers.
   *
   * @example
   * profiler.reset("db-query");
   * profiler.reset();
   */
  reset(name?: string): void;
  /**
   * Dispose the profiler, clearing its auto-flush interval.
   *
   * @example
   * profiler.dispose();
   */
  dispose(): void;
}
//#endregion
export { BenchmarkProfiler };
//# sourceMappingURL=profiler.d.mts.map