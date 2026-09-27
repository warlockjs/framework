import type { TracingContext, TracingPhaseInfo, TracingRequestEndInfo } from "@warlock.js/core";
import type { DevtoolsCollector, DevtoolsDisposer, ResolvedDevtoolsOptions } from "../types";

/**
 * Feeds request timelines from core's tracing hooks into the collector: one
 * `startRequest`/`endRequest` pair per HTTP request, with every named phase
 * in between. Requests to the dashboard's own path are never recorded, so
 * the dashboard never watches itself.
 */
export async function attachTracingSource(
  collector: DevtoolsCollector,
  options: ResolvedDevtoolsOptions,
): Promise<DevtoolsDisposer> {
  const { registerTracingHooks } = await import("@warlock.js/core");

  const isDashboardPath = (path: string): boolean => path.startsWith(options.path);

  return registerTracingHooks({
    onRequestStart(ctx: TracingContext) {
      if (isDashboardPath(ctx.path)) return;

      collector.startRequest({
        id: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        route: ctx.route,
        startedAt: performance.timeOrigin + performance.now(),
      });
    },
    onPhase(ctx: TracingContext, phase: TracingPhaseInfo) {
      if (isDashboardPath(ctx.path)) return;

      collector.addPhase(ctx.requestId, {
        name: phase.name,
        durationMs: phase.durationMs,
        startedAt: phase.startedAt ?? performance.timeOrigin + performance.now() - phase.durationMs,
        attrs: phase.attrs,
      });
    },
    onRequestEnd(ctx: TracingContext, result: TracingRequestEndInfo) {
      if (isDashboardPath(ctx.path)) return;

      collector.endRequest(ctx.requestId, {
        status: result.status,
        durationMs: result.durationMs,
        error:
          result.error === undefined
            ? undefined
            : result.error instanceof Error
              ? result.error.message
              : String(result.error),
        route: ctx.route,
      });
    },
  });
}
