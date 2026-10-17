import type { ModelPricing } from "../contracts/result/model-pricing.type";
import type { Usage } from "../contracts/result/usage.type";

/**
 * Compute a per-channel USD cost breakdown for a single `Usage` against
 * a model's pricing table. Returns `undefined` when no pricing is
 * configured — the framework treats unpriced runs as "cost unknown,"
 * not "cost zero," so dashboards can distinguish free-tier from
 * un-instrumented.
 *
 * **Shape mirrors `ModelPricing`** — `input`, `output`, and the optional
 * `cachedInput` (cache reads), `cacheWrite` (cache writes, both
 * lifetimes) and `reasoning` channels. Use {@link totalCost} for a scalar
 * total. The breakdown tells downstream tooling HOW the total was reached
 * (input-vs-output share, cache savings) without re-deriving against
 * pricing tables that may have shifted since the report was written.
 *
 * **Cache-aware, per provider semantics.**
 * - `usage.cachedTokens` bill at `pricing.cachedInput` (full `input` rate
 *   when unset).
 * - `usage.cacheWriteTokens` bill at `pricing.cacheWrite` (then the
 *   deprecated `cachedOutput`, then `input`); the `cacheWrite1hTokens`
 *   share bills at `pricing.cacheWrite1h` (then the `cacheWrite` rate).
 * - Fresh input bills at `pricing.input`. When `usage.inputIncludesCache`
 *   is `true` or absent (OpenAI-style), fresh input is
 *   `input - cachedTokens - cacheWriteTokens`; when it is `false`
 *   (Anthropic / Bedrock), `input` already is the fresh remainder.
 *
 * **Reasoning.** When `pricing.reasoning` is set, `usage.reasoningTokens`
 * move out of `output` into a `reasoning` channel at that rate; otherwise
 * they stay in `output` (the common case).
 *
 * Pricing values are USD-per-million-tokens. Each channel divides once at
 * the end to avoid floating-point accumulation error on per-token math.
 *
 * @example
 * // OpenAI-style: cached tokens are part of `input`
 * const usage: Usage = { input: 150_000, output: 30_000, total: 180_000, cachedTokens: 90_000 };
 * const cost = computeCost(usage, { input: 0.15, output: 0.6, cachedInput: 0.075 });
 * // { input: 0.009, output: 0.018, cachedInput: 0.00675 }
 *
 * @example
 * // Anthropic-style: cache reads and writes come on top of `input`
 * computeCost(
 *   { input: 100, output: 500, total: 600, cachedTokens: 50_000, cacheWriteTokens: 20_000, inputIncludesCache: false },
 *   { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 },
 * );
 * // { input: 0.0003, output: 0.0075, cachedInput: 0.015, cacheWrite: 0.075 }
 */
export function computeCost(
  usage: Usage,
  pricing: ModelPricing | undefined,
): ModelPricing | undefined {
  if (!pricing) {
    return undefined;
  }

  const cachedInput = Math.max(0, usage.cachedTokens ?? 0);
  const cacheWrites = Math.max(0, usage.cacheWriteTokens ?? 0);
  const cacheWrites1h = Math.min(cacheWrites, Math.max(0, usage.cacheWrite1hTokens ?? 0));
  const cacheWritesDefault = cacheWrites - cacheWrites1h;
  const freshInput =
    usage.inputIncludesCache === false
      ? Math.max(0, usage.input)
      : Math.max(0, usage.input - cachedInput - cacheWrites);

  const reasoningTokens =
    pricing.reasoning !== undefined
      ? Math.min(Math.max(0, usage.reasoningTokens ?? 0), Math.max(0, usage.output))
      : 0;

  const cost: ModelPricing = {
    input: (freshInput * pricing.input) / 1_000_000,
    output: ((usage.output - reasoningTokens) * pricing.output) / 1_000_000,
  };

  if (cachedInput > 0) {
    const cachedInputRate = pricing.cachedInput ?? pricing.input;
    cost.cachedInput = (cachedInput * cachedInputRate) / 1_000_000;
  }

  if (cacheWrites > 0) {
    const writeRate = pricing.cacheWrite ?? pricing.cachedOutput ?? pricing.input;
    const write1hRate = pricing.cacheWrite1h ?? writeRate;
    cost.cacheWrite =
      (cacheWritesDefault * writeRate) / 1_000_000 + (cacheWrites1h * write1hRate) / 1_000_000;
  }

  if (reasoningTokens > 0 && pricing.reasoning !== undefined) {
    cost.reasoning = (reasoningTokens * pricing.reasoning) / 1_000_000;
  }

  return cost;
}

/**
 * Attach the cost of `usage` under `pricing` to `usage.cost`, in place,
 * and return the same object. A no-op when `pricing` is undefined, so an
 * unpriced model keeps `cost` absent ("unknown", never `0`). Adapters
 * call it on the usage they return from `complete()` and the streaming
 * `done` chunk, so side calls outside an agent are costed too.
 *
 * @example
 * return { content, finishReason, usage: attachCost(usage, this.pricing) };
 */
export function attachCost(usage: Usage, pricing: ModelPricing | undefined): Usage {
  const cost = computeCost(usage, pricing);

  if (cost) {
    usage.cost = cost;
  }

  return usage;
}

/**
 * Sum every populated channel of a cost breakdown into one USD figure.
 * Returns `undefined` when `cost` is undefined (an unpriced run), so
 * "unknown" never reads as `0`.
 *
 * Includes the deprecated `cachedOutput` channel so breakdowns stored
 * before 5.31 still total correctly.
 *
 * @example
 * totalCost({ input: 0.0003, output: 0.0075, cachedInput: 0.015, cacheWrite: 0.075 }); // 0.0978
 */
export function totalCost(cost: ModelPricing | undefined): number | undefined {
  if (!cost) {
    return undefined;
  }

  let total = cost.input + cost.output;

  for (const channel of OPTIONAL_COST_CHANNELS) {
    total += cost[channel] ?? 0;
  }

  return total;
}

/**
 * Optional channels of a cost breakdown. `cacheWrite1h` is a pricing rate
 * only — `computeCost` books every write under `cacheWrite` — but it is
 * listed so a hand-built breakdown that uses it still sums and merges.
 */
const OPTIONAL_COST_CHANNELS = [
  "cachedInput",
  "cacheWrite",
  "cacheWrite1h",
  "cachedOutput",
  "reasoning",
] as const satisfies ReadonlyArray<keyof ModelPricing>;

/**
 * Merge a child's cost breakdown into a running parent total. Each
 * channel (`input`, `output`, `cachedInput`, `cacheWrite`, `reasoning`, …) sums
 * independently — an undefined channel on either side is treated as
 * zero contribution rather than dropping the other side's value. A
 * single unpriced child should never erase the cost of its priced
 * siblings.
 *
 * Returns the new parent breakdown, or `undefined` when neither parent
 * nor child carried any cost data (preserves the "no priced
 * contributor has appeared yet" signal that distinguishes "missing
 * pricing" from "genuinely zero").
 */
export function accumulateCost(
  parent: ModelPricing | undefined,
  child: ModelPricing | undefined,
): ModelPricing | undefined {
  if (!child) {
    return parent;
  }

  if (!parent) {
    return { ...child };
  }

  const merged: ModelPricing = {
    input: parent.input + child.input,
    output: parent.output + child.output,
  };

  for (const channel of OPTIONAL_COST_CHANNELS) {
    const sum = sumOptional(parent[channel], child[channel]);

    if (sum !== undefined) {
      merged[channel] = sum;
    }
  }

  return merged;
}

/**
 * Add two optional numbers, treating either side's `undefined` as
 * zero — but return `undefined` when both are absent. Keeps "this
 * channel was never reported anywhere" distinguishable from "this
 * channel was reported as 0."
 */
function sumOptional(parent: number | undefined, child: number | undefined): number | undefined {
  if (parent === undefined && child === undefined) {
    return undefined;
  }

  return (parent ?? 0) + (child ?? 0);
}

/**
 * Accumulate a child {@link Usage} into a running parent total, mutating
 * `target` in place. Scalar token channels (`input` / `output` / `total`)
 * sum directly; the optional sub-channels (`cachedTokens`,
 * `reasoningTokens`, `cacheWriteTokens`) accumulate only when some
 * contributor reported them (preserving the "never reported anywhere"
 * signal); and the cost breakdown merges via {@link accumulateCost} so a
 * single unpriced child can never erase a priced sibling's cost.
 *
 * `inputIncludesCache` carries over when every contributor agrees. When
 * contributors disagree (a fallback chain spanning an Anthropic-style and
 * an OpenAI-style provider), the excluded cache tokens are folded into
 * `input` / `total` and the aggregate is marked `inputIncludesCache: true`.
 *
 * This is the ONE canonical usage rollup — every aggregator (agent,
 * workflow, supervisor, team, planner, batch) routes through it so cost +
 * cache/reasoning telemetry propagates identically to the top-level
 * `result.usage`. Re-implementing a bare `input/output/total` sum at a
 * call site silently drops those optional channels.
 */
export function mergeUsage(target: Usage, child: Usage): void {
  const targetIsEmpty =
    target.input === 0 &&
    target.output === 0 &&
    target.total === 0 &&
    target.cachedTokens === undefined &&
    target.cacheWriteTokens === undefined &&
    target.inputIncludesCache === undefined;

  if (targetIsEmpty) {
    if (child.inputIncludesCache !== undefined) {
      target.inputIncludesCache = child.inputIncludesCache;
    }
  } else if ((target.inputIncludesCache ?? true) !== (child.inputIncludesCache ?? true)) {
    // Mixed semantics (a fallback chain across providers): fold the
    // excluded cache tokens into `input` so the aggregate reads one way.
    if (target.inputIncludesCache === false) {
      const folded = (target.cachedTokens ?? 0) + (target.cacheWriteTokens ?? 0);
      target.input += folded;
      target.total += folded;
    }

    target.inputIncludesCache = true;
  }

  const childFolded =
    target.inputIncludesCache !== false && child.inputIncludesCache === false
      ? (child.cachedTokens ?? 0) + (child.cacheWriteTokens ?? 0)
      : 0;

  target.input += child.input + childFolded;
  target.output += child.output;
  target.total += child.total + childFolded;

  if (child.cachedTokens !== undefined) {
    target.cachedTokens = (target.cachedTokens ?? 0) + child.cachedTokens;
  }

  if (child.reasoningTokens !== undefined) {
    target.reasoningTokens = (target.reasoningTokens ?? 0) + child.reasoningTokens;
  }

  if (child.cacheWriteTokens !== undefined) {
    target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + child.cacheWriteTokens;
  }

  if (child.cacheWrite1hTokens !== undefined) {
    target.cacheWrite1hTokens = (target.cacheWrite1hTokens ?? 0) + child.cacheWrite1hTokens;
  }

  const mergedCost = accumulateCost(target.cost, child.cost);
  if (mergedCost !== undefined) {
    target.cost = mergedCost;
  }
}
