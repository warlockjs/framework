import { initializeDayjs } from "@mongez/time-wizard";
import { captureAnyUnhandledRejection } from "@warlock.js/logger";
import { Application } from "./application";
import { loadEnvironmentFiles } from "./utils/load-environment";

let unhandledCaptureInstalled = false;

export async function bootstrap() {
  // Guarded: a project with no `.env` is legitimate, and a raw `loadEnv()`
  // throws on one. See `loadEnvironmentFiles`.
  await loadEnvironmentFiles();

  initializeDayjs();

  // In production a fatal `uncaughtException` must take the process down loudly
  // (Node's own default) so supervisors restart and `warlock start` surfaces
  // the failure instead of exiting 0 in silence. In development the dev server
  // intentionally survives runtime errors so HMR can recover, so we only log.
  // Install the process listeners once: `bootstrap()` runs once per test file
  // in the same worker, and each call would otherwise stack duplicate handlers.
  if (unhandledCaptureInstalled) return;

  unhandledCaptureInstalled = true;

  captureAnyUnhandledRejection({ exitOnUncaughtException: Application.isProduction });

  // A rejection before the app has finished booting leaves a process that is
  // up but serves nothing (a connector failed to boot). In production that is
  // fatal: the logger listener above has already recorded it, so exit non-zero
  // after a short flush and let the process manager show the app as errored.
  // After boot a rejection stays a logged error.
  if (Application.isProduction) {
    process.on("unhandledRejection", () => {
      if (Application.isBooted) return;

      process.exitCode = 1;
      const timer = setTimeout(() => process.exit(1), 1000);
      timer.unref?.();
    });
  }
}
