import { BenchmarkChannel, BenchmarkStats } from "../types.mjs";

//#region ../../@warlock.js/core/src/benchmark/channels/console.channel.d.ts
declare class ConsoleChannel implements BenchmarkChannel {
  /**
   * Pretty-prints a stats table per operation on onFlush().
   *
   * @param stats - Aggregated stats for all tracked operations.
   *
   * @example
   * const channel = new ConsoleChannel();
   * channel.onFlush({ "db-query": { p50: 10, count: 100, ... } });
   */
  onFlush(stats: Record<string, BenchmarkStats>): void;
}
//#endregion
export { ConsoleChannel };
//# sourceMappingURL=console.channel.d.mts.map