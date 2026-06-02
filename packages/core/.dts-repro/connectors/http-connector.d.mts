import { FastifyInstance } from "../http/server.mjs";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/http-connector.d.ts
/**
 * HTTP Connector
 * Manages HTTP server (Fastify) lifecycle
 */
declare class HttpConnector extends BaseConnector {
  readonly name = "http";
  readonly priority = ConnectorPriority.HTTP;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Late;
  /**
   * Files that trigger HTTP server restart
   * Note: routes.ts changes will be handled by HMR with wildcard routing
   * Connectors receive config file paths directly (not .env) thanks to layer-executor
   */
  protected readonly watchedFiles: string[];
  /**
   * Fastify Server instance
   */
  protected http?: FastifyInstance;
  /**
   * Boot the connector — construction only (create Fastify, register
   * plugins, populate container). Route scanning is deferred to
   * `start()` so it reads the router after app code has registered.
   */
  boot(): Promise<void>;
  /**
   * Initialize HTTP server — bind app-registered routes to Fastify
   * then listen. Scanning here (not in `boot`) lets HTTP boot before
   * app code without losing routes.
   */
  start(): Promise<void>;
  /**
   * Restart — needs a fresh Fastify instance since `start()` now
   * re-runs `router.scan()`, and re-scanning the same Fastify would
   * register duplicate route handlers.
   */
  restart(): Promise<void>;
  /**
   * Shutdown HTTP server
   */
  shutdown(): Promise<void>;
  /**
   * Override shouldRestart to handle routes.ts specially
   * routes.ts changes should NOT restart the server (use HMR instead)
   * Now receives config file paths directly from layer-executor
   */
  shouldRestart(changedFiles: string[]): boolean;
}
//#endregion
export { HttpConnector };
//# sourceMappingURL=http-connector.d.mts.map