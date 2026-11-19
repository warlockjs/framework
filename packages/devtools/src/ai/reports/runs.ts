import type { Trace, TraceSpan } from "@warlock.js/ai-panoptic";
import type {
  DevtoolsAiFailedRun,
  DevtoolsAiRunGroup,
  DevtoolsAiRunRow,
  DevtoolsAiRunsView,
} from "../../production/contracts";
import { DevtoolsApiError } from "../../production/errors";
import { classifyAiError } from "../rollup/categories";
import { aiRollupNamesOf, isAiModelSpan, traceToRollupDeltas } from "../rollup/extract";
import type { DevtoolsAiTotalCost } from "../types";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const GROUP_TRACE_IDS = 50;
const MESSAGE_LIMIT = 300;
const STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "incomplete",
  "max-iterations",
  "awaiting-input",
  "awaiting-approval",
]);
const TYPES = new Set([
  "tool",
  "callback",
  "agent",
  "workflow",
  "supervisor",
  "team",
  "orchestrator",
  "batch",
  "planner",
  "image",
  "speech",
  "transcription",
  "video",
  "realtime",
]);

/** The Panoptic helpers the Runs list uses, taken from the lazily loaded module (never a static import). */
export type DevtoolsAiRunHelpers = Pick<
  typeof import("@warlock.js/ai-panoptic"),
  | "filterTraces"
  | "groupBySession"
  | "groupByPrompt"
  | "groupByType"
  | "percentile"
  | "tracePromptKey"
>;

/** `GET api/ai/runs` query string. */
export type DevtoolsAiRunsQuery = {
  /** Text in the run name, trace id, session id or model. */
  q?: string;
  /** Comma-separated root statuses. */
  status?: string;
  /** Comma-separated root span types. */
  type?: string;
  session?: string;
  /** Exact HTTP request id the run belongs to. */
  requestId?: string;
  /** `promptName@promptVersion`. */
  prompt?: string;
  groupBy?: "session" | "prompt" | "type";
  /** 1–1000, default 200. */
  limit?: string;
};

/** The model identity a span reports, as `provider/model`. */
function modelOf(span: TraceSpan): string | null {
  const model = span.attributes?.["agent.model.name"];
  const provider = span.attributes?.["agent.model.provider"];

  if (typeof model !== "string") return null;

  return typeof provider === "string" ? `${provider}/${model}` : model;
}

/** A span's own priced cost, else the sum of its children (a wrapper root carries tokens but no cost). */
function spanCost(span: TraceSpan, totalCost: DevtoolsAiTotalCost): number | undefined {
  const own = totalCost(span.usage);

  if (own !== undefined && own > 0) return own;

  let sum: number | undefined;

  for (const child of span.children) {
    const cost = spanCost(child, totalCost);

    if (cost !== undefined) sum = (sum ?? 0) + cost;
  }

  return sum;
}

/** One Runs row for a content-free trace. */
export function toAiRunRow(
  trace: Trace,
  options: { totalCost: DevtoolsAiTotalCost; helpers: DevtoolsAiRunHelpers },
): DevtoolsAiRunRow {
  const models = new Set<string>();
  let toolCalls = 0;
  let retries = 0;
  let incomplete = false;
  const visit = (span: TraceSpan): void => {
    const model = modelOf(span);

    if (model !== null) models.add(model);

    if (span.type === "tool") toolCalls += 1;

    const spanRetries = span.attributes?.retries;

    if (typeof spanRetries === "number") retries += spanRetries;

    incomplete ||=
      span.status === "incomplete" ||
      span.error?.type === "AgentIncompleteError" ||
      span.error?.type === "AGENT_INCOMPLETE";
    span.children.forEach(visit);
  };

  visit(trace.root);

  const { usage } = trace;

  return {
    traceId: trace.traceId,
    requestId: trace.requestId ?? null,
    sessionId: trace.sessionId ?? null,
    name: trace.root.name,
    type: trace.root.type,
    status: trace.root.status,
    startedAt: trace.startedAt,
    duration: trace.duration,
    usage: {
      input: usage.input,
      output: usage.output,
      total: usage.total,
      cachedTokens: usage.cachedTokens ?? null,
      cacheWriteTokens: usage.cacheWriteTokens ?? null,
      inputIncludesCache: usage.inputIncludesCache ?? null,
    },
    cost: spanCost(trace.root, options.totalCost) ?? null,
    models: [...models],
    promptKey: options.helpers.tracePromptKey(trace) ?? null,
    toolCalls,
    retries,
    incomplete,
  };
}

function parseList(value: string | undefined, allowed: ReadonlySet<string>): string[] | undefined {
  if (value === undefined || value === "") return undefined;

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.some((item) => !allowed.has(item))) throw new DevtoolsApiError("input.invalid");

  return items;
}

function parseLimit(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_LIMIT;

  const limit = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new DevtoolsApiError("input.invalid");
  }

  return limit;
}

/**
 * Filters (Panoptic's `filterTraces` rules), groups (`groupBySession`,
 * `groupByPrompt`, `groupByType`) and summarises the stored traces. A bad
 * `limit`, `groupBy` or status throws `DevtoolsApiError("input.invalid")`.
 */
export function listAiRuns(
  traces: readonly Trace[],
  query: DevtoolsAiRunsQuery,
  options: { totalCost: DevtoolsAiTotalCost; capacity: number; helpers: DevtoolsAiRunHelpers },
): Extract<DevtoolsAiRunsView, { available: true }> {
  const { helpers, totalCost } = options;
  const limit = parseLimit(query.limit);
  const statuses = parseList(query.status, STATUSES);
  const types = parseList(query.type, TYPES);
  const groupBy = query.groupBy;

  if (
    groupBy !== undefined &&
    (groupBy as string) !== "" &&
    !["session", "prompt", "type"].includes(groupBy)
  ) {
    throw new DevtoolsApiError("input.invalid");
  }

  const requestId = query.requestId?.trim();
  const matching = helpers
    .filterTraces(
      requestId ? traces.filter((trace) => trace.requestId === requestId) : [...traces],
      {
        ...(query.q?.trim() ? { text: query.q.trim() } : {}),
        ...(statuses ? { statuses: statuses as never } : {}),
        ...(types ? { types: types as never } : {}),
        ...(query.session ? { sessionId: query.session } : {}),
        ...(query.prompt ? { promptKey: query.prompt } : {}),
      },
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || 0);
  const rows = matching.map((trace) => toAiRunRow(trace, { totalCost, helpers }));
  const rowOf = new Map(matching.map((trace, index) => [trace, rows[index]]));
  const durations = matching.map((trace) => trace.duration);
  const summarise = (key: string, members: Trace[]): DevtoolsAiRunGroup => {
    const memberRows = members.map((trace) => rowOf.get(trace));

    return {
      key,
      label: key,
      runs: members.length,
      failed: members.filter((trace) => trace.root.status === "failed").length,
      estimatedCostUsd: memberRows.reduce((sum, row) => sum + (row?.cost ?? 0), 0),
      p95Ms:
        members.length > 0
          ? helpers.percentile(
              members.map((trace) => trace.duration),
              95,
            )
          : null,
      traceIds: members.slice(0, GROUP_TRACE_IDS).map((trace) => trace.traceId),
    };
  };
  let groups: DevtoolsAiRunGroup[] | null = null;

  if (groupBy === "session") {
    groups = helpers
      .groupBySession(matching)
      .map((group) => summarise(group.sessionId, group.traces));
  } else if (groupBy === "prompt") {
    groups = helpers
      .groupByPrompt(matching)
      .map((group) => summarise(group.promptKey, group.traces));
  } else if (groupBy === "type") {
    groups = helpers.groupByType(matching).map((group) => summarise(group.type, group.traces));
  }

  return {
    available: true,
    runs: rows.slice(0, limit),
    groups,
    stats: {
      count: matching.length,
      failed: matching.filter((trace) => trace.root.status === "failed").length,
      estimatedCostUsd: rows.reduce((sum, row) => sum + (row.cost ?? 0), 0),
      // A run with any model call that used tokens without pricing, by the same rule as the rollups.
      unpricedRuns: matching.filter((trace) =>
        traceToRollupDeltas(trace, totalCost).some((delta) => delta.unpricedRuns > 0),
      ).length,
      p50Ms: durations.length > 0 ? helpers.percentile(durations, 50) : null,
      p95Ms: durations.length > 0 ? helpers.percentile(durations, 95) : null,
    },
    capacity: options.capacity,
  };
}

const FAILED_STATUSES: ReadonlySet<string> = new Set(["failed", "incomplete", "max-iterations"]);

/** What the Errors page scopes recent failures by: its range and filters (names as the rollups count them). */
export type DevtoolsAiRecentFailuresFilter = {
  from: number;
  to: number;
  agent?: string;
  provider?: string;
  model?: { provider: string; model: string };
};

/**
 * The newest failed model spans (the same spans the rollups count as runs)
 * of the stored traces, at most `limit`, newest first (Errors page,
 * development). `model` is `provider/model` as the Models page keys it.
 * With a filter, only failures that ended inside its range and match its
 * agent, provider and model are listed.
 */
export function recentAiFailures(
  traces: readonly Trace[],
  limit: number,
  filter?: DevtoolsAiRecentFailuresFilter,
): DevtoolsAiFailedRun[] {
  const failures: DevtoolsAiFailedRun[] = [];

  for (const trace of traces) {
    const visit = (span: TraceSpan): void => {
      if (isAiModelSpan(span) && FAILED_STATUSES.has(span.status)) {
        const parsedEnd = Date.parse(span.endedAt);
        const endedAt = Number.isNaN(parsedEnd) ? Date.parse(trace.endedAt) || 0 : parsedEnd;
        const names = aiRollupNamesOf(span);
        const matches =
          !filter ||
          (endedAt >= filter.from &&
            endedAt < filter.to &&
            (filter.agent === undefined || names.agent === filter.agent) &&
            (filter.provider === undefined || names.provider === filter.provider) &&
            (filter.model === undefined ||
              (names.provider === filter.model.provider && names.model === filter.model.model)));

        if (matches) {
          const message = span.error?.message;

          failures.push({
            traceId: trace.traceId,
            agent: span.name,
            model:
              typeof span.attributes?.["agent.model.name"] === "string"
                ? `${names.provider}/${names.model}`
                : null,
            status: span.status,
            category: classifyAiError(span.status, span.error?.type),
            code: span.error?.type ?? null,
            message: typeof message === "string" ? message.slice(0, MESSAGE_LIMIT) : null,
            endedAt,
            requestId: trace.requestId ?? null,
          });
        }
      }

      span.children.forEach(visit);
    };

    visit(trace.root);
  }

  return failures.sort((a, b) => b.endedAt - a.endedAt).slice(0, Math.max(0, limit));
}
