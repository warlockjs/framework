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
  enabled: boolean;
  hooks: TracingHooks[];
};

let resolved: ResolvedTracing | undefined;

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
    enabled: tracing.enabled === true,
    hooks: tracing.hooks ?? [],
  };

  return resolved;
}

/** The single boolean check every instrumented call site guards on. */
export function isTracingEnabled(): boolean {
  return resolveTracingConfig().enabled;
}

/** Test-only: forces the next `resolveTracingConfig()` call to re-read config. */
export function resetTracingConfigForTests(): void {
  resolved = undefined;
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

/** Dispatch `onRequestStart` to every configured hook. No-op when disabled. */
export function dispatchRequestStart(ctx: TracingContext): void {
  const { enabled, hooks } = resolveTracingConfig();

  if (!enabled) return;

  for (const hook of hooks) {
    safeInvoke(hook, "onRequestStart", (fn) => fn(ctx));
  }
}

/** Dispatch `onRequestEnd` to every configured hook. No-op when disabled. */
export function dispatchRequestEnd(ctx: TracingContext, result: TracingRequestEndInfo): void {
  const { enabled, hooks } = resolveTracingConfig();

  if (!enabled) return;

  for (const hook of hooks) {
    safeInvoke(hook, "onRequestEnd", (fn) => fn(ctx, result));
  }
}

/** Dispatch `onPhase` to every configured hook. No-op when disabled. */
export function dispatchPhase(ctx: TracingContext, phase: TracingPhaseInfo): void {
  const { enabled, hooks } = resolveTracingConfig();

  if (!enabled) return;

  for (const hook of hooks) {
    safeInvoke(hook, "onPhase", (fn) => fn(ctx, phase));
  }
}
