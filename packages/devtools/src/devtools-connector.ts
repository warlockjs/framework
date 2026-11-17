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
import { checkDevtoolsPanels, loadDevtoolsPanels } from "./panels";
import { loadProcessPanel, processesDevtoolsPanel } from "./process-panel";
import { createCollector } from "./collector";
import { resolveDevtoolsOptions } from "./options";
import { DEVTOOLS_PRODUCTION_DEFAULTS } from "./production/options";
import type { DevtoolsRequestLogSource, DevtoolsRouteRow, MountDevtoolsRoutesDeps } from "./server";
import { attachAgentTraceSource } from "./sources/agent-trace-source";
import { attachAiSource } from "./sources/ai-source";
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

/**
 * The app's `src/config/devtools.ts`, or `{}` when there is none (or the
 * config store cannot be read, which must never stop the dev server).
 */
function readConfiguredOptions(readConfig: () => { get(name: string): unknown }): DevtoolsOptions {
  try {
    const value = readConfig().get("devtools");

    return value !== null && typeof value === "object" ? (value as DevtoolsOptions) : {};
  } catch {
    return {};
  }
}

/** Options accepted by `devtoolsConnector()`. */
export type DevtoolsConnectorOptions = DevtoolsOptions;

/**
 * Construct the devtools connector.
 *
 * Outside development, `boot()` checks `Application.runtimeStrategy` and
 * `devtools.production.enabled`: unless both say production, it logs one
 * warning and returns without mounting a route or subscribing to anything.
 * With `enabled: true` in production it starts the signed-in production
 * monitor (`bootProductionDevtools`), which refuses to boot when its
 * configuration is incomplete. In development it attaches every source
 * (tracing, queries, cache, mail, logs), loads the panels listed in the
 * `panels` option, then mounts the dashboard's routes on the HTTP server —
 * before it starts listening, the only point in the boot sequence where
 * mounting is possible (see `queue/src/dashboard-boot.ts` for the same
 * constraint).
 *
 * In development apps don't call this: `warlock dev` registers it
 * automatically when the package is installed (`warlock add devtools`). To
 * run the production monitor, list `devtoolsConnector()` in
 * `warlock.config.ts > connectors` (and keep the package in `dependencies`).
 * Options come from the app's `src/config/devtools.ts` (a plain object, no
 * import of this package); options passed here win over it.
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
      const core = await import("@warlock.js/core");
      const { Application, getHttpServer } = core;
      const { log } = await import("@warlock.js/logger");

      const resolved = resolveDevtoolsOptions({
        ...readConfiguredOptions(() => core.config),
        ...options,
      });

      if (Application.runtimeStrategy === "production" && resolved.production?.enabled === true) {
        disposers.push(await bootProduction(core, log, resolved));
        active = true;

        return;
      }

      if (Application.runtimeStrategy !== "development") {
        log.warn(
          "devtools",
          "disabled",
          "@warlock.js/devtools only runs in development unless devtools.production.enabled is true; it is not mounted",
        );
        return;
      }

      const collector = createCollector(resolved);

      await attachSource(log, "tracing", () => attachTracingSource(collector, resolved));
      await attachSource(log, "query", () => attachQuerySource(collector));
      await attachSource(log, "cache", () => attachCacheSource(collector));
      await attachSource(log, "mail", () => attachMailSource(collector));
      await attachSource(log, "log", () => attachLogSource(collector));

      const ai = await attachAiSource(resolved.maxRequests);
      disposers.push(ai.dispose);

      const agentTraces = await attachAgentTraceSource();
      disposers.push(agentTraces.dispose);

      const { mountDevtoolsRoutes } = await import("./server");
      const postmanBuilder = await findPostmanBuilder();
      const requestLog = await findRequestLogSource();
      const processPanel = await loadProcessPanel();
      const builtIn = processesDevtoolsPanel(processPanel);
      // A panel that fails to load or reuses an id is reported and left out;
      // it never stops the dashboard or the app.
      const panels = await loadDevtoolsPanels(resolved.panels ?? [], {
        root: "rootPath" in core ? core.rootPath() : process.cwd(),
        warn: (message) => log.warn("devtools", "panel", message),
        taken: new Map([[builtIn.id, builtIn.title]]),
      });

      const insightsWiring = await wireDevelopmentInsights(collector, resolved, log, disposers);

      mountDevtoolsRoutes(getHttpServer(), {
        collector,
        ai,
        agentTraces,
        ...(processPanel ? { processPanel } : {}),
        panels,
        options: resolved,
        ...insightsWiring,
        requestLog,
        isDevelopment: () => Application.runtimeStrategy === "development",
        warn: (message) => log.warn("devtools", "refused", message),
        explain: (query) => explainQuery(query),
        listRoutes: () => listRoutes(),
        getOpenApiDocument: () => getOpenApiDocument(),
        getPostmanCollection: postmanBuilder
          ? async () => unwrapCollection(await postmanBuilder())
          : undefined,
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

type ConnectorLogger = {
  info: (module: string, action: string, message: string) => unknown;
  warn: (module: string, action: string, message: string) => unknown;
  error: (module: string, action: string, message: string) => unknown;
};

/**
 * Development: the statistics, resources, health and jobs behind the
 * Resources, Queries (statistics), Routes (statistics), Errors, Health and
 * Jobs tabs. Wrapped as a whole: when anything fails to start, one line is
 * logged and the dashboard mounts without insights (those tabs then say they
 * are not available). It never stops the dashboard.
 */
async function wireDevelopmentInsights(
  collector: ReturnType<typeof createCollector>,
  resolved: ReturnType<typeof resolveDevtoolsOptions>,
  log: ConnectorLogger,
  disposers: DevtoolsDisposer[],
): Promise<Pick<MountDevtoolsRoutesDeps, "instance" | "insights" | "explainShape">> {
  const stops: DevtoolsDisposer[] = [];

  try {
    const capture = await import("./production/capture");
    const insights = await import("./production/insights");
    const instance = insights.createInstanceInfo();
    const queries = capture.createQueryStats({
      maxShapes: DEVTOOLS_PRODUCTION_DEFAULTS.maxShapes,
      instance: instance.id,
    });
    const routes = capture.createRouteStats({
      maxRoutes: DEVTOOLS_PRODUCTION_DEFAULTS.maxRoutes,
      instance: instance.id,
    });
    const errors = capture.createErrorGroups({
      maxGroups: DEVTOOLS_PRODUCTION_DEFAULTS.maxErrorGroups,
    });
    const logs = capture.createRecentLogs({ maxEntries: 200 });

    stops.push(
      capture.attachDevelopmentStats(collector, {
        queries,
        routes,
        errors,
        logs,
        nPlusOneThreshold: resolved.nPlusOneThreshold,
      }),
    );

    const resources = insights.createResourceMonitor();
    const health = insights.createHealthHistory();

    resources.start();
    health.start();
    stops.push(
      () => resources.stop(),
      () => health.stop(),
    );

    const reporter = insights.createLocalReporter({
      instance,
      resources,
      health,
      jobs: insights.createJobsReader(),
      queries,
      routes,
      errors,
      logs,
      counters: null,
    });
    const explainShape = capture.createShapeExplainer({
      queries,
      executing: false,
      instance: instance.id,
    });

    disposers.push(...stops);

    return { instance, insights: insights.createLocalInsights(reporter), explainShape };
  } catch (error) {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        // Cleanup after a failed start must not hide the reason.
      }
    }

    log.warn(
      "devtools",
      "insights-failed",
      `devtools' statistics could not start, so the Resources, Queries, Routes, Errors, Health and Jobs tabs are not available: ${error instanceof Error ? error.message : String(error)}`,
    );

    return {};
  }
}

/**
 * Starts the production monitor: loads the panels in production mode and
 * hands everything to `bootProductionDevtools`, which refuses to boot (throws
 * `DevtoolsProductionConfigError`) when the configuration is incomplete.
 */
async function bootProduction(
  core: typeof import("@warlock.js/core"),
  log: ConnectorLogger,
  resolved: ReturnType<typeof resolveDevtoolsOptions>,
): Promise<DevtoolsDisposer> {
  const { bootProductionDevtools } = await import("./production/boot");
  const requestLog = await findRequestLogSource();
  // The Processes panel reads an app file; load it only when the project turned that tab on.
  const processPanel =
    resolved.production?.panels?.processes === true ? await loadProcessPanel() : undefined;
  const builtIn = processesDevtoolsPanel(processPanel);
  const packagePanels = await loadDevtoolsPanels(resolved.panels ?? [], {
    root: "rootPath" in core ? core.rootPath() : process.cwd(),
    warn: (message) => log.warn("devtools", "panel", message),
    taken: new Map([[builtIn.id, builtIn.title]]),
    mode: "production",
  });
  // `warlock start` registers no development OpenAPI provider: the API tab, when turned on, builds its own.
  const { createProductionOpenApi } = await import("./production/openapi");
  const openApi = createProductionOpenApi(core);

  return bootProductionDevtools({
    options: resolved,
    env: process.env,
    server: core.getHttpServer(),
    panels: [...checkDevtoolsPanels([builtIn]), ...packagePanels],
    routes: {
      ...(processPanel ? { processPanel } : {}),
      ...(requestLog ? { requestLog } : {}),
      listRoutes: () => listRoutes(),
      getOpenApiDocument: openApi.getOpenApiDocument,
      getPostmanCollection: openApi.getPostmanCollection,
    },
    log,
  });
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

/**
 * Builds the OpenAPI 3.1 document from the routes registered in this process —
 * the same generator behind `warlock generate.openapi`. Core is imported
 * lazily so this module stays free of a load-time dependency on it.
 */
async function getOpenApiDocument(): Promise<object> {
  const { getDevelopmentOpenApiDocument } = await import("@warlock.js/core");
  const { document } = await getDevelopmentOpenApiDocument();

  return document;
}

type PostmanBuilder = () => Promise<unknown>;

/**
 * Looks up core's Postman collection builder, `getDevelopmentPostmanCollection`.
 * Older cores do not export it; the route then answers 503. The lookup is
 * guarded because a namespace without the export may throw on access. Core is
 * imported lazily, like the OpenAPI document above.
 */
async function findPostmanBuilder(): Promise<PostmanBuilder | undefined> {
  try {
    const core: Record<string, unknown> = await import("@warlock.js/core");
    const build = core.getDevelopmentPostmanCollection;

    return typeof build === "function" ? (build as PostmanBuilder) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Looks up core's persistent request log reader. Older cores do not export
 * it; the dashboard then shows the in-memory requests only. Core is imported
 * lazily, like the builders above.
 */
async function findRequestLogSource(): Promise<DevtoolsRequestLogSource | undefined> {
  try {
    const core: Record<string, unknown> = await import("@warlock.js/core");
    const { listRequestLogs, getRequestLog, requestLogToCurl, compileRequestLogFilter } = core;

    if (
      typeof listRequestLogs !== "function" ||
      typeof getRequestLog !== "function" ||
      typeof requestLogToCurl !== "function" ||
      typeof compileRequestLogFilter !== "function"
    ) {
      return undefined;
    }

    return {
      list: (filter) => listRequestLogs(filter),
      get: (id) => getRequestLog(id),
      curl: (record, baseUrl) => requestLogToCurl(record, baseUrl),
      compile: (filter) => compileRequestLogFilter(filter),
    };
  } catch {
    return undefined;
  }
}

/**
 * Core may return the collection itself or wrap it in `{ collection, warnings }`,
 * like the OpenAPI generator's `{ document, warnings }`.
 */
function unwrapCollection(result: unknown): object {
  if (result && typeof result === "object" && "collection" in result) {
    return (result as { collection: object }).collection;
  }

  return result as object;
}
