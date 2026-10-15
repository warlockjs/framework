/**
 * Carries ambient state (tenant, request id, …) from the code that
 * dispatches a job into the worker that runs it.
 */
export type QueueContext<T> = {
  /** Read the ambient state at dispatch time; `undefined` means nothing to carry. */
  capture: () => T | undefined;
  /** Run `run` with the captured state re-established. */
  restore: (captured: T, run: () => Promise<unknown>) => Promise<unknown>;
};

/**
 * Define a queue context. `restore`'s `captured` is inferred from `capture`.
 *
 * @example
 * setQueueContext(
 *   defineQueueContext({
 *     capture: () => tenantStorage.getStore(),
 *     restore: (tenant, run) => tenantStorage.run(tenant, run),
 *   }),
 * );
 */
export function defineQueueContext<T>(context: QueueContext<T>): QueueContext<T> {
  return context;
}

let activeContext: QueueContext<any> | undefined;

/** Register the queue context used by every job dispatch and run. */
export function setQueueContext(context: QueueContext<any>): void {
  activeContext = context;
}

/** The registered queue context, if any. */
export function getQueueContext(): QueueContext<any> | undefined {
  return activeContext;
}

/** Forget the registered queue context. */
export function resetQueueContext(): void {
  activeContext = undefined;
}

/** The job-data envelope written when a context was captured. */
export type QueueEnvelope = {
  __warlock: { v: 1; context?: unknown };
  payload: unknown;
};

/** Wrap a payload with the captured context; no context leaves it bare. */
export function wrapPayload(payload: unknown, context: unknown): unknown {
  if (context === undefined) return payload;

  return { __warlock: { v: 1, context }, payload } satisfies QueueEnvelope;
}

/** Split job data into payload and captured context; bare data passes through. */
export function unwrapPayload(data: unknown): { payload: unknown; context: unknown } {
  const envelope = data as Partial<QueueEnvelope> | null;

  if (
    envelope !== null &&
    typeof envelope === "object" &&
    typeof envelope.__warlock === "object" &&
    envelope.__warlock !== null &&
    envelope.__warlock.v === 1 &&
    "payload" in envelope
  ) {
    return { payload: envelope.payload, context: envelope.__warlock.context };
  }

  return { payload: data, context: undefined };
}
