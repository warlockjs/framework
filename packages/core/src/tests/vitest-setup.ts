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
import { connectorsManager } from "../dev2-server/connectors";
import { filesOrchestrator } from "../dev2-server/files-orchestrator";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

// Global flag to prevent duplicate setup within the same worker
let isSetupComplete = false;

/**
 * Setup function that runs once per worker thread
 */
export async function setupTestVest() {
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

    // 2. Load test configuration
    const testConfig = config.get<GenericObject>("tests");

    // 3. Start connectors (database, cache, etc.)
    const connectorsToStart = testConfig.connectors;
    await connectorsManager.start(connectorsToStart);

    isSetupComplete = true;
  } catch (error) {
    console.error("[vitest-setup] Failed to setup test environment:", error);
    throw error;
  }
}
