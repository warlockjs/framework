import { transform } from "esbuild";
import path from "path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Lower TC39 Stage 3 (native) decorators to runnable JS before the rest of the
 * pipeline sees them.
 *
 * Why this is needed: cascade declares relations with native decorators
 * (`@RegisterModel`, `@BelongsTo`, `@HasMany`, …). Vitest's bundled
 * rolldown-vite transforms `.ts` with **oxc**, which leaves the native `@` in
 * its output — Node's V8 then throws "SyntaxError: Invalid or unexpected
 * token". oxc can only lower *legacy* decorators, and legacy lowering would
 * mangle the Stage 3 `(value, context)` signature these decorators depend on
 * (they read `context.kind` / `context.metadata`).
 *
 * esbuild, by contrast, lowers Stage 3 decorators correctly while preserving
 * their runtime semantics. This `pre` plugin runs esbuild on the handful of
 * cascade source/test files that actually contain a decorator, handing oxc
 * already-lowered, decorator-free code. Files with no decorator are skipped so
 * the default fast path is untouched.
 */
function lowerStage3Decorators(): Plugin {
  return {
    name: "cascade:lower-stage3-decorators",
    enforce: "pre",
    async transform(code, id) {
      const [filepath] = id.split("?");

      if (!filepath.endsWith(".ts") || filepath.includes("/node_modules/")) {
        return null;
      }

      // Cheap gate: only files with a decorator usage pay the esbuild cost.
      if (!/(^|\n)\s*@[A-Za-z_$]/.test(code)) {
        return null;
      }

      const result = await transform(code, {
        loader: "ts",
        format: "esm",
        target: "es2022",
        sourcemap: true,
        sourcefile: filepath,
      });

      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [lowerStage3Decorators()],
  resolve: {
    alias: {
      "@warlock.js/context": path.resolve(__dirname, "../context/src"),
      "@warlock.js/seal": path.resolve(__dirname, "../seal/src"),
      "@warlock.js/logger": path.resolve(__dirname, "../logger/src"),
      "@warlock.js/core": path.resolve(__dirname, "../core/src"),
      "@warlock.js/auth": path.resolve(__dirname, "../auth/src"),
      "@warlock.js/cache": path.resolve(__dirname, "../cache/src"),
      "@warlock.js/scheduler": path.resolve(__dirname, "../scheduler/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests boot real containers and run via vitest.integration.config.ts.
    // Keep them out of the default + coverage runs so those stay fast and offline.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/**/types.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    // Timeout for tests (some integration tests may need more time)
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
