import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

/**
 * Integration-scoped vitest config for `@warlock.js/cascade`.
 *
 * It reuses the base config's `plugins` (notably the Stage 3 decorator lowering)
 * and module `resolve` aliases, but narrows the run to `tests/integration/**`
 * and grants the long timeouts real containers need — a cold Postgres or
 * MongoDB container can take ~50s to boot on first pull.
 *
 * Coverage is intentionally omitted here: the integration suite is a thin
 * end-to-end smoke layer, not the source of coverage truth (the unit suite is).
 * Inheriting the base 80% thresholds would fail a focused integration run.
 *
 * Run it from the monorepo root (Docker's bin must be on PATH so
 * `docker-credential-desktop` resolves):
 *
 *   $env:PATH = "$env:ProgramFiles\Docker\Docker\resources\bin;" + $env:PATH
 *   yarn vitest run --root cascade --config vitest.integration.config.ts
 */
export default defineConfig({
  plugins: baseConfig.plugins,
  resolve: baseConfig.resolve,
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
