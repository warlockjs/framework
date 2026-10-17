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
 * Vitest runs setupFiles before each test file and rebuilds the module
 * registry with it, so this pair boots and closes the test runtime once per
 * test file.
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
import { afterAll } from "vitest";

await setupTest({ importModule: (file) => import(file) });

afterAll(teardownTest);
`,
    );
    console.log(`${colors.green("✓")} Created src/test-setup.ts`);
  } else {
    recordSkippedFile(testSetupPath, "exists");
  }

  // Create vite.config.ts
  const viteConfigPath = rootPath("vite.config.ts");
  const viteConfigExists = await fileExistsAsync(viteConfigPath);

  if (!viteConfigExists) {
    await putFileAsync(
      viteConfigPath,
      `import { lowerStage3Decorators } from "@warlock.js/core/vite";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // lowerStage3Decorators MUST come first: it lowers native (@RegisterModel, …)
  // decorators with esbuild before oxc / the SSR rewrite can mangle them, so
  // decorated Cascade models load under Vitest.
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    globalSetup: "./src/test-global-setup.ts", // HTTP server - runs once
    setupFiles: ["./src/test-setup.ts"],       // DB/cache - runs per test file
    environment: "node",
    globals: false,
    include: ["src/app/**/*.{test,spec}.ts"],
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
    vitest: "^4.1.8",
    "@vitest/coverage-v8": "^4.1.8",
  },
};
