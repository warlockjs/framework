import type {
  DevtoolsAiBreakdownRow,
  DevtoolsAiErrorCategory,
  DevtoolsAiErrorGroup,
  DevtoolsAiFilterOptions,
  DevtoolsAiModelRow,
  DevtoolsAiPricingState,
  DevtoolsAiRatePoint,
  DevtoolsAiResolvedRange,
  DevtoolsAiSeriesSet,
  DevtoolsAiTotals,
} from "../../production/contracts";
import { DEVTOOLS_AI_ERROR_CATEGORIES } from "../../production/contracts";
import { DEVTOOLS_AI_ERROR_LABELS } from "../rollup/categories";
import { addAiLatency, aiLatencyQuantile, emptyAiLatency } from "../rollup/histogram";
import type { DevtoolsAiRollupDelta } from "../types";

/**
 * Pure folds from rollup rows (stored records plus pending deltas) to the
 * report shapes in `production/contracts.ts`. No I/O, no clock.
 */

const MAX_NAMED_SERIES = 5;
const OTHER_KEY = "__other";

/** `provider/model`, the key the UI filters and colours models by. */
function modelKey(row: { provider: string; model: string }): string {
  return `${row.provider}/${row.model}`;
}

/** Sums rows into totals (latency from the merged histogram). */
export function totalsOf(rows: readonly DevtoolsAiRollupDelta[]): DevtoolsAiTotals {
  const totals: DevtoolsAiTotals = {
    runs: 0,
    completed: 0,
    failed: 0,
    incomplete: 0,
    cancelled: 0,
    errorRate: 0,
    tokens: { input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0 },
    cost: { estimatedUsd: 0, pricedRuns: 0, unpricedRuns: 0, unpricedTokens: 0 },
    latency: { p50Ms: null, p95Ms: null, meanMs: null },
    fallbackRuns: 0,
    refusals: 0,
  };
  const histogram = emptyAiLatency();
  let latencyCount = 0;
  let latencySumMs = 0;

  for (const row of rows) {
    totals.runs += row.runs;
    totals.completed += row.completed;
    totals.failed += row.failed;
    totals.incomplete += row.incomplete;
    totals.cancelled += row.cancelled;
    totals.tokens.input += row.inputTokens;
    totals.tokens.output += row.outputTokens;
    totals.tokens.cached += row.cachedTokens;
    totals.tokens.cacheWrite += row.cacheWriteTokens;
    totals.tokens.reasoning += row.reasoningTokens;
    totals.cost.estimatedUsd += row.costUsd;
    totals.cost.pricedRuns += row.pricedRuns;
    totals.cost.unpricedRuns += row.unpricedRuns;
    totals.cost.unpricedTokens += row.unpricedTokens;
    totals.fallbackRuns += row.fallbackRuns;
    totals.refusals += row.refusals;
    addAiLatency(histogram, row.latency);
    latencyCount += row.latencyCount;
    latencySumMs += row.latencySumMs;
  }

  totals.errorRate = totals.runs > 0 ? (totals.failed + totals.incomplete) / totals.runs : 0;
  totals.latency = {
    p50Ms: aiLatencyQuantile(histogram, 0.5),
    p95Ms: aiLatencyQuantile(histogram, 0.95),
    meanMs: latencyCount > 0 ? latencySumMs / latencyCount : null,
  };

  return totals;
}

/** The bucket index of an hour inside `range` (`-1` outside). */
export function bucketOf(hour: number, range: DevtoolsAiResolvedRange): number {
  if (hour < range.from || hour >= range.to) return -1;

  return Math.floor((hour - range.from) / range.stepMs);
}

/** Bucket starts of a range, oldest first. */
function bucketStarts(range: DevtoolsAiResolvedRange): number[] {
  const count = Math.max(0, Math.ceil((range.to - range.from) / range.stepMs));

  return Array.from({ length: count }, (_, index) => range.from + index * range.stepMs);
}

type SeriesEntry = { bucket: number; key: string; label: string; value: number };

/** Top five keys by sum become series, the rest are summed into `__other`. */
function buildSeries(range: DevtoolsAiResolvedRange, entries: SeriesEntry[]): DevtoolsAiSeriesSet {
  const buckets = bucketStarts(range);
  const byKey = new Map<string, { label: string; sum: number; values: number[] }>();

  for (const entry of entries) {
    if (entry.bucket < 0 || entry.bucket >= buckets.length) continue;

    let item = byKey.get(entry.key);

    if (!item) {
      item = { label: entry.label, sum: 0, values: new Array<number>(buckets.length).fill(0) };
      byKey.set(entry.key, item);
    }

    item.values[entry.bucket] = (item.values[entry.bucket] ?? 0) + entry.value;
    item.sum += entry.value;
  }

  const ranked = [...byKey.entries()].sort(
    (a, b) => b[1].sum - a[1].sum || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const series: DevtoolsAiSeriesSet["series"] = ranked
    .slice(0, MAX_NAMED_SERIES)
    .map(([key, item]) => ({ key, label: item.label, values: item.values, other: false }));
  const rest = ranked.slice(MAX_NAMED_SERIES);

  if (rest.length > 0) {
    const values = new Array<number>(buckets.length).fill(0);

    for (const [, item] of rest) {
      item.values.forEach((value, index) => {
        values[index] = (values[index] ?? 0) + value;
      });
    }

    series.push({ key: OTHER_KEY, label: "Other", values, other: true });
  }

  return { buckets, series };
}

/**
 * A stacked series set: `value(row)` per bucket, grouped by `keyOf(row)`; the
 * five keys with the largest sum are named, the rest summed into `other`
 * (key `__other`, label "Other"). Buckets with no rows are 0.
 */
export function seriesBy(
  rows: readonly DevtoolsAiRollupDelta[],
  range: DevtoolsAiResolvedRange,
  keyOf: (row: DevtoolsAiRollupDelta) => string,
  labelOf: (key: string) => string,
  value: (row: DevtoolsAiRollupDelta) => number,
): DevtoolsAiSeriesSet {
  return buildSeries(
    range,
    rows.map((row) => {
      const key = keyOf(row);

      return { bucket: bucketOf(row.hour, range), key, label: labelOf(key), value: value(row) };
    }),
  );
}

/** Tokens per bucket: `uncached` (input − cached), `cached`, `output`. */
export function tokenSeries(
  rows: readonly DevtoolsAiRollupDelta[],
  range: DevtoolsAiResolvedRange,
): DevtoolsAiSeriesSet {
  const buckets = bucketStarts(range);
  const uncached = new Array<number>(buckets.length).fill(0);
  const cached = new Array<number>(buckets.length).fill(0);
  const output = new Array<number>(buckets.length).fill(0);

  for (const row of rows) {
    const bucket = bucketOf(row.hour, range);

    if (bucket < 0 || bucket >= buckets.length) continue;

    uncached[bucket] = (uncached[bucket] ?? 0) + Math.max(0, row.inputTokens - row.cachedTokens);
    cached[bucket] = (cached[bucket] ?? 0) + row.cachedTokens;
    output[bucket] = (output[bucket] ?? 0) + row.outputTokens;
  }

  return {
    buckets,
    series: [
      { key: "uncached", label: "Uncached input", values: uncached, other: false },
      { key: "cached", label: "Cached input", values: cached, other: false },
      { key: "output", label: "Output", values: output, other: false },
    ],
  };
}

/** The error rate per bucket; `rate: null` where a bucket has no runs. */
export function errorRateSeries(
  rows: readonly DevtoolsAiRollupDelta[],
  range: DevtoolsAiResolvedRange,
): DevtoolsAiRatePoint[] {
  const points = bucketStarts(range).map((at) => ({
    at,
    runs: 0,
    errors: 0,
    rate: null as number | null,
  }));

  for (const row of rows) {
    const point = points[bucketOf(row.hour, range)];

    if (!point) continue;

    point.runs += row.runs;
    point.errors += row.failed + row.incomplete;
  }

  for (const point of points) point.rate = point.runs > 0 ? point.errors / point.runs : null;

  return points;
}

/** Failed runs per bucket by category (top five plus Other). */
export function errorSeries(
  rows: readonly DevtoolsAiRollupDelta[],
  range: DevtoolsAiResolvedRange,
): DevtoolsAiSeriesSet {
  const entries: SeriesEntry[] = [];

  for (const row of rows) {
    const bucket = bucketOf(row.hour, range);

    for (const category of DEVTOOLS_AI_ERROR_CATEGORIES) {
      const value = row.errors[category];

      if (value > 0) {
        entries.push({ bucket, key: category, label: DEVTOOLS_AI_ERROR_LABELS[category], value });
      }
    }
  }

  return buildSeries(range, entries);
}

function groupRows(
  rows: readonly DevtoolsAiRollupDelta[],
  keyOf: (row: DevtoolsAiRollupDelta) => string,
): Map<string, DevtoolsAiRollupDelta[]> {
  const groups = new Map<string, DevtoolsAiRollupDelta[]>();

  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);

    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return groups;
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Top rows by estimated cost (by runs when nothing was priced), at most `limit`. */
export function breakdown(
  rows: readonly DevtoolsAiRollupDelta[],
  by: "agent" | "model",
  limit: number,
): DevtoolsAiBreakdownRow[] {
  const groups = groupRows(rows, (row) => (by === "agent" ? row.agent : modelKey(row)));
  const items = [...groups.entries()].map(([key, group]) => ({
    key,
    group,
    totals: totalsOf(group),
  }));
  const totalCost = items.reduce((sum, item) => sum + item.totals.cost.estimatedUsd, 0);
  const totalRuns = items.reduce((sum, item) => sum + item.totals.runs, 0);
  const byCost = totalCost > 0;

  items.sort(
    (a, b) =>
      (byCost ? b.totals.cost.estimatedUsd - a.totals.cost.estimatedUsd : 0) ||
      b.totals.runs - a.totals.runs ||
      byKey(a.key, b.key),
  );

  return items.slice(0, limit).map(({ key, group, totals }) => ({
    key,
    label: key,
    provider: by === "model" ? (group[0]?.provider ?? null) : null,
    totals,
    share: byCost
      ? totals.cost.estimatedUsd / totalCost
      : totalRuns > 0
        ? totals.runs / totalRuns
        : 0,
  }));
}

function pricingOf(totals: DevtoolsAiTotals): DevtoolsAiPricingState {
  const { pricedRuns, unpricedRuns } = totals.cost;

  // No run used tokens (all failed before the first call): nothing to price yet.
  if (pricedRuns === 0 && unpricedRuns === 0) return "no-tokens";

  if (unpricedRuns === 0) return "set";

  return pricedRuns === 0 ? "missing" : "partial";
}

/** One row per `provider/model`, most runs first. */
export function modelRows(rows: readonly DevtoolsAiRollupDelta[]): DevtoolsAiModelRow[] {
  const result: DevtoolsAiModelRow[] = [];

  for (const [key, group] of groupRows(rows, modelKey)) {
    const totals = totalsOf(group);
    const runsByAgent = new Map<string, number>();
    let lastSeenAt = 0;

    for (const row of group) {
      runsByAgent.set(row.agent, (runsByAgent.get(row.agent) ?? 0) + row.runs);

      if (row.runs > 0 && row.hour > lastSeenAt) lastSeenAt = row.hour;
    }

    const first = group[0];

    result.push({
      key,
      model: first?.model ?? "",
      provider: first?.provider ?? "",
      totals,
      pricing: pricingOf(totals),
      costPerRunUsd:
        totals.cost.pricedRuns > 0 ? totals.cost.estimatedUsd / totals.cost.pricedRuns : null,
      fallbackRate: totals.runs > 0 ? totals.fallbackRuns / totals.runs : 0,
      agents: [...runsByAgent.entries()]
        .sort((a, b) => b[1] - a[1] || byKey(a[0], b[0]))
        .slice(0, 5)
        .map(([agent]) => agent),
      lastSeenAt,
    });
  }

  return result.sort((a, b) => b.totals.runs - a.totals.runs || byKey(a.key, b.key));
}

function countErrors(
  rows: readonly DevtoolsAiRollupDelta[],
  category: DevtoolsAiErrorCategory,
): number {
  return rows.reduce((sum, row) => sum + row.errors[category], 0);
}

function topCounts(
  rows: readonly DevtoolsAiRollupDelta[],
  category: DevtoolsAiErrorCategory,
  keyOf: (row: DevtoolsAiRollupDelta) => string,
): { key: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const count = row.errors[category];

    if (count > 0) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + count);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || byKey(a[0], b[0]))
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));
}

/** Categories with at least one error, most first, with `previousCount` from `previousRows`. */
export function errorGroups(
  rows: readonly DevtoolsAiRollupDelta[],
  previousRows: readonly DevtoolsAiRollupDelta[],
): DevtoolsAiErrorGroup[] {
  const counted = DEVTOOLS_AI_ERROR_CATEGORIES.map((category) => ({
    category,
    count: countErrors(rows, category),
  }));
  const total = counted.reduce((sum, item) => sum + item.count, 0);

  return counted
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ category, count }) => ({
      category,
      label: DEVTOOLS_AI_ERROR_LABELS[category],
      count,
      share: total > 0 ? count / total : 0,
      previousCount: countErrors(previousRows, category),
      byModel: topCounts(rows, category, modelKey),
      byAgent: topCounts(rows, category, (row) => row.agent),
    }));
}

/** The distinct agents, models and providers, sorted. */
export function filterOptions(rows: readonly DevtoolsAiRollupDelta[]): DevtoolsAiFilterOptions {
  const agents = new Set<string>();
  const models = new Set<string>();
  const providers = new Set<string>();

  for (const row of rows) {
    agents.add(row.agent);
    models.add(modelKey(row));
    providers.add(row.provider);
  }

  return {
    agents: [...agents].sort(byKey),
    models: [...models].sort(byKey),
    providers: [...providers].sort(byKey),
  };
}
