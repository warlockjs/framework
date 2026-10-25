import type { DevtoolsDisposer } from "../types";

/**
 * Key `@warlock.js/ai` publishes its agent trace store under on
 * `globalThis`. Reading the store from the registry, not by importing the
 * package, keeps devtools free of an AI dependency and shares one store
 * even when two copies of the package are installed.
 */
export const AGENT_TRACES_KEY = Symbol.for("@warlock.js/ai.agentTraces");

export const AGENT_TRACE_INSTALL_GUIDANCE =
  "No agent traces yet. Install @warlock.js/ai 5.38 or newer and run an agent in development (agents record traces by default there; `trace: true` turns it on elsewhere), then reload.";

/** The part of `@warlock.js/ai`'s `AgentTrace` this panel reads; the rest passes through untouched. */
export type DevtoolsAgentTrace = {
  runId: string;
  agent: string;
  status: string;
  startedAt: string;
  durationMs?: number;
  model: { name: string; provider: string };
  usage: { input: number; output: number; total: number };
  cost?: number;
  turns: Array<{ toolCalls: Array<{ refusal?: string }> }>;
};

/** The part of `@warlock.js/ai`'s `AgentTraceStore` devtools uses. */
export type DevtoolsAgentTraceStore = {
  get(runId: string): DevtoolsAgentTrace | undefined;
  list(filter?: { limit?: number }): DevtoolsAgentTrace[];
  subscribe(listener: (event: { runId: string; status: string }) => void): () => void;
};

export type DevtoolsAgentTraceEvent = { runId: string; status: string; requestId?: string };

/** One row of the run list. */
export type DevtoolsAgentRun = {
  runId: string;
  agent: string;
  status: string;
  startedAt: string;
  durationMs?: number;
  model: string;
  turns: number;
  toolCalls: number;
  refusals: number;
  usage: { input: number; output: number };
  cost?: number;
  requestId?: string;
};

/** Reads agent traces from the shared store; the connector builds one in development only. */
export type DevtoolsAgentTraceSource = {
  /** `false` until `@warlock.js/ai` has created its store in this process. */
  available(): boolean;
  list(filter?: { requestId?: string }): DevtoolsAgentRun[];
  get(runId: string): DevtoolsAgentTrace | undefined;
  subscribe(listener: (event: DevtoolsAgentTraceEvent) => void): DevtoolsDisposer;
  dispose: DevtoolsDisposer;
};

/** One list row for a trace. */
export function summarizeAgentTrace(
  trace: DevtoolsAgentTrace,
  requestId?: string,
): DevtoolsAgentRun {
  let toolCalls = 0;
  let refusals = 0;

  for (const turn of trace.turns) {
    toolCalls += turn.toolCalls.length;
    refusals += turn.toolCalls.filter((call) => call.refusal !== undefined).length;
  }

  return {
    runId: trace.runId,
    agent: trace.agent,
    status: trace.status,
    startedAt: trace.startedAt,
    durationMs: trace.durationMs,
    model: `${trace.model.provider}/${trace.model.name}`,
    turns: trace.turns.length,
    toolCalls,
    refusals,
    usage: { input: trace.usage.input, output: trace.usage.output },
    cost: trace.cost,
    ...(requestId ? { requestId } : {}),
  };
}

const MAX_REQUEST_LINKS = 500;

/**
 * Attach to the shared agent trace store. The store is looked up lazily on
 * every call, so it works whichever of devtools and `@warlock.js/ai` loads
 * first. Runs are linked to the HTTP request that was active when the
 * store first reported them.
 */
export async function attachAgentTraceSource(): Promise<DevtoolsAgentTraceSource> {
  const { currentRequestId } = await import("../current-request-id");
  const listeners = new Set<(event: DevtoolsAgentTraceEvent) => void>();
  const requestIds = new Map<string, string>();
  let attachedStore: DevtoolsAgentTraceStore | undefined;
  let detach: (() => void) | undefined;

  const findStore = (): DevtoolsAgentTraceStore | undefined => {
    const store = (globalThis as { [AGENT_TRACES_KEY]?: DevtoolsAgentTraceStore })[
      AGENT_TRACES_KEY
    ];

    return store && typeof store.list === "function" ? store : undefined;
  };

  const ensureAttached = (): DevtoolsAgentTraceStore | undefined => {
    const store = findStore();

    if (store && store !== attachedStore) {
      detach?.();
      attachedStore = store;
      detach = store.subscribe((event) => {
        // Read the request id before anything asynchronous: the store
        // publishes synchronously from inside the agent run.
        let requestId = requestIds.get(event.runId);

        if (!requestId) {
          requestId = currentRequestId();

          if (requestId) {
            requestIds.set(event.runId, requestId);

            if (requestIds.size > MAX_REQUEST_LINKS) {
              const oldest = requestIds.keys().next();

              if (!oldest.done) requestIds.delete(oldest.value);
            }
          }
        }

        for (const listener of listeners) {
          try {
            listener({ ...event, ...(requestId ? { requestId } : {}) });
          } catch {
            /* isolate clients */
          }
        }
      });
    }

    return store;
  };

  ensureAttached();

  return {
    available: () => ensureAttached() !== undefined,

    list(filter) {
      const store = ensureAttached();

      if (!store) return [];

      return store
        .list()
        .map((trace) => summarizeAgentTrace(trace, requestIds.get(trace.runId)))
        .filter((run) => filter?.requestId === undefined || run.requestId === filter.requestId);
    },

    get: (runId) => ensureAttached()?.get(runId),

    subscribe(listener) {
      ensureAttached();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      detach?.();
      detach = undefined;
      attachedStore = undefined;
      listeners.clear();
      requestIds.clear();
    },
  };
}
