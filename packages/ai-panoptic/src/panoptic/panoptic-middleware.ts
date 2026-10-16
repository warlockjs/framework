import type { AgentMiddleware } from "@warlock.js/ai";
import type { CollectorContract } from "../contracts/collector.contract";

/**
 * Build an {@link AgentMiddleware} that feeds a collector from the
 * `execute`- and `supervisor`-level hooks. An alternative wiring to event
 * subscription for apps that already compose cross-cutting concerns
 * through the agent middleware pipeline (`[cache, budget, guardrail,
 * observability]`). Declaring both hook maps lets a single middleware
 * object work uniformly on agents (which fire the `execute` map) and
 * supervisors (which fire the `supervisor` map) — registering it on a
 * supervisor would otherwise install and collect nothing silently.
 *
 * Both terminal paths are covered on each surface:
 * - `after` — fires on a run that produced a result. A run can complete
 *   with `result.error` populated (the engine still calls `after`), so
 *   the report AND the envelope error are collected; the error type and
 *   message land on the root span.
 * - `onError` — fires when the run threw before assembling a result. The
 *   error carries the partial result's report on its envelope; when
 *   present it is collected, with the error itself threaded onto the
 *   root span so failed runs still produce a trace.
 *
 * The hooks never return a value, so they never mutate the agent's /
 * supervisor's result. The `collect` call is fire-and-forget relative to
 * the run — the collector isolates exporter failures internally, and we
 * additionally swallow any rejection here so an observability fault can
 * never surface on the run's hot path.
 *
 * @param collector - the collector traces are fed into.
 * @param name - stable middleware name (kebab-case). Defaults to
 *   `"panoptic"`.
 */
export function createPanopticMiddleware(
  collector: CollectorContract,
  name = "panoptic",
): AgentMiddleware {
  const collectReport = (report: unknown, rootError?: unknown): void => {
    if (!isReport(report)) {
      return;
    }

    void collector.collect(report, rootError).catch(() => {
      // Swallow — the collector already isolates exporter failures; this
      // guard keeps an observability fault off the run's hot path.
    });
  };

  const onResult = (result: unknown): void => {
    // A run can complete with `result.error` populated (`after` still
    // fires); thread that envelope error onto the root span.
    collectReport((result as { report?: unknown }).report, (result as { error?: unknown }).error);
  };

  const onError = (error: unknown): void => {
    // A failed run's report rides on the error envelope when the engine
    // built one before throwing; collect it so failures trace, threading
    // the error itself onto the root span.
    collectReport((error as { report?: unknown }).report, error);
  };

  const terminalHooks = {
    after(_ctx: unknown, result: unknown) {
      onResult(result);
    },
    onError(_ctx: unknown, error: unknown) {
      onError(error);
    },
  };

  return {
    name,
    execute: terminalHooks as AgentMiddleware["execute"],
    supervisor: terminalHooks as AgentMiddleware["supervisor"],
  };
}

/**
 * Narrow an unknown value to a `BaseReport`-shaped object. Structural
 * (checks the lineage fields the collector reads) so it accepts any
 * primitive's report subtype without importing each concrete type.
 */
function isReport(value: unknown): value is import("@warlock.js/ai").BaseReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { runId?: unknown }).runId === "string" &&
    typeof (value as { rootRunId?: unknown }).rootRunId === "string"
  );
}
