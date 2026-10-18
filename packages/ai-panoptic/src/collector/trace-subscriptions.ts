import type { Trace } from "../contracts/trace.type";

/** Receives a finalized trace in the collecting call's async context. Treat it as read-only. */
export type TraceListener = (trace: Trace) => void | Promise<void>;

const listeners = new Set<TraceListener>();

/**
 * Subscribe to traces from every built-in collector in this process, including
 * collectors created before subscribing. No replay or retention. Called before
 * exporter dispatch, so adapters can read request-local context synchronously.
 * Listener failures are isolated; async listeners are not awaited. The returned
 * disposer removes only this subscription. Does not enable flow observation.
 */
export function subscribeTraces(listener: TraceListener): () => void {
  const subscription: TraceListener = (trace) => listener(trace);
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
  };
}

/** Internal collector notification; pure toTrace projections never publish. */
export function publishTrace(trace: Trace): void {
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(trace)).catch(() => {});
    } catch {
      // A dashboard or adapter must never fail the originating AI run.
    }
  }
}
