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

  // No configured port at all is fine: Fastify falls back to its own default and
  // the workers resolve the same one from their own config, so both ends agree
  // without the channel.
  //
  // A non-numeric port is NOT fine, and must fail loudly rather than skip the
  // preflight silently. `env()` coerces a value only when it round-trips exactly
  // (`String(Number(v)) === v`), so `HTTP_PORT=3999` and `HTTP_PORT=0` arrive as
  // numbers, but `03999`, `+3999`, `1e3` and anything with stray whitespace stay
  // strings. Letting those through used to reach `HttpConnector.start()`'s
  // `listen({ port })` unchanged — no preflight, no published port, and every
  // test worker resolving a URL from a channel nothing ever wrote to.
  if (typeof resolvedPort !== "number") {
    throw new Error(
      `startHttpTestServer() cannot use \`http.port\` value ${JSON.stringify(resolvedPort)} — it did not round-trip through Number() (env() only coerces a value when \`String(Number(v)) === v\`, so "03999", "+3999", "1e3", and values with stray whitespace stay strings). Fix \`HTTP_PORT\` in .env, or pass an explicit numeric port: startHttpTestServer({ port: 3999 }).`,
    );
  }

  // `0` is the OS's "pick a free one for me" idiom, and the test server cannot
  // support it. Preflighting 0 would bind some unrelated ephemeral port and pass
  // without proving anything, and there is nothing meaningful to publish: the
  // port Fastify ends up binding is never recorded — `HttpConnector.start()`
  // stores the port it ASKED for, not the one it got. Accepting 0 silently is
  // what left `getTestServerUrl()` resolving to `http://host:0` through its own
  // config fallback, so every worker request went to a port nothing listens on.
  if (resolvedPort <= 0) {
    throw new Error(
      `startHttpTestServer() cannot run on port ${resolvedPort}. Pass an explicit port — e.g. startHttpTestServer({ port: 3999 }) — or set \`http.port\` in your config. Test workers are separate processes that resolve the server's URL from the port published at startup, and an OS-assigned port is not knowable to them.`,
    );
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

  try {
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

    // A rejecting validator (Application.onValidateBoot) must abort boot
    // before late-phase connectors bind a port — same slot as
    // `DevelopmentServer.start()` and the generated production `app.ts`.
    await Application.runStartupValidators();

    // Late-phase connectors (http, socket) bind after app code has
    // registered its routes and listeners.
    await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);

    isServerRunning = true;
  } catch (error) {
    // This function owns the connectors it starts, so a failure part-way
    // through has to leave nothing behind. Without this, `isServerRunning` was
    // still `false` — it is only set on the last line — so `globalTeardown`'s
    // `stopHttpTestServer()` reported "No server to stop" and walked away from
    // live early-phase connectors and a published port that outlived them.
    await unwindPartialStartup();

    // Rethrown unchanged: the startup failure is the one the caller needs to
    // read. A cleanup failure that replaced it would hide the actual cause.
    throw error;
  }
}

/**
 * Best-effort teardown of whatever a failed {@link startHttpTestServer} managed
 * to start.
 *
 * Every step is independent and none may throw: this runs while an error is
 * already in flight, and the caller is about to rethrow it.
 */
async function unwindPartialStartup(): Promise<void> {
  try {
    await connectorsManager.shutdown();
  } catch (shutdownError) {
    // Reported, not thrown — it is secondary to the startup error being
    // rethrown, and losing that one to this would be the worse outcome.
    console.error("[test-server] Cleanup after a failed start did not complete:", shutdownError);
  }

  withdrawTestServerPort();
  isServerRunning = false;
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

    console.log("[test-server] HTTP test server stopped");
  } catch (error) {
    // Surfaced, never swallowed — cleaning up is not the same as the shutdown
    // having succeeded, and a suite whose teardown failed should say so.
    console.error("[test-server] Error stopping HTTP server:", error);

    throw error;
  } finally {
    // In a `finally` rather than after the `await`: when `shutdown()` threw,
    // the published port survived the server it pointed at, so the next run in
    // the same process inherited a stale one and sent every request to it.
    withdrawTestServerPort();

    isServerRunning = false;
  }
}

/**
 * Check if test server is running
 */
export function isTestServerRunning(): boolean {
  return isServerRunning;
}
