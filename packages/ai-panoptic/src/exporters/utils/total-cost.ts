import type { Usage } from "@warlock.js/ai";

/**
 * Collapse a {@link Usage.cost} breakdown into a single USD scalar by
 * summing every populated field. Mirrors the formula documented on
 * `Usage.cost` (input + output + cachedInput + cachedOutput), and also
 * folds in `reasoning` for forward-safety when a provider prices
 * reasoning tokens as a separate channel. Returns `undefined` when no
 * pricing was attached, so exporters can omit the cost attribute
 * entirely rather than reporting a misleading `0`.
 *
 * @example
 * totalCostUsd({ input: 1, output: 2, total: 3, cost: { input: 0.01, output: 0.04 } });
 * // => 0.05
 */
export function totalCostUsd(usage: Usage): number | undefined {
  const cost = usage.cost;

  if (!cost) {
    return undefined;
  }

  return (
    (cost.input ?? 0) +
    (cost.output ?? 0) +
    (cost.cachedInput ?? 0) +
    (cost.cachedOutput ?? 0) +
    (cost.reasoning ?? 0)
  );
}
