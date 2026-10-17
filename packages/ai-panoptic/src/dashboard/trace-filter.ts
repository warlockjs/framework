import type { ReportStatus, ReportType } from "@warlock.js/ai";
import type { Trace, TraceSpan } from "../contracts/trace.type";

/**
 * Client-side trace-list filter criteria. The dashboard polls the full
 * trace list every 2s and narrows it in the browser with these — search
 * box, filter chips, and the errors-only header toggle all feed one
 * {@link TraceFilter}. Kept as a pure, framework-free module so the exact
 * matching rules are unit-tested here and the inlined dashboard JS in
 * {@link import("./ui.html").dashboardHtml} mirrors them 1:1.
 *
 * Every field is optional — an absent field is "don't care". An empty
 * filter therefore matches every trace.
 */
export type TraceFilter = {
  /**
   * Free-text needle matched case-insensitively against a trace's root
   * span name and session id. Whitespace-trimmed; an empty/blank string
   * is treated as absent.
   */
  text?: string;
  /**
   * Restrict to these terminal statuses (root span status). Empty array
   * is treated as "don't care" (matches every status).
   */
  statuses?: ReportStatus[];
  /**
   * Restrict to these executable types (root span type). Empty array is
   * treated as "don't care".
   */
  types?: ReportType[];
  /**
   * Exact session-id chip. When set, only traces whose `sessionId`
   * equals this value match. Distinct from {@link TraceFilter.text},
   * which is a fuzzy substring across name + session.
   */
  sessionId?: string;
  /**
   * Exact prompt chip — a `name@version` key (see {@link tracePromptKey}).
   * When set, only traces whose root span resolved that exact named prompt
   * version match. Mirrors {@link TraceFilter.sessionId} but over the
   * prompt-version-linkage attributes the collector stamps on agent spans.
   */
  promptKey?: string;
  /**
   * Errors-only header toggle. When `true`, only `failed` / `cancelled`
   * traces match — independent of (and intersected with) `statuses`.
   */
  errorsOnly?: boolean;
};

/** Statuses the errors-only toggle keeps. */
const ERROR_STATUSES: readonly ReportStatus[] = ["failed", "cancelled"] as const;

/**
 * Span-attribute keys the collector stamps with prompt-version linkage when
 * an agent ran against a *named* `ai.prompts` builder. Read here (not
 * imported) so this pure module stays decoupled from the collector.
 */
const PROMPT_NAME_ATTR = "agent.promptName";
const PROMPT_VERSION_ATTR = "agent.promptVersion";

/**
 * The `name@version` prompt key a trace falls under, read from its root
 * span's prompt-version-linkage attributes (`agent.promptName` /
 * `agent.promptVersion`). Returns `undefined` when the run carried no named
 * prompt (raw-string / anonymous / no prompt), so callers can bucket those
 * under a synthetic "no prompt" key or skip them.
 *
 * The version is included so two runs of the same prompt name at different
 * versions are distinct keys — that is the whole point of the linkage: to
 * group / filter by the *exact* prompt revision that produced a run.
 */
export function tracePromptKey(trace: Trace): string | undefined {
  const attributes = trace.root.attributes;

  if (attributes === undefined) {
    return undefined;
  }

  const name = attributes[PROMPT_NAME_ATTR];

  if (typeof name !== "string" || name.length === 0) {
    return undefined;
  }

  const version = attributes[PROMPT_VERSION_ATTR];
  const versionLabel = typeof version === "string" && version.length > 0 ? version : "1";

  return `${name}@${versionLabel}`;
}

/**
 * Does a single trace pass the given filter? Pure predicate — all
 * conditions are ANDed; an unset field never excludes. Used by
 * {@link filterTraces} and mirrored by the dashboard's inlined JS.
 */
export function matchesFilter(trace: Trace, filter: TraceFilter): boolean {
  const root = trace.root;

  if (filter.errorsOnly === true && !ERROR_STATUSES.includes(root.status)) {
    return false;
  }

  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    if (!filter.statuses.includes(root.status)) {
      return false;
    }
  }

  if (filter.types !== undefined && filter.types.length > 0) {
    if (!filter.types.includes(root.type)) {
      return false;
    }
  }

  if (filter.sessionId !== undefined && filter.sessionId.length > 0) {
    if (trace.sessionId !== filter.sessionId) {
      return false;
    }
  }

  if (filter.promptKey !== undefined && filter.promptKey.length > 0) {
    if (tracePromptKey(trace) !== filter.promptKey) {
      return false;
    }
  }

  const text = filter.text?.trim().toLowerCase();
  if (text !== undefined && text.length > 0) {
    const haystack = `${root.name} ${trace.sessionId ?? ""}`.toLowerCase();
    if (!haystack.includes(text)) {
      return false;
    }
  }

  return true;
}

/** Narrow a trace list to those matching the filter, order preserved. */
export function filterTraces(traces: Trace[], filter: TraceFilter): Trace[] {
  return traces.filter((trace) => matchesFilter(trace, filter));
}

/**
 * The grouping key a trace falls under when the list is grouped by
 * session. Traces without a `sessionId` collapse into one synthetic
 * "(no session)" bucket so they remain visible.
 */
export const NO_SESSION_KEY = "(no session)";

/** One session bucket — its key plus the traces under it, order preserved. */
export type SessionGroup = {
  /** The `sessionId`, or {@link NO_SESSION_KEY} for sessionless traces. */
  sessionId: string;
  /** Traces in this group, in the order they appeared in the input. */
  traces: Trace[];
};

/**
 * Group an (already filtered, newest-first) trace list by session id,
 * preserving first-seen order of both the groups and the traces within
 * each. Sessionless traces bucket under {@link NO_SESSION_KEY}.
 */
export function groupBySession(traces: Trace[]): SessionGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, Trace[]>();

  for (const trace of traces) {
    const key = trace.sessionId ?? NO_SESSION_KEY;
    let bucket = byKey.get(key);

    if (bucket === undefined) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }

    bucket.push(trace);
  }

  return order.map((sessionId) => ({ sessionId, traces: byKey.get(sessionId) ?? [] }));
}

/**
 * The grouping key a trace falls under when the list is grouped by prompt
 * version. Runs that resolved no named prompt collapse into one synthetic
 * "(no prompt)" bucket so they remain visible.
 */
export const NO_PROMPT_KEY = "(no prompt)";

/** One prompt-version bucket — its `name@version` key plus its traces. */
export type PromptGroup = {
  /** The `name@version` key, or {@link NO_PROMPT_KEY} for unlinked traces. */
  promptKey: string;
  /** Traces in this group, in the order they appeared in the input. */
  traces: Trace[];
};

/**
 * Group an (already filtered, newest-first) trace list by prompt version —
 * the `name@version` key {@link tracePromptKey} derives from each run's
 * prompt-version-linkage attributes. Preserves first-seen order of both the
 * groups and the traces within each. Runs with no named prompt bucket under
 * {@link NO_PROMPT_KEY}.
 *
 * The dashboard offers this as a second group-by dimension beside session,
 * so a reviewer can see every run of "support@2" together and compare its
 * cost / failure rate against "support@3".
 */
export function groupByPrompt(traces: Trace[]): PromptGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, Trace[]>();

  for (const trace of traces) {
    const key = tracePromptKey(trace) ?? NO_PROMPT_KEY;
    let bucket = byKey.get(key);

    if (bucket === undefined) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }

    bucket.push(trace);
  }

  return order.map((promptKey) => ({ promptKey, traces: byKey.get(promptKey) ?? [] }));
}

/**
 * The grouping key a trace falls under when the list is grouped by root
 * type. `root.type` is always present, so this is only a defensive
 * fallback for a malformed trace with no typed root.
 */
export const NO_TYPE_KEY = "(no type)";

/** One root-type bucket — its type discriminator plus its traces. */
export type TypeGroup = {
  /** The root span's `type` (e.g. `agent` / `workflow` / `planner`), or {@link NO_TYPE_KEY}. */
  type: string;
  /** Traces in this group, in the order they appeared in the input. */
  traces: Trace[];
};

/**
 * Group an (already filtered, newest-first) trace list by root type —
 * the `agent` / `workflow` / `supervisor` / `orchestrator` / `planner` /
 * `tool` / `batch` / `callback` discriminator on each trace's root span.
 * Preserves first-seen order of both the groups and the traces within each.
 *
 * The dashboard offers this as the coarsest group-by dimension beside
 * session and prompt: when a benchmark floods the flat list with hundreds
 * of one primitive (e.g. standalone `agent` runs), this collapses them
 * behind a per-type header so the structural primitives (the lone planner,
 * the team, the supervisors) are one click away instead of a scroll past.
 */
export function groupByType(traces: Trace[]): TypeGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, Trace[]>();

  for (const trace of traces) {
    const key = trace.root.type || NO_TYPE_KEY;
    let bucket = byKey.get(key);

    if (bucket === undefined) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }

    bucket.push(trace);
  }

  return order.map((type) => ({ type, traces: byKey.get(type) ?? [] }));
}

/** One row of the per-type aggregate-stats panel. */
export type TypeStat = {
  /** Root type discriminator, or {@link NO_TYPE_KEY}. */
  type: string;
  /** Number of traces of this type. */
  count: number;
  /** Traces whose status is `failed` / `cancelled`. */
  failed: number;
  /** `failed / count` in `[0, 1]`. */
  failRate: number;
  /** Median (p50) root duration in ms. */
  p50: number;
  /** p95 root duration in ms. */
  p95: number;
  /** Summed `usage.total` tokens across the bucket. */
  tokens: number;
  /** Summed per-trace USD cost across the bucket. */
  cost: number;
};

/**
 * Nearest-rank percentile of `values` at `p` (0–100). Returns 0 for an
 * empty input and sorts a copy so the caller's array is left untouched.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);

  return sorted[index];
}

/**
 * One trace's total USD cost: its explicit root-usage cost when priced,
 * else the rollup of its subtree. Mirrors the dashboard's `traceCost` so the
 * stats panel and the trace rows agree to the cent.
 */
export function traceCost(trace: Trace): number {
  const own = costSumObj(trace.usage.cost);
  return own > 0 ? own : rollupCost(trace.root);
}

/**
 * Aggregate an (already filtered) trace list into one {@link TypeStat} row
 * per root type — count, failure rate, p50/p95 latency, total tokens, total
 * cost — preserving first-seen type order. Powers the dashboard's per-type
 * stats panel; computed over the same filtered list the trace view shows, so
 * the panel always reflects the active filters.
 */
export function aggregateByType(traces: Trace[]): TypeStat[] {
  const order: string[] = [];
  const byKey = new Map<string, Trace[]>();

  for (const trace of traces) {
    const key = trace.root.type || NO_TYPE_KEY;
    let bucket = byKey.get(key);

    if (bucket === undefined) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }

    bucket.push(trace);
  }

  return order.map((type) => {
    const bucket = byKey.get(type) ?? [];
    const durations = bucket.map((trace) => trace.duration);
    let failed = 0;
    let tokens = 0;
    let cost = 0;

    for (const trace of bucket) {
      if (ERROR_STATUSES.includes(trace.root.status)) {
        failed += 1;
      }

      tokens += trace.usage.total ?? 0;
      cost += traceCost(trace);
    }

    return {
      type,
      count: bucket.length,
      failed,
      failRate: bucket.length > 0 ? failed / bucket.length : 0,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      tokens,
      cost,
    };
  });
}

/**
 * Sum every priced lane of a usage cost object into one USD number.
 * Mirrors the dashboard's `costSumObj` so heatmap intensities computed
 * here match what the page renders.
 */
function costSumObj(cost: TraceSpan["usage"]["cost"]): number {
  if (cost === undefined) {
    return 0;
  }

  return (
    (cost.input ?? 0) +
    (cost.output ?? 0) +
    (cost.cachedInput ?? 0) +
    (cost.cacheWrite ?? 0) +
    (cost.cachedOutput ?? 0) +
    (cost.reasoning ?? 0)
  );
}

/**
 * Rollup-aware subtree cost: a node's own cost when it carries one
 * (it already rolls up its trips), otherwise the sum of its children.
 * Avoids double-counting wrapper nodes (workflow/supervisor roots carry
 * tokens but no cost). Mirrors the dashboard's `rollupCost`.
 */
export function rollupCost(span: TraceSpan): number {
  const own = costSumObj(span.usage.cost);
  if (own > 0) {
    return own;
  }

  let sum = 0;
  for (const child of span.children) {
    sum += rollupCost(child);
  }

  return sum;
}

/**
 * Heatmap intensity in `[0, 1]` for a node's `rollupCost` relative to the
 * trace's most-expensive node. The dashboard tints each tree node's left
 * accent by this. `max <= 0` (a free trace) yields `0` for every node so
 * the heatmap simply stays cold rather than dividing by zero.
 */
export function heatIntensity(nodeCost: number, maxCost: number): number {
  if (maxCost <= 0 || nodeCost <= 0) {
    return 0;
  }

  const ratio = nodeCost / maxCost;

  return ratio > 1 ? 1 : ratio;
}

/**
 * The largest single-node {@link rollupCost} anywhere in a span tree —
 * the denominator for {@link heatIntensity}. Walks the whole subtree.
 */
export function maxNodeCost(root: TraceSpan): number {
  let max = rollupCost(root);

  for (const child of root.children) {
    const childMax = maxNodeCost(child);
    if (childMax > max) {
      max = childMax;
    }
  }

  return max;
}
