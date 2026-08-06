import { colors } from "@mongez/copper";
import { devLogError, devServeLog } from "./dev-logger";
import type { DevelopmentServer } from "./development-server";
import { isDevWorker, RESTART_EXIT_CODE } from "./supervisor";

/**
 * Restart `warlock dev`.
 *
 * There is no way to un-load an ES module graph, so a restart is a fresh
 * process. This one doesn't create it: the supervisor that launched us does.
 * We shut down cleanly — which frees the http port before the replacement
 * binds it — and exit with {@link RESTART_EXIT_CODE}, which the supervisor
 * reads as "spawn me again".
 *
 * Never returns on the happy path. Returns `false` when a restart isn't
 * possible — no supervisor (a programmatic `startDevelopmentServer` call), or
 * a shutdown that failed — so the caller can carry on with the server it has.
 */
export async function restartDevServer(devServer: DevelopmentServer): Promise<boolean> {
  if (!isDevWorker()) {
    devLogError("Restart is unavailable — this server was not started by `warlock dev`.");
    return false;
  }

  devServeLog(colors.cyanBright("Restarting the development server…"));

  try {
    await devServer.shutdown();
  } catch (error) {
    devLogError(`Shutdown before restart failed: ${(error as Error).message}`);
    return false;
  }

  process.exit(RESTART_EXIT_CODE);
}
