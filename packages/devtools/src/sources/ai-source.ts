import type { Trace, TraceSpan, TraceStoreContract } from "@warlock.js/ai-panoptic";
import { toSafeValue } from "../safe-value";
import type { DevtoolsDisposer } from "../types";

export const AI_INSTALL_GUIDANCE =
  "Install @warlock.js/ai and @warlock.js/ai-panoptic, then restart warlock dev. Import @warlock.js/ai-panoptic and enable ai.config({ panoptic: { observeAll: true } }). If already installed, check that both packages are compatible and can be loaded.";

export type DevtoolsAiEvent = { traceId: string; requestId?: string };

/** Only the connector's development branch constructs this source. */
export type DevtoolsAiSource =
  | { available: false; message: string; dispose: DevtoolsDisposer }
  | {
      available: true;
      store: TraceStoreContract;
      summarize: (trace: Trace) => DevtoolsAiRun;
      subscribe: (listener: (event: DevtoolsAiEvent) => void) => DevtoolsDisposer;
      dispose: DevtoolsDisposer;
    };

export type DevtoolsAiRun = {
  traceId: string;
  requestId?: string;
  sessionId?: string;
  name: string;
  status: TraceSpan["status"];
  startedAt: string;
  duration: number;
  usage: Trace["usage"];
  cost?: number;
  models: string[];
  toolCalls: number;
  retries: number;
  cacheHits?: number;
  incomplete: boolean;
  truncatedTrips: number;
  compactions: number;
  skippedCompactions: number;
  providerCompactions: number;
};

/** Summaries use root usage once: nested spans already roll up into it. */
export function summarizeAiTrace(trace: Trace, cost?: number): DevtoolsAiRun {
  const models = new Set<string>();
  let toolCalls = 0;
  let retries = 0;
  let cacheHits: number | undefined;
  let incomplete = false;
  let truncatedTrips = 0;
  let compactions = 0;
  let skippedCompactions = 0;
  let providerCompactions = 0;
  const visit = (span: TraceSpan): void => {
    const attributes = span.attributes ?? {};
    const model = attributes["agent.model.name"];
    const provider = attributes["agent.model.provider"];
    if (typeof model === "string")
      models.add(typeof provider === "string" ? `${provider}/${model}` : model);
    if (span.type === "tool") toolCalls += 1;
    if (typeof attributes.retries === "number") retries += attributes.retries;
    if (typeof attributes["agent.cacheHits"] === "number")
      cacheHits = (cacheHits ?? 0) + attributes["agent.cacheHits"];
    if (typeof attributes["agent.truncatedTrips"] === "number")
      truncatedTrips += attributes["agent.truncatedTrips"];
    if (typeof attributes["agent.providerCompactions"] === "number")
      providerCompactions += attributes["agent.providerCompactions"];
    if (Array.isArray(attributes["agent.compactions"])) {
      const records: unknown[] = attributes["agent.compactions"];
      for (const record of records) {
        if (typeof record !== "object" || record === null || !("type" in record)) continue;
        if (record.type === "applied") compactions += 1;
        if (record.type === "skipped") skippedCompactions += 1;
      }
    }
    incomplete ||=
      span.status === "incomplete" ||
      span.error?.type === "AgentIncompleteError" ||
      span.error?.type === "AGENT_INCOMPLETE";
    span.children.forEach(visit);
  };
  visit(trace.root);
  return {
    traceId: trace.traceId,
    requestId: trace.requestId,
    sessionId: trace.sessionId,
    name: trace.root.name,
    status: trace.root.status,
    startedAt: trace.startedAt,
    duration: trace.duration,
    usage: trace.usage,
    cost,
    models: [...models],
    toolCalls,
    retries,
    cacheHits,
    incomplete,
    truncatedTrips,
    compactions,
    skippedCompactions,
    providerCompactions,
  };
}

/** Content-free snapshot; never retain prompts, completions or tool arguments/results. */
function snapshotSpan(span: TraceSpan): TraceSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    traceId: span.traceId,
    sessionId: span.sessionId,
    name: span.name,
    version: span.version,
    type: span.type,
    status: span.status,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    duration: span.duration,
    usage: structuredClone(span.usage),
    error: span.error ? { type: span.error.type, message: span.error.message } : undefined,
    attributes: toSafeValue(span.attributes) as Record<string, unknown> | undefined,
    children: span.children.map(snapshotSpan),
  };
}

/**
 * Optional, lazy integration. Retains only traces collected after devtools boots,
 * using Panoptic's bounded query store; existing exporter/cache stores stay independent.
 */
export async function attachAiSource(capacity: number): Promise<DevtoolsAiSource> {
  let panoptic: typeof import("@warlock.js/ai-panoptic");
  try {
    panoptic = await import("@warlock.js/ai-panoptic");
    if (typeof panoptic.subscribeTraces !== "function")
      throw new Error("Trace subscription unavailable");
  } catch {
    return { available: false, message: AI_INSTALL_GUIDANCE, dispose() {} };
  }

  const { currentRequestId } = await import("../current-request-id");
  const store = panoptic.createInMemoryTraceStore({ capacity });
  const listeners = new Set<(event: DevtoolsAiEvent) => void>();
  const detach = panoptic.subscribeTraces((trace) => {
    // Read ALS before any asynchronous exporter work, including for runs that
    // finish after the HTTP response. Never use sessionId as a request id.
    const requestId = currentRequestId() ?? trace.requestId;
    store.add({
      ...trace,
      requestId,
      usage: structuredClone(trace.usage),
      root: snapshotSpan(trace.root),
    });
    for (const listener of listeners) {
      try {
        listener({ traceId: trace.traceId, requestId });
      } catch {
        /* isolate clients */
      }
    }
  });

  return {
    available: true,
    store,
    summarize: (trace) => summarizeAiTrace(trace, panoptic.totalCostUsd(trace.usage)),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      detach();
      listeners.clear();
      store.clear();
    },
  };
}
