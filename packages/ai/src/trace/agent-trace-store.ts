import type { AgentTrace, AgentTraceEvent, AgentTraceStore } from "./agent-trace.type";

const DEFAULT_CAPACITY = 100;

/**
 * A bounded in-memory trace store. The oldest run is dropped once
 * `capacity` is reached. Listeners are isolated: one that throws does not
 * stop the others or the run.
 *
 * @example
 * const store = createAgentTraceStore({ capacity: 20 });
 * ai.agent({ model, trace: { store } });
 */
export function createAgentTraceStore(options: { capacity?: number } = {}): AgentTraceStore {
  const capacity =
    options.capacity !== undefined && Number.isInteger(options.capacity) && options.capacity > 0
      ? options.capacity
      : DEFAULT_CAPACITY;
  const traces = new Map<string, AgentTrace>();
  const listeners = new Set<(event: AgentTraceEvent) => void>();

  return {
    capacity,

    publish(trace) {
      // Re-insert so a finished run moves to the newest position.
      traces.delete(trace.runId);
      traces.set(trace.runId, trace);

      while (traces.size > capacity) {
        const oldest = traces.keys().next();

        if (oldest.done) break;
        traces.delete(oldest.value);
      }

      for (const listener of listeners) {
        try {
          listener({ runId: trace.runId, status: trace.status });
        } catch {
          // A broken listener must not break the run.
        }
      }
    },

    get: (runId) => traces.get(runId),

    list(filter = {}) {
      const rows = [...traces.values()]
        .reverse()
        .filter(
          (trace) =>
            (filter.agent === undefined || trace.agent === filter.agent) &&
            (filter.status === undefined || trace.status === filter.status),
        );

      return filter.limit !== undefined ? rows.slice(0, filter.limit) : rows;
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    clear() {
      traces.clear();
    },
  };
}

const SHARED_KEY = Symbol.for("@warlock.js/ai.agentTraces");

type SharedGlobal = { [SHARED_KEY]?: AgentTraceStore };

function sharedStore(): AgentTraceStore {
  // Keyed on the global registry so a second copy of this package (a
  // dependency tree that did not dedupe) records into, and devtools reads
  // from, the same store.
  const holder = globalThis as SharedGlobal;

  holder[SHARED_KEY] ??= createAgentTraceStore();

  return holder[SHARED_KEY];
}

/**
 * The shared store agents record into by default. Devtools and
 * `warlock ai trace` read it.
 *
 * @example
 * const trace = agentTraces.get(result.report.runId);
 */
export const agentTraces: AgentTraceStore = sharedStore();
