import { accumulateCost, type Usage } from "@warlock.js/ai";

/**
 * Fold a child {@link Usage} into a running accumulator. Token channels
 * (`input` / `output` / `total`) always sum; the optional cache /
 * reasoning channels (`cachedTokens` / `cacheWriteTokens` /
 * `reasoningTokens`) sum only when at least one side reported them, so
 * a provider that never meters a channel doesn't fabricate a `0` for
 * it. The `cost` breakdown is merged with the core framework's
 * {@link accumulateCost}, keeping cost-rollup semantics identical to a
 * native report tree — an unpriced contributor never erases a priced
 * one.
 *
 * Pure: returns a fresh `Usage`, never mutates either argument. Seed an
 * aggregation with {@link emptyUsage}.
 *
 * @example
 * let total = emptyUsage();
 * for (const trace of traces) {
 *   total = sumUsage(total, trace.usage);
 * }
 */
export function sumUsage(accumulator: Usage, next: Usage): Usage {
  const merged: Usage = {
    input: accumulator.input + next.input,
    output: accumulator.output + next.output,
    total: accumulator.total + next.total,
  };

  const cachedTokens = sumOptional(accumulator.cachedTokens, next.cachedTokens);
  if (cachedTokens !== undefined) {
    merged.cachedTokens = cachedTokens;
  }

  const cacheWriteTokens = sumOptional(accumulator.cacheWriteTokens, next.cacheWriteTokens);
  if (cacheWriteTokens !== undefined) {
    merged.cacheWriteTokens = cacheWriteTokens;
  }

  const reasoningTokens = sumOptional(accumulator.reasoningTokens, next.reasoningTokens);
  if (reasoningTokens !== undefined) {
    merged.reasoningTokens = reasoningTokens;
  }

  const cost = accumulateCost(accumulator.cost, next.cost);
  if (cost !== undefined) {
    merged.cost = cost;
  }

  return merged;
}

/**
 * A zero-valued {@link Usage} to seed an aggregation. Only the required
 * token channels are set; optional channels stay absent until a
 * contributor reports them, preserving the "never reported" vs
 * "reported as 0" distinction.
 */
export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    total: 0,
  };
}

/**
 * Add two optional token counts, treating either side's `undefined` as
 * zero — but return `undefined` when both are absent, so an unreported
 * channel stays unreported rather than collapsing to `0`.
 */
function sumOptional(
  accumulator: number | undefined,
  next: number | undefined,
): number | undefined {
  if (accumulator === undefined && next === undefined) {
    return undefined;
  }

  return (accumulator ?? 0) + (next ?? 0);
}
