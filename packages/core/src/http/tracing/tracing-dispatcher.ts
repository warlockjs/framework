/**
 * Tracing hook dispatch.
 *
 * `http.tracing` is resolved once — lazily, on first read, then cached for
 * the life of the process — never per request. Every call site gates on
 * `isTracingEnabled()` BEFORE doing anything else (building a context
 * object, calling `performance.now()`), so a disabled app pays exactly one
 * boolean check per call site and never allocates the attrs/context payload.
 */
import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import type {
  HttpTracingConfig,
  TracingContext,
  TracingHooks,
  TracingPhaseInfo,
  TracingRequestEndInfo,
} from "./tracing.type";

type ResolvedTracing = {
  configEnabled: boolean;
  hooks: TracingHooks[];
};

let resolved: ResolvedTracing | undefined;
let tracingEnabled: boolean | undefined;
let runtimeHooks: TracingHooks[] = [];

/**
 * Minimal request shape `buildTracingContext` needs. Kept structural (not a
 * `Request` import) so this module never creates an import cycle with
 * `../request`, which itself calls into this module.
 */
export type TracingContextSource = {
  traceId: string;
  id: string;
  method: string;
  path: string;
  route?: { path: string };
};

/**
 * Resolve `http.tracing` once per process and cache it. Safe to call from
 * every hot-path call site — after the first call this is a plain field
 * read, no config lookup.
 */
export function resolveTracingConfig(): ResolvedTracing {
  if (resolved) return resolved;

  const tracing = config.get("http.tracing", {} as HttpTracingConfig) ?? {};

  resolved = {
    configEnabled: tracing.enabled === true,
    hooks: tracing.hooks ?? [],
  };
  tracingEnabled = resolved.configEnabled || runtimeHooks.length > 0;

  return resolved;
}

/** The single boolean check every instrumented call site guards on. */
export function isTracingEnabled(): boolean {
  if (tracingEnabled === undefined) resolveTracingConfig();

  return tracingEnabled === true;
}

/**
 * Register request tracing hooks independently of `http.tracing` config.
 *
 * Runtime hooks are called after configured hooks. Registering a hook enables
 * tracing immediately; the returned function removes that registration.
 */
export function registerTracingHooks(hooks: TracingHooks): () => void {
  runtimeHooks.push(hooks);
  tracingEnabled = true;

  let registered = true;

  return () => {
    if (!registered) return;

    registered = false;
    const index = runtimeHooks.indexOf(hooks);
    if (index !== -1) runtimeHooks.splice(index, 1);

    const { configEnabled } = resolveTracingConfig();
    tracingEnabled = configEnabled || runtimeHooks.length > 0;
  };
}

/** Test-only: resets resolved config and removes all runtime tracing hooks. */
export function resetTracingConfigForTests(): void {
  resolved = undefined;
  tracingEnabled = undefined;
  runtimeHooks = [];
  reportedHooks = new WeakMap();
}

/** Build the per-request context handed to every hook call. */
export function buildTracingContext(request: TracingContextSource): TracingContext {
  return {
    traceId: request.traceId,
    requestId: request.id,
    method: request.method,
    route: request.route?.path,
    path: request.path,
  };
}

/**
 * Tracks which (hook, verb) pairs have already been reported, so a hook that
 * throws on every request is reported to the error sink exactly once per
 * process rather than flooding it.
 */
let reportedHooks = new WeakMap<TracingHooks, Set<string>>();

function reportHookErrorOnce(hook: TracingHooks, verb: string, error: unknown): void {
  let reportedVerbs = reportedHooks.get(hook);

  if (!reportedVerbs) {
    reportedVerbs = new Set();
    reportedHooks.set(hook, reportedVerbs);
  }

  if (reportedVerbs.has(verb)) return;

  reportedVerbs.add(verb);

  // Never swallow the only copy of an error — but a throwing hook must never
  // break the request it was only meant to observe, so this is reported, not
  // re-thrown.
  log.error("http", "tracing-hook", error, { hook: verb });
}

function safeInvoke<Verb extends keyof TracingHooks>(
  hook: TracingHooks,
  verb: Verb,
  invoke: (fn: NonNullable<TracingHooks[Verb]>) => void,
): void {
  const fn = hook[verb];

  if (!fn) return;

  try {
    invoke(fn as NonNullable<TracingHooks[Verb]>);
  } catch (error) {
    reportHookErrorOnce(hook, verb, error);
  }
}

/** Dispatch `onRequestStart` to every configured and runtime hook. No-op when disabled. */
export function dispatchRequestStart(ctx: TracingContext): void {
  if (!isTracingEnabled()) return;

  const { hooks } = resolveTracingConfig();

  for (const hook of hooks) {
    safeInvoke(hook, "onRequestStart", (fn) => fn(ctx));
  }

  for (const hook of runtimeHooks) {
    safeInvoke(hook, "onRequestStart", (fn) => fn(ctx));
  }
}

/** Dispatch `onRequestEnd` to every configured and runtime hook. No-op when disabled. */
export function dispatchRequestEnd(ctx: TracingContext, result: TracingRequestEndInfo): void {
  if (!isTracingEnabled()) return;

  const { hooks } = resolveTracingConfig();

  for (const hook of hooks) {
    safeInvoke(hook, "onRequestEnd", (fn) => fn(ctx, result));
  }

  for (const hook of runtimeHooks) {
    safeInvoke(hook, "onRequestEnd", (fn) => fn(ctx, result));
  }
}

/** Dispatch `onPhase` to every configured and runtime hook. No-op when disabled. */
export function dispatchPhase(ctx: TracingContext, phase: TracingPhaseInfo): void {
  if (!isTracingEnabled()) return;

  const { hooks } = resolveTracingConfig();
  const phaseInfo =
    phase.startedAt === undefined
      ? {
          ...phase,
          startedAt: performance.timeOrigin + performance.now() - phase.durationMs,
        }
      : phase;

  for (const hook of hooks) {
    safeInvoke(hook, "onPhase", (fn) => fn(ctx, phaseInfo));
  }

  for (const hook of runtimeHooks) {
    safeInvoke(hook, "onPhase", (fn) => fn(ctx, phaseInfo));
  }
}
