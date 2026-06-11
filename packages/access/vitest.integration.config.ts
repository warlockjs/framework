import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

/**
 * Integration-scoped vitest config for `@warlock.js/access`.
 *
 * Reuses the base config's `@warlock.js/*` source aliases but narrows the run
 * to `tests/integration/**` and grants the long timeouts a real Postgres /
 * MongoDB container needs (~50s cold boot). OPT-IN: the default `vitest run`
 * only globs `src/**\/*.spec.ts`, so a machine without Docker still gets a fully
 * green unit suite. Run explicitly (Docker must be running):
 *
 *   npx vitest run --config vitest.integration.config.ts
 */
export default defineConfig({
  resolve: baseConfig.resolve,
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
