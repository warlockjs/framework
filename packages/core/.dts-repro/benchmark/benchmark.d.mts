import { BenchmarkErrorResult, BenchmarkOptions, BenchmarkSuccessResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/benchmark/benchmark.d.ts
/**
 * Measure the execution time of a function and classify its performance.
 *
 * When `enabled` is false, fn() is still called but no timing runs and no hooks fire.
 * A zeroed SuccessResult is returned to keep the return type stable for all callers.
 *
 * @example
 * ```ts
 * const result = await measure("db-query", () => db.query("SELECT 1"), {
 *   latencyRange: { excellent: 100, poor: 500 },
 *   onComplete: (r) => metrics.record(r.latency),
 *   onError:    (r) => logger.error("query failed", r.error),
 *   onFinish:   (r) => logger.info(`${r.name} took ${r.latency}ms`),
 * });
 *
 * if (result.success) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
declare function measure<T>(name: string, fn: () => T | Promise<T>, options?: BenchmarkOptions<T>): Promise<BenchmarkSuccessResult<T> | BenchmarkErrorResult>;
//#endregion
export { measure };
//# sourceMappingURL=benchmark.d.mts.map