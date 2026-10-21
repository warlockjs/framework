import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@warlock.js/core": resolve(import.meta.dirname, "../core/src/index.ts"),
      "@warlock.js/cascade": resolve(import.meta.dirname, "../cascade/src/index.ts"),
      "@warlock.js/logger": resolve(import.meta.dirname, "../logger/src/index.ts"),
      "@warlock.js/seal": resolve(import.meta.dirname, "../seal/src/index.ts"),
      "@warlock.js/fs": resolve(import.meta.dirname, "../fs/src/index.ts"),
      "@warlock.js/cache": resolve(import.meta.dirname, "../cache/src/index.ts"),
      "@warlock.js/auth": resolve(import.meta.dirname, "../auth/src/index.ts"),
      "@warlock.js/context": resolve(import.meta.dirname, "../context/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.spec.ts"],
  },
});
