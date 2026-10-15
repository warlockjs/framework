import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Anchor sibling-package aliases to this config file's own directory, not
// `process.cwd()`. The suite is run from the monorepo root with
// `vitest run --root herald` (per-package `npx vitest` is broken by the
// workspace symlink), which leaves cwd at the root — so a cwd-relative target
// would resolve one level too high. Resolving against `here` keeps the runtime
// `@warlock.js/*` imports (seal's `v`, logger) pointing at TS source, since
// those packages publish only built `cjs/` that isn't present in the workspace.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@warlock.js/seal": path.resolve(here, "../seal/src/index.ts"),
      "@warlock.js/logger": path.resolve(here, "../logger/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
