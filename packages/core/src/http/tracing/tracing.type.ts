/**
 * Vendor-neutral request-tracing hook surface (card 71622e4a).
 *
 * `core` exposes this four-verb shape and stays framework-agnostic — no
 * `@opentelemetry/api` dependency here, ever, in or out of 5.12 (see
 * `releases/v5.12-tracing-design-note.md` §1). An OTel (or any other vendor)
 * bridge is a separate, optional package that subscribes to these hooks.
 */

/**
 * Per-request identity threaded through every hook call. `route` is the
 * matched pattern (e.g. `/users/:id`), not the resolved path, so hooks can
 * group by endpoint rather than by every distinct id a client happened to
 * request; it is `undefined` until routing has matched (there is no path
 * where a hook fires before that).
 */
export type TracingContext = {
  /**
   * A valid inbound W3C `traceparent` trace id when present, otherwise
   * `request.id`. See `resolveTraceId` in `./trace-id.ts`.
   */
  traceId: string;
  /** `request.id` — the framework's own per-request correlation id. */
  requestId: string;
  method: string;
  route?: string;
  path: string;
};

/** Payload passed to `onPhase` for a single named phase of the request. */
export type TracingPhaseInfo = {
  name: string;
  durationMs: number;
  attrs?: Record<string, unknown>;
};

/** Payload passed to `onRequestEnd` once the request has settled. */
export type TracingRequestEndInfo = {
  status?: number;
  durationMs: number;
  error?: unknown;
};

/**
 * A single tracing observer. Every verb is optional — a hook that only cares
 * about phase spans need not implement `onRequestStart`/`onRequestEnd`.
 *
 * A throwing hook never breaks the request: the dispatcher catches it and
 * reports it once per hook per process to the error sink (canon 8d3c13a8),
 * then continues.
 */
export type TracingHooks = {
  onRequestStart?(ctx: TracingContext): void;
  onRequestEnd?(ctx: TracingContext, result: TracingRequestEndInfo): void;
  onPhase?(ctx: TracingContext, phase: TracingPhaseInfo): void;
};

/**
 * `http.tracing` configuration. OFF by default — resolved once at boot (see
 * `resolveTracingConfig` in `./tracing-dispatcher.ts`), so a disabled app
 * pays a single cached boolean read per call site, never a per-request
 * config lookup.
 */
export type HttpTracingConfig = {
  /** @default false */
  enabled?: boolean;
  hooks?: TracingHooks[];
};
