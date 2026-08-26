import config from "@mongez/config";
import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import { Application } from "../application";
import { health } from "../http/health";
import { registerHttpPlugins } from "../http/plugins";
import { setHttpReadyReport } from "../http/ready-report";
import { closeServerWithTimeout, FastifyInstance, getHttpServer, startHttpServer } from "../http/server";
import { router } from "../router/router";
import { Environment } from "../utils";
import { setBaseUrl } from "../utils/urls";
import { container } from "./../container";
import { BaseConnector } from "./base-connector";
import { describeServerAddress } from "./describe-server-address";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types";

function environmentColor(environment: Environment) {
  switch (environment) {
    case "development":
      return colors.magentaBright(environment);
    case "test":
      return colors.yellowBright(environment);
    case "production":
      return colors.greenBright(environment);
    default:
      return colors.white(environment);
  }
}

/**
 * Default time to wait for in-flight requests to drain on shutdown before the
 * HTTP server is force-closed. Override via `http.gracefulShutdown.timeout`.
 */
const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;

/**
 * HTTP Connector
 * Manages HTTP server (Fastify) lifecycle
 */
export class HttpConnector extends BaseConnector {
  public readonly name = "http";
  public readonly priority = ConnectorPriority.HTTP;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Late;

  /**
   * Files that trigger HTTP server restart
   * Note: routes.ts changes will be handled by HMR with wildcard routing
   * Connectors receive config file paths directly (not .env) thanks to layer-executor
   */
  protected readonly watchedFiles = ["src/config/http.ts", "src/config/http.tsx"];

  /**
   * Fastify Server instance
   */
  protected http?: FastifyInstance;

  /**
   * Whether someone downstream will render the combined ready block.
   *
   * Only the dev server does (`dev-server/ready-block.ts`), and only it can:
   * the block reports facts — boot duration, the web surface — that this
   * connector does not own and must not wait for. When it will, this connector
   * records and stays quiet; otherwise it narrates as it always has.
   *
   * Keyed on the runtime strategy rather than on `NODE_ENV`, because that is
   * what actually distinguishes "a dev server is driving this boot" from "an
   * app happens to be running with development config".
   *
   * `!isBooted` is the second half and it is not a detail. The block summarises
   * a BOOT. A `restart()` after boot — an edited `src/config/http.ts` — is an
   * EVENT, and there is no block coming to carry it, so suppressing the lines
   * there would rebind the port in total silence.
   */
  protected get rendersReadyBlock(): boolean {
    return Application.runtimeStrategy === "development" && !Application.isBooted;
  }

  /**
   * Boot the connector — construction only (create Fastify, register
   * plugins, populate container). Route scanning is deferred to
   * `start()` so it reads the router after app code has registered.
   */
  public async boot() {
    const httpConfig = config.get("http");

    if (!httpConfig) return;

    const port = httpConfig.port;
    log.info(
      `http`,
      "connection",
      `Starting http server on port ${port} in ${environmentColor(Application.environment)} mode`,
    );

    this.http = startHttpServer(httpConfig.serverOptions);

    container.set("http.server", this.http);

    await registerHttpPlugins(this.http);

    const baseUrl = config.get("app.baseUrl");

    // update base url
    setBaseUrl(baseUrl);

    // Liveness/readiness endpoints — registered on Fastify before start() scans
    // the app router, so they exist by the time the server listens.
    this.registerHealthRoutes();
  }

  /**
   * Register the built-in liveness (`/health`) and readiness (`/ready`)
   * endpoints directly on the Fastify instance — infra routes, kept off the app
   * router so they're immune to HMR and never collide with route scanning. Opt
   * out via `http.health.enabled = false`; rename via `http.health.path` /
   * `http.health.readinessPath`.
   */
  private registerHealthRoutes(): void {
    if (!this.http) {
      return;
    }

    const healthConfig = config.get("http.health");

    if (healthConfig?.enabled === false) {
      return;
    }

    const livenessPath = healthConfig?.path ?? "/health";
    const readinessPath = healthConfig?.readinessPath ?? "/ready";

    this.http.get(livenessPath, async (_request: any, reply: any) => {
      const result = health.liveness();

      return reply.code(result.status === "ok" ? 200 : 503).send(result);
    });

    this.http.get(readinessPath, async (_request: any, reply: any) => {
      const result = await health.readiness();

      return reply.code(result.status === "ok" ? 200 : 503).send(result);
    });
  }

  /**
   * Initialize HTTP server — bind app-registered routes to Fastify
   * then listen. Scanning here (not in `boot`) lets HTTP boot before
   * app code without losing routes.
   */
  public async start(): Promise<void> {
    const httpConfig = config.get("http");

    if (!httpConfig || !this.http) return;

    // Read once. `Application.isBooted` flips during the same boot this method
    // belongs to, and a predicate that answered differently before and after
    // `listen()` would print half a report.
    const deferToReadyBlock = this.rendersReadyBlock;

    if (Application.runtimeStrategy === "development") {
      router.scanDevServer(this.http);
    } else {
      router.scan(this.http);
    }

    // Surface the route table as a readiness signal + a boot log, so an empty
    // or partial route surface (e.g. a route module that failed to register) is
    // detectable instead of silently 404ing. `addRoutesRegisteredCheck` is
    // keyed by name, so re-running on restart is idempotent.
    health.addRoutesRegisteredCheck(() => router.routeCount());

    const routeCount = router.routeCount();

    // In development this fact is one line of the single ready block rendered
    // after boot completes (`dev-server/ready-block.ts`); printing it here as
    // well would put the same number on screen twice, in two formats. Outside
    // development the line is load-bearing — a supervisor or CI log greps it —
    // so it stays exactly as it was.
    if (!deferToReadyBlock) {
      log.info("http", "routes", `${routeCount} route(s) registered`);
    }

    try {
      // `listen()` RESOLVES with the address it actually bound — which is the
      // only address worth announcing. See `describe-server-address.ts` for why
      // announcing `app.baseUrl` here instead was a defect rather than a
      // shortcut.
      const boundAddress = await this.http.listen({
        port: httpConfig.port,
        host: httpConfig.host || "localhost",
      });

      Application.setServedPort(httpConfig.port);

      const address = describeServerAddress(boundAddress, config.get("app.baseUrl"));

      // Recorded unconditionally: the ready block reads it in development, and
      // in every other mode it is simply the one place that knows what was
      // bound, which is worth having whether or not anything renders it.
      setHttpReadyReport({
        boundAddress: address.boundAddress,
        url: address.url,
        wildcardBind: address.wildcardBind,
        port: httpConfig.port,
        routeCount,
        publicUrl: address.publicUrl,
      });

      if (!deferToReadyBlock) {
        log.success(`http`, "connection", address.ready);

        if (address.publicUrl) {
          log.info(`http`, "connection", address.publicUrl);
        }
      }

      // NEVER conditional on the block. A base URL pointing at a port nothing
      // is listening on is the single most misleading state this connector can
      // be in, and a warning a status block swallows is a warning nobody reads
      // — so it is logged where it lands ABOVE the block, in both modes.
      if (address.warning) {
        log.warn(`http`, "connection", address.warning);
      }
    } catch (error) {
      // A failed listen()/port-bind at boot means the app can't serve — fatal.
      // `log.fatal` reaches Sentry/file; `await log.flush()` drains buffered and
      // async channels before the process exits.
      await log.fatal("http", "connection", error);
      await log.flush();

      process.exit(1); // stop the process, exit with error
    }

    this.active = true;
  }

  /**
   * Restart — needs a fresh Fastify instance since `start()` now
   * re-runs `router.scan()`, and re-scanning the same Fastify would
   * register duplicate route handlers.
   */
  public async restart(): Promise<void> {
    await this.shutdown();
    await this.boot();
    await this.start();
  }

  /**
   * Shutdown HTTP server
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    const server = getHttpServer();

    if (server) {
      const timeout = config.get("http.gracefulShutdown.timeout", DEFAULT_SHUTDOWN_TIMEOUT);
      const drained = await closeServerWithTimeout(server, timeout);

      if (!drained) {
        log.warn(
          "http",
          "shutdown",
          `In-flight requests did not drain within ${timeout}ms; closing anyway`,
        );
      }
    }

    this.active = false;
  }

  /**
   * Override shouldRestart to handle routes.ts specially
   * routes.ts changes should NOT restart the server (use HMR instead)
   * Now receives config file paths directly from layer-executor
   */
  public shouldRestart(changedFiles: string[]): boolean {
    // Only restart for config changes, not routes
    return changedFiles.some((file) => {
      const relativePath = file.replace(/\\/g, "/");
      return this.watchedFiles.includes(relativePath);
    });
  }
}
