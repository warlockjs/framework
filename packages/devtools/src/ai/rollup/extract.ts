import { createHash } from "node:crypto";
import type { Trace } from "@warlock.js/ai-panoptic";
import type { DevtoolsAiRollupDelta, DevtoolsAiTotalCost } from "../types";
import { classifyAiError, emptyErrorCounts } from "./categories";
import { addAiLatency, aiLatencyBucket, emptyAiLatency } from "./histogram";

type Span = Trace["root"];
type RollupKey = { hour: number; agent: string; model: string; provider: string };

const HOUR_MS = 3_600_000;
const UNKNOWN = "(unknown)";
const MODEL_SPAN_TYPES: ReadonlySet<string> = new Set([
  "agent",
  "image",
  "speech",
  "transcription",
]);

/** Token counts with `input` normalised to the whole prompt. */
type Tokens = {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  reasoning: number;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalise(usage: Span["usage"] | undefined): Tokens {
  const cached = count(usage?.cachedTokens);
  const cacheWrite = count(usage?.cacheWriteTokens);
  const input = count(usage?.input);

  return {
    input: usage?.inputIncludesCache === false ? input + cached + cacheWrite : input,
    output: count(usage?.output),
    cached,
    cacheWrite,
    reasoning: count(usage?.reasoningTokens),
  };
}

function subtract(own: Tokens, other: Tokens): void {
  own.input = Math.max(0, own.input - other.input);
  own.output = Math.max(0, own.output - other.output);
  own.cached = Math.max(0, own.cached - other.cached);
  own.cacheWrite = Math.max(0, own.cacheWrite - other.cacheWrite);
  own.reasoning = Math.max(0, own.reasoning - other.reasoning);
}

/**
 * The model a span reports: `agent.model.*` first, then `<span type>.model.*`
 * (image, speech and transcription spans).
 */
export function spanModelOf(span: Span): { name?: string; provider?: string } {
  const attributes = span.attributes;
  const pick = (key: string): string | undefined => {
    for (const prefix of ["agent", span.type]) {
      const value = attributes?.[`${prefix}.${key}`];

      if (typeof value === "string" && value !== "") return value;
    }

    return undefined;
  };

  return { name: pick("model.name"), provider: pick("model.provider") };
}

/** Whether a span is one run in the rollups: it reports a model, or is an agent/image/speech/transcription span. */
export function isAiModelSpan(span: Span): boolean {
  return spanModelOf(span).name !== undefined || MODEL_SPAN_TYPES.has(span.type);
}

/** The nearest model-bearing descendants of `span` (their own subtrees are not entered). */
function nearestModelSpans(span: Span): Span[] {
  const found: Span[] = [];

  for (const child of span.children ?? []) {
    if (isAiModelSpan(child)) found.push(child);
    else found.push(...nearestModelSpans(child));
  }

  return found;
}

function cut(value: unknown, max: number): string {
  if (typeof value !== "string" || value === "") return UNKNOWN;

  return value.length > max ? value.slice(0, max) : value;
}

function spanCost(span: Span, totalCost: DevtoolsAiTotalCost): number {
  return count(totalCost(span.usage));
}

/** Whether a span's usage carries pricing at all (a free model is priced at 0; no pricing is `undefined`). */
function hasPricing(span: Span, totalCost: DevtoolsAiTotalCost): boolean {
  return typeof totalCost(span.usage) === "number";
}

function buildDelta(
  key: RollupKey,
  status: string,
  errorType: string | undefined,
  tokens: Tokens,
  cost: number,
  /** The own usage is priced even when `cost` is 0 (a model priced as free). */
  pricedAtZero = false,
): DevtoolsAiRollupDelta {
  const delta = emptyRollupDelta(key);

  delta.runs = 1;
  delta.inputTokens = tokens.input;
  delta.outputTokens = tokens.output;
  delta.cachedTokens = tokens.cached;
  delta.cacheWriteTokens = tokens.cacheWrite;
  delta.reasoningTokens = tokens.reasoning;

  if (status === "completed") delta.completed = 1;
  else if (status === "failed") delta.failed = 1;
  else if (status === "incomplete" || status === "max-iterations") delta.incomplete = 1;
  else if (status === "cancelled") delta.cancelled = 1;

  if (status === "failed" || status === "incomplete" || status === "max-iterations") {
    delta.errors[classifyAiError(status, errorType)] = 1;
  }

  if (cost > 0 || (pricedAtZero && tokens.input + tokens.output > 0)) {
    delta.costUsd = cost;
    delta.pricedRuns = 1;
  } else if (tokens.input + tokens.output > 0) {
    delta.unpricedRuns = 1;
    delta.unpricedTokens = tokens.input + tokens.output;
  }

  return delta;
}

/**
 * Turns one finished Panoptic trace into rollup deltas, one per
 * model-bearing span (a span with an `agent.model.name` attribute, or of type
 * `agent`, `image`, `speech` or `transcription`), keyed by the hour of the
 * span's `endedAt`.
 *
 * Each span counts its OWN usage and cost: its rolled-up `usage` minus the
 * usage of its nearest model-bearing descendants (an agent used as a tool is
 * counted once, as itself). Root usage left after subtracting every
 * model-bearing span (a custom flow with no agent span) becomes one more delta
 * for the root name with model `(unknown)`, counted as one run.
 *
 * Per span: status maps to completed / failed / incomplete (`incomplete`,
 * `max-iterations`) / cancelled; failed and incomplete runs add one error to
 * `classifyAiError(status, error.type)`; tokens are normalised so `input`
 * includes cache reads and writes; `costUsd` is `totalCost` of the own usage
 * when it is above 0 (or the span's model is priced as free), otherwise a run
 * with tokens counts in `unpricedRuns` and `unpricedTokens`; `agent.fallbackTrips > 0` adds a fallback run;
 * `agent.refusals > 0` or a CONTENT_FILTER error adds a refusal; the span's
 * `duration` goes into the latency histogram.
 *
 * Pure: no clock, no I/O. Names are cut to 200 (provider 100) characters.
 */
export function traceToRollupDeltas(
  trace: Trace,
  totalCost: DevtoolsAiTotalCost,
): DevtoolsAiRollupDelta[] {
  const root = trace.root;

  if (!root) return [];

  // A span without a readable end falls back to the root's end, then the trace's; no end at all skips the trace.
  const rootEnd = Date.parse(root.endedAt);
  const fallbackEnd = Number.isNaN(rootEnd) ? Date.parse(trace.endedAt) : rootEnd;

  if (Number.isNaN(fallbackEnd)) return [];

  const hourOf = (span: Span): number => {
    const ended = Date.parse(span.endedAt);
    const at = Number.isNaN(ended) ? fallbackEnd : ended;

    return Math.floor(at / HOUR_MS) * HOUR_MS;
  };

  const deltas: DevtoolsAiRollupDelta[] = [];
  const topLevel: Span[] = isAiModelSpan(root) ? [root] : nearestModelSpans(root);

  const visit = (span: Span): void => {
    const tokens = normalise(span.usage);
    let cost = spanCost(span, totalCost);
    const inner = nearestModelSpans(span);

    for (const child of inner) {
      subtract(tokens, normalise(child.usage));
      cost -= spanCost(child, totalCost);
    }

    cost = Math.max(0, cost);

    // Priced at zero only when the span's own pricing is known: none of the nested model spans carry a cost.
    const pricedAtZero =
      hasPricing(span, totalCost) && inner.every((child) => !hasPricing(child, totalCost));

    const attributes = span.attributes ?? {};
    const key: RollupKey = { hour: hourOf(span), ...aiRollupNamesOf(span) };
    const delta = buildDelta(key, span.status, span.error?.type, tokens, cost, pricedAtZero);

    if (count(attributes["agent.fallbackTrips"]) > 0) delta.fallbackRuns = 1;

    if (count(attributes["agent.refusals"]) > 0 || span.error?.type === "CONTENT_FILTER") {
      delta.refusals = 1;
    }

    const duration = count(span.duration);

    const bucket = aiLatencyBucket(duration);

    delta.latency[bucket] = (delta.latency[bucket] ?? 0) + 1;
    delta.latencyCount = 1;
    delta.latencySumMs = Math.max(0, duration);

    deltas.push(delta);

    for (const child of inner) visit(child);
  };

  // Only the real model-bearing roots start the walk; `visit` handles nesting.
  for (const span of topLevel) visit(span);

  const leftover = normalise(root.usage);
  let leftoverCost = spanCost(root, totalCost);

  for (const span of topLevel) {
    subtract(leftover, normalise(span.usage));
    leftoverCost -= spanCost(span, totalCost);
  }

  if (leftover.input + leftover.output > 0) {
    deltas.push(
      buildDelta(
        { hour: hourOf(root), agent: cut(root.name, 200), model: UNKNOWN, provider: UNKNOWN },
        root.status,
        root.error?.type,
        leftover,
        Math.max(0, leftoverCost),
      ),
    );
  }

  return deltas;
}

/** The agent, model and provider a span is counted under (names cut, `(unknown)` when missing). */
export function aiRollupNamesOf(span: Span): { agent: string; model: string; provider: string } {
  return {
    agent: cut(span.name, 200),
    model: cut(spanModelOf(span).name, 200),
    provider: cut(spanModelOf(span).provider, 100),
  };
}

/** `rollupId(key)`: first 40 hex characters of SHA-256 over `hour|agent|model|provider`. */
export function rollupId(key: RollupKey): string {
  return createHash("sha256")
    .update(`${key.hour}|${key.agent}|${key.model}|${key.provider}`)
    .digest("hex")
    .slice(0, 40);
}

/** A delta with every counter at zero for `key`. */
export function emptyRollupDelta(key: RollupKey): DevtoolsAiRollupDelta {
  return {
    hour: key.hour,
    agent: key.agent,
    model: key.model,
    provider: key.provider,
    runs: 0,
    completed: 0,
    failed: 0,
    incomplete: 0,
    cancelled: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    pricedRuns: 0,
    unpricedRuns: 0,
    unpricedTokens: 0,
    fallbackRuns: 0,
    refusals: 0,
    errors: emptyErrorCounts(),
    latency: emptyAiLatency(),
    latencyCount: 0,
    latencySumMs: 0,
  };
}

const NUMERIC_COUNTERS = [
  "runs",
  "completed",
  "failed",
  "incomplete",
  "cancelled",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "costUsd",
  "pricedRuns",
  "unpricedRuns",
  "unpricedTokens",
  "fallbackRuns",
  "refusals",
  "latencyCount",
  "latencySumMs",
] as const;

/** Adds the counters of `source` into `target` in place (keys must match). */
export function addRollupCounters(
  target: DevtoolsAiRollupDelta,
  source: DevtoolsAiRollupDelta,
): void {
  for (const field of NUMERIC_COUNTERS) target[field] += source[field];

  for (const category of Object.keys(target.errors) as (keyof typeof target.errors)[]) {
    target.errors[category] += source.errors[category] ?? 0;
  }

  addAiLatency(target.latency, source.latency);
}
