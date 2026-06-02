import { colors } from "@mongez/copper";
import { devLogError, devServeLog } from "./dev-logger";
import { DevelopmentServer } from "./development-server";

let handlersRegistered = false;

/**
 * Options accepted by `startDevelopmentServer`. CLI flags translate to
 * these; programmatic callers (tests, scripts) can pass them directly.
 *
 * `undefined` for any field means "fall through to `warlock.config.ts >
 * devServer.*` defaults." Pass an explicit value only to override.
 */
export type StartDevServerOptions = {
  /**
   * Delete `.warlock/manifest.json` before starting — forces every file
   * to be re-parsed from disk instead of restored from the cached graph.
   */
  fresh?: boolean;
  /** Run background type generation. Default from devServer config (true). */
  generateTypings?: boolean;
  /** Run file health checkers. Default from devServer config (true). */
  healthCheckers?: boolean;
};

/**
 * Start the development server.
 *
 * Boots the file orchestrator, loads app modules, starts late-phase
 * connectors, then wires graceful shutdown for SIGINT/SIGTERM (plus
 * SIGHUP on Windows where Ctrl+C in spawned children lands as SIGHUP).
 *
 * If startup throws, shuts down cleanly and exits 1 — dev should die
 * loudly rather than hang with a half-initialized state.
 */
export async function startDevelopmentServer(
  options: StartDevServerOptions = {},
): Promise<DevelopmentServer> {
  // V8 honours inline source maps embedded by the transpile cache (and
  // tsx's own maps in passthrough mode), so thrown-error stack frames point
  // at the original `src/**.ts` line/column instead of transpiled output.
  process.setSourceMapsEnabled(true);

  const devServer = new DevelopmentServer(options);

  registerShutdownHandlers(devServer);

  try {
    await devServer.start();
  } catch (error) {
    devLogError(`Failed to start Development Server: ${(error as Error).message}`);
    await safeShutdown(devServer);
    process.exit(1);
  }

  return devServer;
}

/**
 * Register signal handlers once per process. Guards against handler
 * accumulation if `startDevelopmentServer` is invoked more than once
 * (tests, programmatic restart).
 */
function registerShutdownHandlers(devServer: DevelopmentServer): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const onSignal = (signal: NodeJS.Signals) => async () => {
    devServeLog(colors.yellow(`📡 Received ${signal}`));
    const ok = await safeShutdown(devServer);
    process.exit(ok ? 0 : 1);
  };

  process.on("SIGINT", onSignal("SIGINT"));
  process.on("SIGTERM", onSignal("SIGTERM"));
  // Ctrl+C in spawned Windows children lands as SIGHUP, not SIGINT.
  if (process.platform === "win32") {
    process.on("SIGHUP", onSignal("SIGHUP"));
  }
}

/**
 * Shut down the dev server without swallowing async errors. Returns
 * whether shutdown completed cleanly so the caller picks the exit code.
 */
async function safeShutdown(devServer: DevelopmentServer): Promise<boolean> {
  try {
    await devServer.shutdown();
    return true;
  } catch (error) {
    devLogError(`Shutdown failed: ${(error as Error).message}`);
    return false;
  }
}
