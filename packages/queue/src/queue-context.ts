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

/**
 * The job-data envelope every dispatch writes. Version 2 is written for every
 * job, with or without a captured context, so a payload that happens to look
 * like an envelope is never read as one.
 */
export type QueueEnvelope = {
  __warlock: { v: 2; context?: unknown };
  payload: unknown;
};

/** Wrap a payload in the job-data envelope; the context is kept only when one was captured. */
export function wrapPayload(payload: unknown, context: unknown): unknown {
  const meta: QueueEnvelope["__warlock"] = { v: 2 };

  if (context !== undefined) meta.context = context;

  return { __warlock: meta, payload } satisfies QueueEnvelope;
}

/**
 * Split job data into payload and captured context.
 *
 * Version 2 envelopes are what every dispatch writes now. Version 1 envelopes
 * were only ever written when a context was captured, so jobs queued before the
 * upgrade still restore theirs. Anything else is a bare payload with no context.
 */
export function unwrapPayload(data: unknown): { payload: unknown; context: unknown } {
  const envelope = data as { __warlock?: { v?: unknown; context?: unknown } } | null;

  if (
    envelope !== null &&
    typeof envelope === "object" &&
    typeof envelope.__warlock === "object" &&
    envelope.__warlock !== null &&
    (envelope.__warlock.v === 2 || envelope.__warlock.v === 1) &&
    "payload" in envelope
  ) {
    return {
      payload: (envelope as { payload: unknown }).payload,
      context: envelope.__warlock.context,
    };
  }

  return { payload: data, context: undefined };
}
