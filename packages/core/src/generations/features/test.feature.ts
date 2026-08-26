import { colors } from "@mongez/copper";
import { fileExistsAsync, putFileAsync } from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import { FeatureDefinition } from "./types";

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
 */
import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";

export async function setup() {
  await startHttpTestServer();
}

export async function teardown() {
  await stopHttpTestServer();
}
`,
    );
    console.log(`${colors.green("✓")} Created src/test-global-setup.ts`);
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
 * setupTest() is called with no options on purpose: an explicit connectors
 * value outranks tests.connectors from src/config/tests.ts, so passing one
 * here would erase your project config. Omitting it leaves the config in
 * charge.
 *
 * afterAll(teardownTest) is the other half of the pair: whoever calls
 * setupTest() owns closing it in the same runtime context.
 */
import { setupTest, teardownTest } from "@warlock.js/core/tests";
import { afterAll } from "vitest";

await setupTest();

afterAll(teardownTest);
`,
    );
    console.log(`${colors.green("✓")} Created src/test-setup.ts`);
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
    include: ["src/app/**/*.test.ts"],
  },
});
`,
    );
    console.log(`${colors.green("✓")} Created vite.config.ts`);
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
    vite: "^8.0.16",
    vitest: "^4.1.8",
    "@vitest/coverage-v8": "^4.1.8",
  },
};
