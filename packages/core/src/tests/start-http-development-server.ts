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
import { registerConfiguredConnectors } from "../connectors/register-configured-connectors";
import { ConnectorLifecyclePhase } from "../connectors/types";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { assertPortIsAvailable } from "../http/port-preflight";
import { getHttpReadyReport } from "../http/ready-report";
import { loadEnvironmentFiles } from "../utils/load-environment";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { performance } from "node:perf_hooks";
import { installTestFakes, restoreTestFakes } from "./fakes/test-fakes";
import type { TestFakesSelection } from "./fakes/test-fakes";
import { formatSteps, publishTestServerBootProfile } from "./test-runtime-scope";
import { publishTestServerPort, withdrawTestServerPort } from "./test-server-port-channel";

let isServerRunning = false;

export type StartHttpTestServerOptions = {
  /**
   * Port the test server binds to, overriding `http.port`.
   *
   * Needed because the server cannot be moved from outside: this function
   * bootstraps the app itself, and that bootstrap re-reads `.env`.
   *
   * `0` asks the OS for a free port. The port actually bound is published to
   * the test workers, so `testGet()`, `actingAs()` and friends follow it, and
   * a suite never collides with `warlock dev` or another suite.
   */
  port?: number;

  /**
   * Whether to boot the optional web connector.
   *
   * Defaults to `true` to preserve the full-stack test server. Pass `false`
   * for API-only suites: the web connector's lazy delegate is skipped before
   * `boot()`, so it never constructs its Vite-backed implementation.
   *
   * @default true
   */
  web?: boolean;

  /**
   * Which test fakes the server process installs (mail, queue, cache,
   * storage, clock, ids). Same values and precedence as `setupTest({ fakes })`:
   * this option > `tests.fakes` config > all on.
   *
   * A fake records what happens in ITS process: mail sent while this server
   * handles a request is captured here, not in the test worker that sent the
   * request. To assert on what an HTTP request did, serve it in the worker
   * with `createTestHttpServer()`. The storage fake is the exception: its
   * temp root is shared with the workers.
   */
  fakes?: TestFakesSelection;
};

/**
 * Start one lifecycle phase while omitting the web connector.
 *
 * Kept here rather than changing the manager's public API: this is a
 * test-server-only selection, and retaining the manager's boot-all / start-all
 * ordering is essential for HTTP and socket connector wiring.
 */
async function startTestServerPhase(phase: ConnectorLifecyclePhase): Promise<void> {
  const connectors = connectorsManager
    .list()
    .filter((connector) => connector.lifecyclePhase === phase)
    .filter((connector) => connector.name !== "web");

  for (const connector of connectors) {
    await connector.boot();
  }

  for (const connector of connectors) {
    await connector.start();
  }
}

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
async function applyTestServerPort(port?: number): Promise<"published" | "ephemeral" | "none"> {
  const httpConfig = config.get("http");

  if (!httpConfig) {
    if (port !== undefined) {
      throw new Error(
        `startHttpTestServer({ port: ${port} }) was given a port, but this app has no \`http\` config, so no HTTP server is started. Add \`src/config/http.ts\` first.`,
      );
    }

    return "none";
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

  // `0` is the OS's "pick a free one for me". There is nothing to preflight —
  // probing 0 would bind some unrelated port and prove nothing — and nothing to
  // publish yet: the port is only known once the HTTP connector has bound, and
  // `HttpConnector.start()` records the port `listen()` actually returned (see
  // `ready-report.ts`). It is published right after the late phase instead.
  if (resolvedPort === 0) {
    return "ephemeral";
  }

  if (resolvedPort < 0) {
    throw new Error(
      `startHttpTestServer() cannot run on port ${resolvedPort}. Pass a port number, or 0 to let the OS pick a free one — e.g. startHttpTestServer({ port: 0 }).`,
    );
  }

  await assertPortIsAvailable(resolvedPort, config.get("http.host") || "localhost");

  publishTestServerPort(resolvedPort);

  return "published";
}

/**
 * Publish the port an ephemeral (`port: 0`) bind actually took.
 *
 * `before` is the ready report from before the late phase: the report is a
 * module-level record, so an unchanged one means THIS boot bound nothing and an
 * older report must not be mistaken for it.
 */
function publishEphemeralPort(before: ReturnType<typeof getHttpReadyReport>): void {
  const report = getHttpReadyReport();

  if (!report || report === before || report.port <= 0) {
    throw new Error(
      "startHttpTestServer({ port: 0 }) booted, but the HTTP connector did not bind a port, so there is no address to give the test workers. Check that `src/config/http.ts` exists and that this process serves HTTP (its role is not worker-only).",
    );
  }

  publishTestServerPort(report.port);
}

/**
 * Start the HTTP test server (minimal - no file watching)
 * Call this in Vitest's globalSetup
 *
 * @example
 * // run this suite on its own port, whatever `.env` says
 * await startHttpTestServer({ port: 3999 });
 *
 * @example
 * // let the OS pick a free port; the request helpers follow it
 * await startHttpTestServer({ port: 0 });
 */
export async function startHttpTestServer(options: StartHttpTestServerOptions = {}): Promise<void> {
  const nodeEnvironment = process.env.NODE_ENV;

  if (nodeEnvironment === undefined) {
    process.env.NODE_ENV = "test";
  } else if (nodeEnvironment !== "test") {
    throw new Error(
      `startHttpTestServer() requires NODE_ENV="test", but received NODE_ENV=${JSON.stringify(nodeEnvironment)}. Set NODE_ENV=test before starting the test server.`,
    );
  }

  if (isServerRunning) {
    console.log("[test-server] Server already running, skipping start");
    return;
  }

  console.log("[test-server] Starting HTTP test server...");

  // Boot phases, kept whatever the profile setting says (a handful of numbers),
  // and printed or published only when profiling is on.
  const steps: Record<string, number> = {};
  const timed = async <T>(step: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now();

    try {
      return await run();
    } finally {
      steps[step] = (steps[step] ?? 0) + performance.now() - started;
    }
  };

  connectorsManager.observeTimings((timing) => {
    const step = `connector.${timing.connector}`;

    steps[step] = (steps[step] ?? 0) + timing.ms;
  });

  try {
    // `globalSetup` runs in Vitest's main process, where Vitest's worker env
    // setup has not run. Load `.env.test` here, before any config is read.
    await timed("environment", () => loadEnvironmentFiles());

    // Set environment
    Application.setRuntimeStrategy("development");
    Application.setEnvironment("test");

    // Bootstrap (env, etc.)
    await timed("config", () => warlockConfigManager.load());
    await timed("bootstrap", () => bootstrap());

    // The connectors `warlock.config.ts` declares (the web connector among them)
    // register here, as `warlock dev` does; without this the test server serves
    // HTTP only and every page answers 404. An app without a warlock config has
    // none to register.
    if (warlockConfigManager.isLoaded) {
      registerConfiguredConnectors();
    }

    // Initialize file orchestrator (but don't watch)
    await timed("orchestrator", async () => {
      await filesOrchestrator.init();
      await filesOrchestrator.initializeAll();
    });

    // Load config files
    await timed("appConfig", () => loadConfigFiles(true));

    // Early-phase connectors (database, cache, logger, storage, mailer,
    // herald) must start BEFORE app modules load: a module's `main.ts` boot
    // side-effect can query the DB at import time, so the data source has to
    // be registered first. This mirrors the dev/prod boot order (see
    // `cli-commands.manager`, `production-builder`, and `DevelopmentServer`).
    await timed("earlyConnectors", () =>
      options.web === false
        ? startTestServerPhase(ConnectorLifecyclePhase.Early)
        : connectorsManager.startPhase(ConnectorLifecyclePhase.Early),
    );

    // Fakes before app modules load, so module boot code already sees them.
    await timed("fakes", () => installTestFakes(options.fakes));

    // Load application modules (their boot side-effects now see a live DB).
    await timed("appModules", () => filesOrchestrator.moduleLoader.loadAll());

    const portMode = await applyTestServerPort(options.port);
    const readyReportBefore = getHttpReadyReport();

    // A rejecting validator (Application.onValidateBoot) must abort boot
    // before late-phase connectors bind a port — same slot as
    // `DevelopmentServer.start()` and the generated production `app.ts`.
    await Application.runStartupValidators();

    // Late-phase connectors (http, socket) bind after app code has
    // registered its routes and listeners.
    await timed("lateConnectors", () =>
      options.web === false
        ? startTestServerPhase(ConnectorLifecyclePhase.Late)
        : connectorsManager.startPhase(ConnectorLifecyclePhase.Late),
    );

    if (portMode === "ephemeral") {
      publishEphemeralPort(readyReportBefore);
    }

    isServerRunning = true;

    reportServerBootProfile(steps);
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
  } finally {
    connectorsManager.observeTimings(undefined);
  }
}

/**
 * Print and publish the server's boot phases when profiling is on
 * (`WARLOCK_TEST_PROFILE=1` or `tests.profileSetup`). The reporter adds them to
 * its JSON, so the web connector and Vite show up next to the worker phases.
 */
function reportServerBootProfile(steps: Record<string, number>): void {
  const settings =
    (config.get("tests", {} as never) as unknown as { profileSetup?: unknown } | undefined) ?? {};

  if (process.env.WARLOCK_TEST_PROFILE !== "1" && settings.profileSetup !== true) return;

  console.info(`[warlock:test] server pid=${process.pid} ${formatSteps(steps)}`);
  publishTestServerBootProfile({ pid: process.pid, steps });
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
    await restoreTestFakes();
  } catch (fakesError) {
    console.error(
      "[test-server] Restoring the test fakes after a failed start did not complete:",
      fakesError,
    );
  }

  try {
    try {
      await connectorsManager.shutdown();
    } finally {
      await filesOrchestrator.dispose();
    }
  } catch (shutdownError) {
    // Reported, not thrown — it is secondary to the startup error being
    // rethrown, and losing that one to this would be the worse outcome.
    console.error("[test-server] Cleanup after a failed start did not complete:", shutdownError);
  }

  withdrawTestServerPort();
  isServerRunning = false;
}

/**
 * Name any connector that still reports itself active after shutdown.
 *
 * A web connector whose Vite dev server (with its HMR websocket and file
 * watchers) is still open keeps the process from exiting, and Vitest then only
 * reports "something prevents N Vite servers from exiting" after its close
 * timeout. Naming the connector here points at the one to fix.
 */
function warnAboutConnectorsLeftActive(): void {
  const active = connectorsManager
    .list()
    .filter((connector) => connector.isActive?.())
    .map((connector) => connector.name);

  if (active.length === 0) return;

  console.warn(
    `[test-server] Connectors still active after shutdown: ${active.join(", ")}. Their servers or watchers may keep the test process from exiting.`,
  );
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
    try {
      await restoreTestFakes();
    } catch (fakesError) {
      console.error("[test-server] Restoring the test fakes did not complete:", fakesError);
    }

    try {
      await connectorsManager.shutdown();
    } finally {
      await filesOrchestrator.dispose();
    }

    warnAboutConnectorsLeftActive();

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
