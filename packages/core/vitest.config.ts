import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Resolve a sibling workspace package to its TypeScript source entry.
 *
 * Several `@warlock.js/*` packages declare `main`/`module` pointing at a
 * compiled `cjs`/`esm` directory that is not built inside this monorepo
 * checkout, so Vite cannot resolve them by name. Aliasing straight to the
 * package's `src/index.ts` lets the unit suite import them during tests
 * without a build step.
 */
const workspaceSource = (packageName: string) => {
  return path.resolve(__dirname, `../${packageName}/src/index.ts`);
};

export default defineConfig({
  resolve: {
    alias: {
      "@warlock.js/seal": workspaceSource("seal"),
      "@warlock.js/cascade": workspaceSource("cascade"),
      "@warlock.js/context": workspaceSource("context"),
      "@warlock.js/logger": workspaceSource("logger"),
      "@warlock.js/cache": workspaceSource("cache"),
      "@warlock.js/fs": workspaceSource("fs"),
      "@warlock.js/auth": workspaceSource("auth"),
      "@warlock.js/herald": workspaceSource("herald"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/{unit,integration}/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
