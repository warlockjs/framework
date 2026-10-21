import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@warlock.js/ai": resolve(import.meta.dirname, "../ai/src/index.ts"),
      "@warlock.js/cache": resolve(import.meta.dirname, "../cache/src/index.ts"),
      "@warlock.js/logger": resolve(import.meta.dirname, "../logger/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.spec.ts"],
  },
});
