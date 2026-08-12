/**
 * Vitest Setup File
 *
 * This file runs in each Vitest worker thread before tests execute.
 * It bootstraps the framework and starts necessary connectors so tests
 * have access to database connections and other shared resources.
 */
import { GenericObject } from "@mongez/reinforcements";
import { Application } from "../application/application";
import { bootstrap } from "../bootstrap";
import { config } from "../config";
import { loadConfigFiles } from "../config/load-config-files";
import { ConnectorName, connectorsManager } from "../connectors";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

// Global flag to prevent duplicate setup within the same worker
let isSetupComplete = false;

type TestSetup = {
  connectors?: boolean | ConnectorName[];
};

/**
 * Setup function that runs once per worker thread
 */
export async function setupTest({ connectors = true }: TestSetup = {}) {
  // Skip if already set up in this worker
  if (isSetupComplete) {
    return;
  }

  try {
    // 1. Set environment to test
    Application.setEnvironment("test");

    await warlockConfigManager.load();
    await bootstrap();

    await filesOrchestrator.init();
    await loadConfigFiles(true);

    // 2. Load test configuration.
    //
    // The default matters: `config.get` resolves an absent key to its default,
    // and ITS default is `null` — not `{}`. `warlock add test` does not generate
    // `src/config/tests.ts`, so reading `.connectors` off the result threw
    // "Cannot read properties of null" on the generated default path.
    const testConfig = config.get<GenericObject>("tests", {});

    // 3. Choose the connectors.
    //
    // `??`, not `||`: `false` is a meaningful configured value ("start none")
    // and `||` discarded it, falling through to the branch that starts
    // everything. The type and the skill both document `false` as "start none",
    // so the old behaviour was the exact opposite of the promise.
    const connectorsToStart = testConfig?.connectors ?? connectors;

    // `false` means none at all. Everything else starts something: an array
    // starts exactly those, and `true` starts all but http — http is the global
    // setup's job, shared across every worker.
    if (connectorsToStart !== false) {
      if (Array.isArray(connectorsToStart)) {
        await connectorsManager.start(connectorsToStart);
      } else {
        await connectorsManager.startWithout(["http"]);
      }
    }

    // Set even when no connectors were started: setup DID complete, and a second
    // call in the same worker must stay a no-op either way.
    isSetupComplete = true;
  } catch (error) {
    console.error("[vitest-setup] Failed to setup test environment:", error);
    throw error;
  }
}
