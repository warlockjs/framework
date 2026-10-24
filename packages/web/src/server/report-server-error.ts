/**
 * THE server-side error reporting seam (card 1db238ca, audit §1.1-1.2, Aria's
 * binding 5.17 ruling). Every server error path in `web` — render, loader,
 * defer, error-page, and the top-level request-handler catch — funnels
 * through {@link reportServerError}, which does two things, in this order,
 * on every call:
 *
 *   1. Writes an UNCONDITIONAL line to stderr — the pre-existing floor this
 *      function already was before this card, and still the ONE thing that
 *      can never be silenced by app config alone.
 *   2. Fire-and-forget hands the error to the app-owned `web.errors.report()`
 *      hook, when one is configured (`./error-reporting-config.ts`), through
 *      a bounded queue that NEVER blocks the response and never lets a
 *      throwing/rejecting reporter recurse back into this module.
 *
 * DEDUPE: the same Error OBJECT reported twice in one request (a render
 * failure whose defer path also observes it, for example) reaches the app
 * hook exactly once, and is logged exactly once: the first observer writes the
 * log line (with its phase), later observers of the same object write nothing.
 *
 * QUEUE: `./bounded-task-queue.ts`'s `BoundedTaskQueue` bounds this on TWO
 * axes, not one — at most {@link REPORT_CONCURRENCY} calls to the app hook
 * are ever ACTUALLY IN FLIGHT at once, and at most {@link MAX_QUEUED_REPORTS}
 * more NOT-YET-STARTED reports may wait their turn behind those. A report
 * that would overflow the queue drops the OLDEST QUEUED (never-started, never
 * an already-active) report and counts the drop; as each in-flight call
 * settles, the next queued report is dequeued and started. This is what
 * keeps the number of ACTIVE reporter calls bounded even when far more than
 * {@link MAX_QUEUED_REPORTS} reports arrive — the earlier "drop from the
 * active set, then start a new call anyway" shape let active calls grow
 * without bound. Nothing here is ever awaited by a caller on the response
 * path — see `create-page-route-handler.ts` and friends, none of which
 * `await reportServerError(...)`.
 *
 * ISOLATION: a reporter that throws synchronously or returns a rejected
 * promise is caught exactly once, logged once via `console.error`, and never
 * fed back into `web.errors.report()` for that same failure — there is no
 * path from a reporter's own failure back into this module's dispatch.
 *
 * SHUTDOWN: {@link flushPendingServerErrorReports} awaits every pending
 * report, capped at a timeout, so a graceful shutdown (`web-connector.ts`'s
 * `shutdown()`) gives in-flight reports a bounded chance to finish instead of
 * the process exiting mid-flight and dropping them silently.
 */
import { config, log } from "@warlock.js/core";
import type { PageErrorDetails } from "../components/document-context";
import { BoundedTaskQueue } from "./bounded-task-queue";
import type { ServerErrorContext } from "./error-reporting-config";
import { currentPageErrorScope } from "./page-error-scope";

/** Concurrency limit — at most this many app-hook calls are ever ACTIVE at once. */
const REPORT_CONCURRENCY = 10;

/** Bounded queue size for NOT-yet-started reports (Aria's ruling: "e.g. max 100 pending"). */
const MAX_QUEUED_REPORTS = 100;

/** Stamped onto an already-reported error object — see the file header's DEDUPE note. */
const REPORTED_TO_APP_HOOK = Symbol.for("warlock.web.errorReportedToAppHook");

let droppedReportCount = 0;

function createReportQueue(): BoundedTaskQueue {
  return new BoundedTaskQueue({
    concurrency: REPORT_CONCURRENCY,
    maxQueued: MAX_QUEUED_REPORTS,
    onDrop: () => {
      droppedReportCount += 1;

      console.error(
        `[warlock:web] error report queue is full (${MAX_QUEUED_REPORTS} pending); dropped the ` +
          `oldest pending report (${droppedReportCount} dropped in total this process).`,
      );
    },
  });
}

let reportQueue = createReportQueue();

/**
 * `true` when `thrown` already carries the dedupe marker; stamps it
 * otherwise. Swallows a `TypeError` from a frozen/non-extensible `thrown` —
 * such a value simply cannot be deduped, and that is a smaller problem than
 * this bookkeeping ever throwing on the error-reporting path itself.
 */
function alreadyReportedToAppHook(thrown: unknown): boolean {
  if (typeof thrown !== "object" || thrown === null) return false;

  const record = thrown as Record<PropertyKey, unknown>;

  try {
    if (record[REPORTED_TO_APP_HOOK] === true) return true;

    record[REPORTED_TO_APP_HOOK] = true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget dispatch to the configured `web.errors.report()` hook.
 * Never throws, never rejects, never returns anything a caller could await
 * into the response path — the whole point of this function is that nothing
 * calls it with `await`. The actual bounding — concurrency AND queue size —
 * lives in {@link reportQueue}; this function only builds the lazy task and
 * hands it over.
 */
function enqueueAppHookReport(thrown: unknown, context: ServerErrorContext): void {
  const report = config.get("web", {}).errors?.report;
  if (report === undefined) return;
  if (alreadyReportedToAppHook(thrown)) return;

  reportQueue.push(() =>
    Promise.resolve()
      .then(() => report(thrown, context))
      .catch((reporterError) => {
        // ISOLATION: logged once, directly, via `console.error` — never routed
        // back through `reportServerError`/the app hook for THIS failure, so a
        // reporter that always throws can never recurse into itself.
        console.error(
          "[warlock:web] web.errors.report() threw or rejected; the report was not retried:",
          reporterError,
        );
      }),
  );
}

/** Registry symbol for the stack mapper; see {@link setServerStackFixer}. */
const STACK_FIXER = Symbol.for("warlock.web.serverStackFixer");

type StackFixer = (error: Error) => void;

/**
 * Register the function that maps a thrown error's stack back to source files
 * (the dev server's `ssrFixStacktrace`). Held on a registry symbol because the
 * dev connector and the page pipeline run in two module copies. Production
 * stacks are mapped by Node itself when it runs with `--enable-source-maps`.
 */
export function setServerStackFixer(fixer: StackFixer | undefined): void {
  (globalThis as Record<symbol, unknown>)[STACK_FIXER] = fixer;
}

function mappedStack(thrown: Error): string | undefined {
  const fixer = (globalThis as Record<symbol, unknown>)[STACK_FIXER] as StackFixer | undefined;

  try {
    fixer?.(thrown);
  } catch {
    // Mapping is best effort; the raw stack is still better than none.
  }

  return typeof thrown.stack === "string" ? thrown.stack : undefined;
}

/**
 * The facts about one failure: the error plus the stage, page file, route and
 * site it belongs to. The file, route and site fall back to the request's
 * {@link currentPageErrorScope} when the call site did not name them. Used for
 * the log record and, outside production, for the error page's `debug` prop.
 */
export function describeServerError(
  thrown: unknown,
  context: Pick<ServerErrorContext, "phase" | "level" | "file" | "routePath" | "site" | "requestId">,
): PageErrorDetails {
  const scope = currentPageErrorScope();
  const error = thrown instanceof Error ? thrown : undefined;
  let message: string;

  try {
    message = error?.message ?? (typeof thrown === "string" ? thrown : String(thrown));
  } catch {
    message = "An unexpected error occurred.";
  }

  const stack = error === undefined ? undefined : mappedStack(error);
  const file = context.file ?? scope?.file;
  const routePath = context.routePath ?? scope?.routePath;
  const site = context.site ?? scope?.site;

  return {
    name: error?.name || "Error",
    message,
    ...(stack === undefined ? {} : { stack }),
    phase: context.phase,
    ...(context.level === undefined ? {} : { level: context.level }),
    ...(file === undefined ? {} : { file }),
    ...(routePath === undefined ? {} : { routePath }),
    ...(site === undefined ? {} : { site }),
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}

/** Errors already logged, so a failure several stages observe is logged once. */
const loggedErrors = new WeakSet<object>();

/**
 * Unconditional log for a server-side failure that must never be silenced by
 * a configurable sink alone. Every server error path in `web` (loader and
 * middleware throws, render and stream failures, deferred rejections, the
 * top-level request-handler catch) calls this SAME function, so there is
 * exactly one log writer and exactly one dispatch point to the app-owned
 * `web.errors.report()` hook — see the file header.
 *
 * The line goes to the framework logger at `error` level, with the record
 * from {@link describeServerError} (message, stack, page file, route, site,
 * phase, request id) as its context. With no log channel configured, the same
 * failure goes to `console.error`, so it always reaches the terminal.
 *
 * `context` is required, not optional: every call site knows at minimum
 * which failure class it is (`kind`) and which pipeline stage it is in
 * (`phase`) — see `./error-reporting-config.ts`.
 */
export function reportServerError(
  message: string,
  thrown: unknown,
  context: ServerErrorContext,
): void {
  const scope = currentPageErrorScope();

  if (scope !== undefined) scope.reported = true;

  // One failure, one line: the same error object seen by several stages
  // (a render throw the escalation loop then wraps in an error record) is
  // logged and reported to the app hook by its first observer only.
  if (typeof thrown === "object" && thrown !== null) {
    if (loggedErrors.has(thrown)) return;

    loggedErrors.add(thrown);
  }

  const details = describeServerError(thrown, context);

  log.error({
    module: "web",
    action: `page.${context.phase}`,
    message: `${message}: ${details.message}`,
    context: {
      ...details,
      kind: context.kind,
      method: context.method,
      pathname: context.pathname,
      ...(context.routeName === undefined ? {} : { routeName: context.routeName }),
      ...(context.statusCode === undefined ? {} : { statusCode: context.statusCode }),
    },
  });

  // With no log channel configured the record above goes nowhere; the
  // terminal still gets the failure.
  if (log.channels.length === 0) console.error(`[warlock:web] ${message}:`, thrown);

  enqueueAppHookReport(thrown, {
    ...context,
    ...(details.file === undefined ? {} : { file: details.file }),
    ...(details.site === undefined ? {} : { site: details.site }),
    ...(details.routePath === undefined ? {} : { routePath: details.routePath }),
  });
}

/**
 * Await every pending `web.errors.report()` call, capped at `timeoutMs`
 * total (Aria's ruling: "shutdown flush ... with a cap, e.g. 2s total").
 * Called from `WebConnector.shutdown()` so a graceful shutdown gives
 * in-flight reports a bounded chance to finish rather than the process
 * exiting mid-flight and losing them silently. Never throws — a reporter
 * failure is already isolated and logged by {@link enqueueAppHookReport}.
 */
export async function flushPendingServerErrorReports(timeoutMs = 2000): Promise<void> {
  if (reportQueue.activeCount === 0 && reportQueue.queuedCount === 0) return;

  await reportQueue.drain(timeoutMs);
}

/** Test-only: how many `web.errors.report()` calls are still pending, active + queued. */
export function pendingServerErrorReportCount(): number {
  return reportQueue.activeCount + reportQueue.queuedCount;
}

/** Test-only: how many `web.errors.report()` calls are ACTUALLY in flight right now. */
export function activeServerErrorReportCallCount(): number {
  return reportQueue.activeCount;
}

/** Test-only: how many reports are queued, not yet started. */
export function queuedServerErrorReportCount(): number {
  return reportQueue.queuedCount;
}

/** Test-only: how many pending reports have been dropped for exceeding the bound. */
export function droppedServerErrorReportCount(): number {
  return droppedReportCount;
}

/** Test-only: reset queue/drop-count state between specs. */
export function resetServerErrorReportingStateForTests(): void {
  reportQueue.reset();
  reportQueue = createReportQueue();
  droppedReportCount = 0;
}
