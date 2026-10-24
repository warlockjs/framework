import { LogChannel, log, type LoggingData } from "@warlock.js/logger";
import { requestContext } from "../context/request-context";
import { registerTracingHooks } from "../tracing";
import type { RequestLogQueryEvent } from "./query-shape";
import { getRequestLogConfig, isRequestLogEnabled } from "./resolve-request-log-config";
import {
  errorFromLogData,
  hasRequestLogScope,
  recordLoggedRequestLogError,
  recordRequestLogEntry,
  recordRequestLogPhase,
  recordRequestLogQuery,
  toRequestLogEntry,
} from "./request-log-scope";

/**
 * Feeds the log entries emitted during a request into its scope. Passive: it
 * persists nothing, so it never counts as a log destination.
 */
export class RequestLogCollectorChannel extends LogChannel {
  public override name = "requestLogCollector";

  public override passive = true;

  public constructor(private readonly collectLogs: boolean) {
    super();
  }

  public log(data: LoggingData): void {
    const id = this.requestIdOf(data);

    if (id === undefined || !hasRequestLogScope(id)) return;

    const error = errorFromLogData(data);

    if (error) recordLoggedRequestLogError(id, error);

    if (this.collectLogs) recordRequestLogEntry(id, toRequestLogEntry(data));
  }

  private requestIdOf(data: LoggingData): string | undefined {
    const fromContext = data.context?.requestId;

    if (typeof fromContext === "string") return fromContext;

    try {
      return requestContext.getRequest()?.id;
    } catch {
      return undefined;
    }
  }
}

type QueryEvent = RequestLogQueryEvent & { error?: unknown };

let starting: Promise<void> | undefined;
let collector: RequestLogCollectorChannel | undefined;
let stopTracing: (() => void) | undefined;
let stopQueries: (() => void) | undefined;

/**
 * Start what the request log needs to collect while requests run: the log
 * collector channel, a tracing hook for phases, and the cascade query
 * listener. Idempotent, never throws, and does nothing when the request log
 * is off.
 */
export function startRequestLog(): Promise<void> {
  if (!isRequestLogEnabled()) return Promise.resolve();

  starting ??= start().catch((error) => {
    // Reported once; the request log keeps working with what did start.
    process.stderr.write(
      `[@warlock.js/core] request log: could not start a collector: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });

  return starting;
}

async function start(): Promise<void> {
  const { include } = getRequestLogConfig();

  collector = new RequestLogCollectorChannel(include.logs);
  log.addChannel(collector);

  if (include.phases) {
    stopTracing = registerTracingHooks({
      onPhase(ctx, phase) {
        recordRequestLogPhase(ctx.requestId, {
          name: phase.name,
          durationMs: Math.round(phase.durationMs * 100) / 100,
        });
      },
    });
  }

  if (include.queries) {
    try {
      const { dataSourceRegistry } = await import("@warlock.js/cascade");
      const listener = (event: QueryEvent) => {
        const id = requestContext.getRequest()?.id;

        if (id !== undefined) recordRequestLogQuery(id, event);
      };

      dataSourceRegistry.on("query", listener);
      stopQueries = () => dataSourceRegistry.off("query", listener);
    } catch {
      // Cascade is optional for an app without a database.
    }
  }
}

/** Test-only: stop collecting and forget the runtime. */
export function resetRequestLogRuntimeForTests(): void {
  stopTracing?.();
  stopQueries?.();

  if (collector) {
    const index = log.channels.indexOf(collector);

    if (index !== -1) log.channels.splice(index, 1);
  }

  collector = undefined;
  stopTracing = undefined;
  stopQueries = undefined;
  starting = undefined;
}
