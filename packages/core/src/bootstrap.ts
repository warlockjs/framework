import { loadEnv } from "@mongez/dotenv";
import { initializeDayjs } from "@mongez/time-wizard";
import { captureAnyUnhandledRejection } from "@warlock.js/logger";
import { Application } from "./application";

export async function bootstrap() {
  await loadEnv();

  initializeDayjs();

  // In production a fatal `uncaughtException` must take the process down loudly
  // (Node's own default) so supervisors restart and `warlock start` surfaces
  // the failure instead of exiting 0 in silence. In development the dev server
  // intentionally survives runtime errors so HMR can recover, so we only log.
  captureAnyUnhandledRejection({ exitOnUncaughtException: Application.isProduction });
}
