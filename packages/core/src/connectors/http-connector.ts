import config from "@mongez/config";
import { colors } from "@mongez/copper";
import { log } from "@warlock.js/logger";
import { Application } from "../application";
import { devLogError } from "../dev-server/dev-logger";
import { health } from "../http/health";
import { registerHttpPlugins } from "../http/plugins";
import { closeServerWithTimeout, FastifyInstance, getHttpServer, startHttpServer } from "../http/server";
import { router } from "../router/router";
import { Environment } from "../utils";
import { setBaseUrl } from "../utils/urls";
import { container } from "./../container";
import { BaseConnector } from "./base-connector";
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

    if (Application.runtimeStrategy === "development") {
      router.scanDevServer(this.http);
    } else {
      router.scan(this.http);
    }

    try {
      // We can use the url of the server
      await this.http.listen({
        port: httpConfig.port,
        host: httpConfig.host || "localhost",
      });

      const baseUrl = config.get("app.baseUrl");

      log.success(`http`, "connection", `Server ready at ${baseUrl}`);
    } catch (error) {
      devLogError("Error while starting http server", error);

      // A failed listen()/port-bind at boot means the app can't serve — fatal.
      // devLogError above is the dev-server console UI and bypasses the logger
      // pipeline, so also route it through `log.fatal` to reach Sentry/file,
      // then `await log.flush()` to drain buffered/async channels before exit.
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
