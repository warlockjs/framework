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
    /**
     * Pin NODE_ENV for the whole suite.
     *
     * Vitest only defaults this to "test" when it is UNSET, so an ambient
     * `NODE_ENV=production` in a developer's shell or a CI image is inherited
     * instead and the suite silently exercises production branches. This
     * machine exports exactly that, and several sources here branch on it.
     *
     * A test whose verdict tracks the machine it runs on is worse than a
     * failing one. Specs that want the production branch set it themselves,
     * per-test, and restore it afterwards.
     */
    env: { NODE_ENV: "test" },
    environment: "node",
    /**
     * Card 7761af8f: this include glob used to be ONLY
     * `tests/{unit,integration}/**\/*.test.ts`, so a spec written next to
     * the code it tests (`src/**\/*.spec.ts`, the convention `auth`, `web`
     * and `access` already run, and the shape `skills/code-standards`
     * documents) silently never ran — it passed review, it was committed,
     * and it reported nothing, forever.
     *
     * Widened to run BOTH shapes rather than migrating core's hundreds of
     * `tests/**` files to be colocated: three sibling packages already run
     * colocated specs and the project's own code-standards convention calls
     * for colocated, but core has hundreds of files under `tests/` and a
     * mass move immediately before a release buys nothing and risks a lot.
     * This removes the silent-skip failure mode today; a later, deliberate
     * consolidation can move files when nothing is in flight. (Decided by
     * the lead on card 7761af8f, not drifted into.)
     */
    include: ["tests/{unit,integration}/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
