import type { ModelCost, Usage } from "@warlock.js/ai";

/**
 * Rolled-up usage + cost across a set of stored traces, returned by the
 * trace store's `aggregate`. Answers the headline observability
 * questions — "how many runs, how many tokens, how much did it cost,
 * how many failed" — for whatever slice a {@link
 * import("./trace-query.type").TraceQuery} selected.
 *
 * `usage` sums the per-trace root `Usage` (already a rollup of own cost
 * + children), so the totals reflect the entire run tree without
 * re-walking spans. `cost` is the per-channel USD breakdown merged with
 * the same `accumulateCost` logic the core framework uses to roll a
 * report tree, so an unpriced trace never erases the cost of priced
 * ones — `cost` stays `undefined` only when NO trace in the slice
 * carried pricing.
 *
 * @example
 * const stats = store.aggregate({ sessionId: "session-42" });
 * console.log(`${stats.traces} runs, ${stats.usage.total} tokens`);
 * const totalUsd = totalCost(stats.cost) ?? 0; // `totalCost` from @warlock.js/ai
 */
export type TraceAggregate = {
  /** Number of traces matched by the query. */
  traces: number;
  /** Count of matched traces whose root status was `"completed"`. */
  completed: number;
  /** Count of matched traces whose root status was `"failed"` or `"incomplete"`. */
  failed: number;
  /** Count of matched traces whose root status was `"cancelled"`. */
  cancelled: number;
  /**
   * Summed token usage across every matched trace. `input` / `output` /
   * `total` always present (zero when no traces matched); the optional
   * cache / reasoning channels are summed only when at least one trace
   * reported them.
   */
  usage: Usage;
  /**
   * Merged per-channel USD cost across every matched trace, or
   * `undefined` when no matched trace carried pricing. Same shape as
   * `ModelCost` so callers can read the input/output/cache split,
   * not just one opaque number.
   */
  cost?: ModelCost;
  /** Summed wall-clock duration in milliseconds across matched traces. */
  totalDuration: number;
};
