import { LogChannel, log, type LoggingData } from "@warlock.js/logger";
import type { DevtoolsDisposer, DevtoolsLogEntry } from "../../types";
import { createCaptureEngine, type DevtoolsQueryEvent } from "./engine";
import type { DevtoolsCaptureDeps, DevtoolsProductionCapture } from "./types";

/** Cache events counted for sampled requests. */
const CACHE_EVENT_TYPES = ["hit", "miss", "set", "removed", "invalidated", "flushed"] as const;

type CacheEventData = {
  key?: string;
  driver: string;
  tags?: string[];
  keys?: string[];
  durationMs?: number;
};

/** `LoggingData.type` includes `fatal`, which devtools folds into `error`. */
function toLevel(type: LoggingData["type"]): DevtoolsLogEntry["level"] {
  return type === "fatal" ? "error" : type;
}

/**
 * The production capture of this process: sampling, the bounded in-memory
 * ring of sampled requests (the live view), statistics, error groups, recent
 * logs, the sample writer and EXPLAIN.
 *
 * Unsampled requests cost one random draw at start and one comparison at
 * end; they add nothing to the statistics.
 */
export function createProductionCapture(deps: DevtoolsCaptureDeps): DevtoolsProductionCapture {
  const engine = createCaptureEngine({
    ...deps,
    warn: deps.warn ?? ((message) => log.warn("devtools", "capture", message)),
  });
  const { hooks } = engine;
  let detach: DevtoolsDisposer | undefined;

  const warnFailed = (name: string, error: unknown) => {
    log.warn(
      "devtools",
      "capture",
      `devtools' ${name} capture failed to attach: ${error instanceof Error ? error.message : String(error)}`,
    );
  };

  return {
    collector: engine.collector,
    queries: engine.queries,
    routes: engine.routes,
    errors: engine.errors,
    logs: engine.logs,
    requests: engine.requests,
    counters: engine.counters,
    explain: engine.explain,
    flush: engine.flush,

    async attach() {
      if (detach) return detach;

      const disposers: DevtoolsDisposer[] = [];

      // Reached only here so a process that never enables the monitor never loads core.
      const { currentRequestId } = await import("../../current-request-id");

      try {
        const { registerTracingHooks } = await import("@warlock.js/core");

        disposers.push(
          registerTracingHooks({
            onRequestStart: hooks.onRequestStart,
            onPhase: hooks.onPhase,
            onRequestEnd: hooks.onRequestEnd,
          }),
        );
      } catch (error) {
        warnFailed("request", error);
      }

      try {
        let dataSourceRegistry: {
          on(event: "query", listener: (event: DevtoolsQueryEvent) => void): void;
          off(event: "query", listener: (event: DevtoolsQueryEvent) => void): void;
        };

        ({ dataSourceRegistry } = await import("@warlock.js/cascade"));

        const listener = (event: DevtoolsQueryEvent) => hooks.onQuery(currentRequestId(), event);

        dataSourceRegistry.on("query", listener);
        disposers.push(() => dataSourceRegistry.off("query", listener));
      } catch {
        // Cascade is an optional peer: without it there are no queries to capture.
      }

      try {
        const channel = new (class extends LogChannel {
          public override name = "devtools-monitor";
          public active = true;

          public log(data: LoggingData): void {
            if (!this.active) return;

            hooks.onLog(currentRequestId(), {
              level: toLevel(data.type),
              module: data.module,
              action: data.action,
              message: typeof data.message === "string" ? data.message : String(data.message),
              at: Date.now(),
            });
          }
        })();

        log.addChannel(channel);
        // `Logger` cannot remove a channel: a disposed one ignores further entries.
        disposers.push(() => {
          channel.active = false;
        });
      } catch (error) {
        warnFailed("log", error);
      }

      try {
        let cache: {
          on(event: (typeof CACHE_EVENT_TYPES)[number], handler: (data: CacheEventData) => void): unknown;
          off(event: (typeof CACHE_EVENT_TYPES)[number], handler: (data: CacheEventData) => void): unknown;
        };

        ({ cache } = await import("@warlock.js/cache"));

        const handlers = CACHE_EVENT_TYPES.map((type) => {
          const handler = (data: CacheEventData) =>
            hooks.onCache(currentRequestId(), { type, driver: data.driver, at: Date.now() });

          cache.on(type, handler);

          return { type, handler };
        });

        disposers.push(() => {
          for (const { type, handler } of handlers) cache.off(type, handler);
        });
      } catch {
        // The cache package is an optional peer.
      }

      engine.startWriter();

      const dispose: DevtoolsDisposer = () => {
        for (const disposer of disposers.splice(0)) disposer();

        engine.stopWriter();
        detach = undefined;
      };

      detach = dispose;

      return dispose;
    },

    async dispose() {
      detach?.();
      await engine.flush();
    },
  };
}
