import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// Anchor sibling-package aliases to this config file's own directory, not
// `process.cwd()`, so the suite resolves the same way whether it runs from
// this package or from the monorepo root with `--root ai-cli`.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@warlock.js/ai": path.resolve(here, "../ai/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.spec.ts"],
  },
});
