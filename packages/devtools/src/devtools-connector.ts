/**
 * The devtools connector for `warlock.config.ts > connectors`.
 *
 * Deliberately a plain object with TYPE-ONLY imports from core: the config
 * file that constructs it must not drag core's runtime graph in at
 * config-load time. Core is imported lazily inside `boot()`, where the app
 * has already loaded it — see `queue/src/queue-connector.ts`, the pattern
 * this mirrors.
 */
import type { Connector, ConnectorLifecyclePhase } from "@warlock.js/core";
import { createCollector } from "./collector";
import { resolveDevtoolsOptions } from "./options";
import type { DevtoolsRouteRow } from "./server";
import { attachCacheSource } from "./sources/cache-source";
import { attachLogSource } from "./sources/log-source";
import { attachMailSource } from "./sources/mail-source";
import { attachQuerySource } from "./sources/query-source";
import { attachTracingSource } from "./sources/tracing-source";
import type { DevtoolsDisposer, DevtoolsOptions, DevtoolsQuery } from "./types";

/**
 * Boots after the queue connector (priority 11), which is the last
 * built-in/framework connector to claim a priority; devtools has nothing
 * that depends on it, so it simply goes last.
 */
export const DEVTOOLS_CONNECTOR_PRIORITY = 12;

/** Options accepted by `devtoolsConnector()`. */
export type DevtoolsConnectorOptions = DevtoolsOptions;

/**
 * Construct the devtools connector.
 *
 * Refuses to run outside development: `boot()` checks
 * `Application.runtimeStrategy` and, when it isn't `"development"`, logs one
 * warning and returns without mounting a route or subscribing to anything.
 * In development it attaches every source (tracing, queries, cache, mail,
 * logs), then mounts the dashboard's routes on the HTTP server — before it
 * starts listening, the only point in the boot sequence where mounting is
 * possible (see `queue/src/dashboard-boot.ts` for the same constraint).
 *
 * Apps don't call this: `warlock dev` registers it automatically when the
 * package is installed (`warlock add devtools`). Keep it OUT of
 * `warlock.config.ts` — devtools is a dev dependency, so a production
 * install doesn't have it and a config import of it would fail there.
 */
export function devtoolsConnector(options: DevtoolsConnectorOptions = {}): Connector {
  let active = false;
  const disposers: DevtoolsDisposer[] = [];

  const connector: Connector = {
    name: "devtools",
    priority: DEVTOOLS_CONNECTOR_PRIORITY,
    // Core's `ConnectorLifecyclePhase.Late`; spelled out so this module stays
    // free of a runtime import of core.
    lifecyclePhase: "late" as ConnectorLifecyclePhase,
    isActive: () => active,
    async boot() {
      const { Application, getHttpServer } = await import("@warlock.js/core");
      const { log } = await import("@warlock.js/logger");

      if (Application.runtimeStrategy !== "development") {
        log.warn(
          "devtools",
          "disabled",
          "@warlock.js/devtools only runs in development; it is not mounted",
        );
        return;
      }

      const resolved = resolveDevtoolsOptions(options);
      const collector = createCollector(resolved);

      await attachSource(log, "tracing", () => attachTracingSource(collector, resolved));
      await attachSource(log, "query", () => attachQuerySource(collector));
      await attachSource(log, "cache", () => attachCacheSource(collector));
      await attachSource(log, "mail", () => attachMailSource(collector));
      await attachSource(log, "log", () => attachLogSource(collector));

      const { mountDevtoolsRoutes } = await import("./server");

      mountDevtoolsRoutes(getHttpServer(), {
        collector,
        options: resolved,
        isDevelopment: () => Application.runtimeStrategy === "development",
        explain: (query) => explainQuery(query),
        listRoutes: () => listRoutes(),
      });

      // An N+1 is worth a terminal line, not just a badge the developer has
      // to go looking for: one warning per offending query shape, with the
      // line that issued it.
      disposers.push(
        collector.subscribe((event) => {
          if (event.type !== "request" || event.data.warningCount === 0) return;

          for (const warning of collector.getRequest(event.data.id)?.warnings ?? []) {
            const where = warning.caller ? ` — ${warning.caller.file}:${warning.caller.line}` : "";

            log.warn(
              "devtools",
              "n+1",
              `${warning.message}${where} (${event.data.method} ${event.data.path})`,
            );
          }
        }),
      );

      active = true;

      log.info("devtools", "ready", `devtools ready at ${resolved.path}`);
    },
    async start() {},
    async restart() {
      await connector.shutdown();
      await connector.start();
    },
    async shutdown() {
      for (const dispose of disposers.splice(0)) dispose();
      active = false;
    },
    shouldRestart: () => false,
  };

  /** Attaches one source, logging and continuing when it fails to attach. */
  async function attachSource(
    logger: { warn: (module: string, action: string, message: string) => unknown },
    name: string,
    attach: () => Promise<DevtoolsDisposer>,
  ): Promise<void> {
    try {
      disposers.push(await attach());
    } catch (error) {
      logger.warn(
        "devtools",
        "source-failed",
        `devtools' ${name} source failed to attach: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return connector;
}

/** Runs `EXPLAIN (FORMAT JSON)` for a stored Postgres query on its own connection. */
async function explainQuery(query: DevtoolsQuery): Promise<unknown> {
  const { dataSourceRegistry } = await import("@warlock.js/cascade");
  const dataSource = dataSourceRegistry.get(query.connection);
  const { rows } = await dataSource.raw(`EXPLAIN (FORMAT JSON) ${query.sql}`, query.bindings);

  return rows;
}

/** Lists every registered HTTP route — the same source `warlock routes --json` reads. */
async function listRoutes(): Promise<DevtoolsRouteRow[]> {
  const { router } = await import("@warlock.js/core");

  return router.list().map((route) => ({
    method: route.method.toUpperCase(),
    path: route.path,
    name: route.name,
    middleware: route.middleware?.map((middleware) => middleware.name || "anonymous"),
  }));
}
