import { applyRedact, log } from "@warlock.js/logger";
import { captureCallerLocation } from "../caller-location";
import { currentRequestId } from "../current-request-id";
import { toSafeValue } from "../safe-value";
import type { DevtoolsCollector, DevtoolsDisposer } from "../types";

/** The shape of the event `dataSourceRegistry` emits for `"query"`. */
type QueryEvent = {
  connection: string;
  driver: "postgres" | "mongodb";
  sql?: string;
  bindings?: unknown[];
  collection?: string;
  command?: string;
  pipeline?: unknown;
  durationMs: number;
  startedAt: number;
  rowCount?: number;
  error?: unknown;
};

/** Redacts query bindings through the logger's redaction rules. */
function redactBindings(bindings: unknown[] | undefined): unknown[] | undefined {
  if (!bindings) return bindings;

  const redacted = applyRedact(
    {
      type: "debug",
      module: "devtools",
      action: "query",
      message: undefined,
      context: { bindings },
    },
    log.getRedact(),
  );

  return (redacted.context as { bindings: unknown[] }).bindings;
}

/**
 * Feeds every settled database query, from cascade's data source registry,
 * into the collector. A no-op when `@warlock.js/cascade` isn't installed —
 * it is an optional peer.
 */
export async function attachQuerySource(collector: DevtoolsCollector): Promise<DevtoolsDisposer> {
  let dataSourceRegistry: {
    on(event: "query", listener: (event: QueryEvent) => void): void;
    off(event: "query", listener: (event: QueryEvent) => void): void;
  };

  try {
    ({ dataSourceRegistry } = await import("@warlock.js/cascade"));
  } catch {
    return () => {};
  }

  const listener = (event: QueryEvent) => {
    collector.addQuery(currentRequestId(), {
      connection: event.connection,
      driver: event.driver,
      sql: event.sql,
      bindings: toSafeValue(redactBindings(event.bindings)) as unknown[] | undefined,
      collection: event.collection,
      command: event.command,
      pipeline: event.pipeline,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      rowCount: event.rowCount,
      error:
        event.error === undefined
          ? undefined
          : event.error instanceof Error
            ? event.error.message
            : String(event.error),
      caller: captureCallerLocation(),
    });
  };

  dataSourceRegistry.on("query", listener);

  return () => dataSourceRegistry.off("query", listener);
}
