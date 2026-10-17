import { totalCost, type Usage } from "@warlock.js/ai";

/**
 * Collapse a {@link Usage.cost} breakdown into a single USD scalar by
 * summing every populated channel (input, output, cache reads, cache
 * writes, reasoning) via `totalCost` from `@warlock.js/ai`. Returns `undefined` when no
 * pricing was attached, so exporters can omit the cost attribute
 * entirely rather than reporting a misleading `0`.
 *
 * @example
 * totalCostUsd({ input: 1, output: 2, total: 3, cost: { input: 0.01, output: 0.04 } });
 * // => 0.05
 */
export function totalCostUsd(usage: Usage): number | undefined {
  return totalCost(usage.cost);
}
