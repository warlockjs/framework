/**
 * HTTP Test Server
 *
 * Starts a minimal HTTP server for testing.
 * Unlike the full DevelopmentServer, this:
 * - Does NOT watch files
 * - Does NOT do HMR
 * - Only starts connectors needed for HTTP requests
 *
 * Used in Vitest's globalSetup to start server once for all test workers.
 */
import config from "@mongez/config";
import { Application } from "../application";
import { bootstrap } from "../bootstrap";
import { loadConfigFiles } from "../config/load-config-files";
import { connectorsManager } from "../connectors/connectors-manager";
import { ConnectorLifecyclePhase } from "../connectors/types";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { assertPortIsAvailable } from "../http/port-preflight";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { publishTestServerPort, withdrawTestServerPort } from "./test-server-port-channel";

let isServerRunning = false;

export type StartHttpTestServerOptions = {
  /**
   * Port the test server binds to, overriding `http.port`.
   *
   * Needed because the server cannot be moved from outside: this function
   * bootstraps the app itself, and that bootstrap re-reads `.env`.
   */
  port?: number;
};

/**
 * Apply the caller's port and preflight the bind.
 *
 * Called at the last moment before the HTTP connector binds, and that timing is
 * the fix: `bootstrap()` re-reads `.env` through `loadEnv()` (dotenv overrides
 * by default), and `src/config/http.ts` then resolves its port from that store,
 * so anything the caller set earlier is gone by the time the port is read.
 * Writing into `config` here is also the only channel that works — assigning
 * `process.env.HTTP_PORT` has no effect, since `env()` reads dotenv's own store
 * and never falls back to `process.env`.
 */
async function applyTestServerPort(port?: number): Promise<void> {
  const httpConfig = config.get("http");

  if (!httpConfig) {
    if (port !== undefined) {
      throw new Error(
        `startHttpTestServer({ port: ${port} }) was given a port, but this app has no \`http\` config, so no HTTP server is started. Add \`src/config/http.ts\` first.`,
      );
    }

    return;
  }

  if (port !== undefined) {
    config.set("http.port", port);
  }

  const resolvedPort = config.get("http.port");

  // No configured port — or an explicit `0`, which is the OS's "pick a free one
  // for me" idiom — means Fastify chooses the port, so there is nothing to
  // preflight and nothing to publish: preflighting 0 would bind some unrelated
  // ephemeral port and pass without proving anything, and publishing 0 would
  // point every worker request at `http://host:0`.
  if (typeof resolvedPort !== "number" || resolvedPort <= 0) {
    return;
  }

  await assertPortIsAvailable(resolvedPort, config.get("http.host") || "localhost");

  publishTestServerPort(resolvedPort);
}

/**
 * Start the HTTP test server (minimal - no file watching)
 * Call this in Vitest's globalSetup
 *
 * @example
 * // run this suite on its own port, whatever `.env` says
 * await startHttpTestServer({ port: 3999 });
 */
export async function startHttpTestServer(
  options: StartHttpTestServerOptions = {},
): Promise<void> {
  if (isServerRunning) {
    console.log("[test-server] Server already running, skipping start");
    return;
  }

  console.log("[test-server] Starting HTTP test server...");

  // Set environment
  Application.setRuntimeStrategy("development");
  Application.setEnvironment("test");

  // Bootstrap (env, etc.)
  await warlockConfigManager.load();
  await bootstrap();

  // Initialize file orchestrator (but don't watch)
  await filesOrchestrator.init();
  await filesOrchestrator.initializeAll();

  // Load config files
  await loadConfigFiles(true);

  // Early-phase connectors (database, cache, logger, storage, mailer,
  // herald) must start BEFORE app modules load: a module's `main.ts` boot
  // side-effect can query the DB at import time, so the data source has to
  // be registered first. This mirrors the dev/prod boot order (see
  // `cli-commands.manager`, `production-builder`, and `DevelopmentServer`).
  await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);

  // Load application modules (their boot side-effects now see a live DB).
  await filesOrchestrator.moduleLoader.loadAll();

  await applyTestServerPort(options.port);

  // Late-phase connectors (http, socket) bind after app code has
  // registered its routes and listeners.
  await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);

  isServerRunning = true;
}

/**
 * Stop the HTTP test server
 * Call this in Vitest's globalTeardown
 */
export async function stopHttpTestServer(): Promise<void> {
  if (!isServerRunning) {
    console.log("[test-server] No server to stop");
    return;
  }

  try {
    await connectorsManager.shutdown();
    withdrawTestServerPort();
    isServerRunning = false;
    console.log("[test-server] HTTP test server stopped");
  } catch (error) {
    console.error("[test-server] Error stopping HTTP server:", error);
    throw error;
  }
}

/**
 * Check if test server is running
 */
export function isTestServerRunning(): boolean {
  return isServerRunning;
}
