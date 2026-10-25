import { colors } from "@mongez/copper";
import { fileExistsAsync, putFileAsync, recordSkippedFile } from "../generation-fs";
import type { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import type { FeatureDefinition } from "./types";
import { VITE_RANGE } from "./web.feature";

async function completeTestInstallation(options: CommandActionData) {
  // Create test-global-setup.ts (runs once before all tests)
  const testGlobalSetupPath = srcPath("test-global-setup.ts");
  const testGlobalSetupExists = await fileExistsAsync(testGlobalSetupPath);

  if (!testGlobalSetupExists) {
    await putFileAsync(
      testGlobalSetupPath,
      `/**
 * Global Test Setup
 *
 * Runs ONCE before all test workers.
 * Starts the HTTP server for integration tests.
 *
 * port: 0 lets the OS pick a free port, so tests run while \`warlock dev\`
 * holds the configured one; the test helpers (testGet, actingAs, ...) are
 * told the bound port automatically.
 */
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";

export async function setup() {
  await startHttpTestServer({ port: 0 });
}

export async function teardown() {
  await stopHttpTestServer();
}
`,
    );
    console.log(`${colors.green("✓")} Created src/test-global-setup.ts`);
  } else {
    recordSkippedFile(testGlobalSetupPath, "exists");
  }

  // Create test-setup.ts (runs before EVERY test file)
  const testSetupPath = srcPath("test-setup.ts");
  const testSetupExists = await fileExistsAsync(testSetupPath);

  if (!testSetupExists) {
    await putFileAsync(
      testSetupPath,
      `/**
 * Test Setup - runs before EVERY test file
 *
 * Vitest runs setupFiles before each test file. With the generated
 * src/config/tests.ts (lifetime: "worker") the framework boots once per Vitest
 * worker and every file starts from a reset state: the database is truncated,
 * the fakes, the request context and the route table are restored. A spec that
 * changes global configuration the reset does not undo opts out for its file:
 *
 *   await setupTest({ importModule: (file) => import(file), lifetime: "file" });
 *
 * Set WARLOCK_TEST_LIFETIME=file to boot per file for the whole run instead.
 *
 * setupTest() gets no connectors option on purpose: an explicit connectors
 * value outranks tests.connectors from src/config/tests.ts, so passing one
 * here would erase your project config. Omitting it leaves the config in
 * charge.
 *
 * importModule makes Warlock load your app modules (config, routes, ...)
 * through THIS file's import(), which Vitest handles. Tests and the framework
 * then share one copy of every class, so "owner instanceof User" works.
 *
 * afterAll(teardownTest) is the other half of the pair: whoever calls
 * setupTest() owns closing it in the same runtime context.
 */
import { setupTest, teardownTest } from "@warlock.js/core/tests";
import { afterAll, expect } from "vitest";

await setupTest({ importModule: (file) => import(file), file: expect.getState().testPath });

afterAll(teardownTest);
`,
    );
    console.log(`${colors.green("✓")} Created src/test-setup.ts`);
  } else {
    recordSkippedFile(testSetupPath, "exists");
  }

  const testsConfigPath = srcPath("config/tests.ts");
  if (!(await fileExistsAsync(testsConfigPath))) {
    await putFileAsync(
      testsConfigPath,
      `/**
 * Test runtime settings.
 *
 * The framework boots once per Vitest worker and every test file starts from a reset state
 * (the default since 5.38). WARLOCK_TEST_LIFETIME=file boots it once per test file instead,
 * which is slower but isolates module state; vite.config.ts derives the integration
 * project's isolate flag from the same variable.
 *
 * resetDatabase truncates every table before each file, so each worker needs a database of
 * its own: point your database config at workerDatabaseName("app_test") from
 * "@warlock.js/core/tests" (or append VITEST_POOL_ID to the name) when VITEST is set.
 * A spec that changes global configuration opts out with setupTest({ lifetime: "file" }).
 */
const workerLifetime = process.env.WARLOCK_TEST_LIFETIME !== "file";

export default {
  lifetime: workerLifetime ? "worker" : "file",
  resetDatabase: workerLifetime,
  profileSetup: process.env.WARLOCK_TEST_PROFILE === "1",
};
`,
    );
    console.log(`${colors.green("✓")} Created src/config/tests.ts`);
  } else {
    recordSkippedFile(testsConfigPath, "exists");
  }

  const runnerPath = srcPath("test-runner.ts");
  if (!(await fileExistsAsync(runnerPath))) {
    await putFileAsync(
      runnerPath,
      `import { configureTestWorker } from "@warlock.js/core/tests";
import { TestRunner } from "vitest";

// Vitest awaits onCleanupWorkerContext callbacks before recycling the fork.
export default class WarlockTestRunner extends TestRunner {
  public constructor(config: ConstructorParameters<typeof TestRunner>[0]) {
    super(config);
    configureTestWorker(
      { pool: this.pool, watch: config.watch, isolate: config.isolate },
      (cleanup) => this.onCleanupWorkerContext?.(cleanup),
    );
  }
}
`,
    );
  } else {
    recordSkippedFile(runnerPath, "exists");
  }

  // Create vite.config.ts
  const viteConfigPath = rootPath("vite.config.ts");
  const viteConfigExists = await fileExistsAsync(viteConfigPath);

  if (!viteConfigExists) {
    await putFileAsync(
      viteConfigPath,
      `import {
  guardUnitProject,
  lowerStage3Decorators,
  recommendedTestWorkers,
  TestSetupReporter,
} from "@warlock.js/core/vite";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    maxWorkers: recommendedTestWorkers(),
    reporters: ["default", new TestSetupReporter()],
    projects: [
      {
        extends: true,
        // Fails a unit spec that imports a connector, starts a test server or calls
        // setupTest() outside unit mode: those belong to the integration project.
        plugins: [guardUnitProject()],
        test: {
          name: "unit",
          environment: "node",
          pool: "threads",
          env: { WARLOCK_TEST_PROJECT: "unit" },
          include: ["src/**/*.spec.ts"],
          exclude: ["src/**/tests/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          pool: "forks",
          // Worker lifetime shares one module graph per fork, so it needs isolate: false.
          // WARLOCK_TEST_LIFETIME=file switches both back (see src/config/tests.ts).
          isolate: process.env.WARLOCK_TEST_LIFETIME === "file",
          runner: "./src/test-runner.ts",
          globalSetup: "./src/test-global-setup.ts",
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/**/*.test.ts", "src/**/tests/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
        },
      },
    ],
  },
});
`,
    );
    console.log(`${colors.green("✓")} Created vite.config.ts`);
  } else {
    recordSkippedFile(viteConfigPath, "exists");
  }
}

export const testFeature: FeatureDefinition = {
  description: "Installs warlock test for testing",
  onExecuting: completeTestInstallation,
  script: {
    test: "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "test:watch": "vitest --watch",
  },
  devDependencies: {
    "@mongez/vite": "^2.0.4",
    vite: VITE_RANGE,
    vitest: "^5.0.3",
    "@vitest/coverage-v8": "^5.0.3",
  },
};
