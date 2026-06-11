import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror cascade's alias set — these are the siblings that core's
    // barrel transitively imports (auth/scheduler) plus the ones we
    // directly import (cache/cascade/core/logger).
    alias: {
      "@warlock.js/auth": path.resolve(__dirname, "../auth/src"),
      "@warlock.js/cache": path.resolve(__dirname, "../cache/src"),
      "@warlock.js/cascade": path.resolve(__dirname, "../cascade/src"),
      "@warlock.js/context": path.resolve(__dirname, "../context/src"),
      "@warlock.js/core": path.resolve(__dirname, "../core/src"),
      "@warlock.js/fs": path.resolve(__dirname, "../fs/src"),
      "@warlock.js/herald": path.resolve(__dirname, "../herald/src"),
      "@warlock.js/logger": path.resolve(__dirname, "../logger/src"),
      "@warlock.js/scheduler": path.resolve(__dirname, "../scheduler/src"),
      "@warlock.js/seal": path.resolve(__dirname, "../seal/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/**/types.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    testTimeout: 10_000,
  },
});
