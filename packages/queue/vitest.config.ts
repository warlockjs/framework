import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Workspace siblings resolve to their sources, mirroring notifications'
    // alias set (core's barrel transitively imports these).
    alias: {
      "@warlock.js/auth": path.resolve(__dirname, "../auth/src"),
      "@warlock.js/cache": path.resolve(__dirname, "../cache/src"),
      "@warlock.js/cascade": path.resolve(__dirname, "../cascade/src"),
      "@warlock.js/context": path.resolve(__dirname, "../context/src"),
      "@warlock.js/core": path.resolve(__dirname, "../core/src"),
      "@warlock.js/fs": path.resolve(__dirname, "../fs/src"),
      "@warlock.js/herald": path.resolve(__dirname, "../herald/src"),
      "@warlock.js/logger": path.resolve(__dirname, "../logger/src"),
      "@warlock.js/notifications": path.resolve(__dirname, "../notifications/src"),
      "@warlock.js/scheduler": path.resolve(__dirname, "../scheduler/src"),
      "@warlock.js/seal": path.resolve(__dirname, "../seal/src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Every spec talks to ONE real Redis; run files one at a time so timing
    // assertions (delay, priority, shutdown) are not skewed by sibling files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
