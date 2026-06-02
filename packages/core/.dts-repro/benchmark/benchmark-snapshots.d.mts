import { BenchmarkErrorResult, BenchmarkSnapshotsOptions, BenchmarkSuccessResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/benchmark/benchmark-snapshots.d.ts
declare class BenchmarkSnapshots {
  private readonly maxSnapshots;
  private readonly capture;
  private readonly snapshots;
  constructor(options?: BenchmarkSnapshotsOptions);
  /**
   * Record a raw result. Called automatically by measure() when a snapshotContainer is set.
   * Respects the `capture` setting — ignores results that don't match.
   *
   * @param result - The success or error result to record.
   *
   * @example
   * snapshots.record(result);
   */
  record(result: BenchmarkSuccessResult<unknown> | BenchmarkErrorResult): void;
  /**
   * Get all snapshots for one operation name.
   *
   * @param name - The operation name.
   * @returns Array of snapshots for the operation.
   *
   * @example
   * snapshots.getSnapshots("db-query");
   */
  getSnapshots(name: string): (BenchmarkSuccessResult<unknown> | BenchmarkErrorResult)[];
  /**
   * Get all snapshots for all tracked operations.
   *
   * @returns A mapping of operation names to their snapshots array.
   *
   * @example
   * snapshots.allSnapshots();
   */
  allSnapshots(): Record<string, (BenchmarkSuccessResult<unknown> | BenchmarkErrorResult)[]>;
  /**
   * Clear snapshots for one or all operations.
   *
   * @param name - Optional operation name. If omitted, clears all snapshots.
   *
   * @example
   * snapshots.reset("db-query");
   * snapshots.reset();
   */
  reset(name?: string): void;
}
//#endregion
export { BenchmarkSnapshots };
//# sourceMappingURL=benchmark-snapshots.d.mts.map