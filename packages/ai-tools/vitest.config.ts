import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// Anchor sibling-package aliases to this config file's own directory,
// not `process.cwd()`. Running the suite from the monorepo root with
// `vitest run --root ai-tools` leaves cwd at the root, so a
// cwd-relative `./../ai` would resolve one level too high and fail to
// find the package. Resolving against this file's directory keeps the
// targets correct regardless of where the command is invoked.
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
