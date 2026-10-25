import type { Codemod, CodemodOutput } from "../types";

const VITE_CONFIG_FILE = /^vite(st)?\.config\.(ts|mts|cts|js|mjs|cjs)$/;
const TESTS_CONFIG_FILE = "src/config/tests.ts";

function lineOf(source: string, needle: RegExp): number {
  const index = source.search(needle);

  return index < 0 ? 1 : source.slice(0, index).split("\n").length;
}

/**
 * 5.38: new apps run the test framework once per Vitest worker with a reset
 * between files, and the generated unit project guards against app imports.
 * Existing apps keep exactly what they have; this codemod only points at the
 * two places to opt in. It edits nothing.
 *
 * - `src/config/tests.ts` without a `lifetime` boots the framework once per
 *   test file. The finding names the three settings that switch it, and the
 *   per-worker database the reset needs.
 * - A Vitest config with a `unit` project and no `guardUnitProject()` does not
 *   fail a unit spec that imports a connector or boots the app.
 */
export const testRuntimeDefaults: Codemod = {
  id: "test-runtime-worker-lifetime",
  version: "5.38.0",
  package: "@warlock.js/core",
  title: "Review the test runtime lifetime and the unit-project guard",
  skill: "test-service",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    const testsConfig = context.text.read(TESTS_CONFIG_FILE);

    if (testsConfig !== undefined && !/\blifetime\b/.test(testsConfig)) {
      output.manual.push({
        file: TESTS_CONFIG_FILE,
        line: 1,
        hint: 'This app boots the framework once per test file. New apps boot it once per Vitest worker instead, which cuts setup time on large suites. To opt in: set `lifetime: "worker"` and `resetDatabase: true` here, set `isolate: false` on the integration project in the Vitest config, and give each worker its own database with `workerDatabaseName("app_test")` from `@warlock.js/core/tests`. A spec that changes global configuration opts out with `setupTest({ lifetime: "file" })`. Nothing changes until you do.',
      });
    }

    for (const file of context.text.list()) {
      if (!VITE_CONFIG_FILE.test(file)) continue;

      const config = context.text.read(file);

      if (config === undefined || !/name\s*:\s*["']unit["']/.test(config)) continue;
      if (/\bguardUnitProject\b/.test(config)) continue;

      output.manual.push({
        file,
        line: lineOf(config, /name\s*:\s*["']unit["']/),
        hint: 'The `unit` project can run a spec that imports a connector or boots the app and then fails with an unrelated error. Add `plugins: [guardUnitProject()]` (from `@warlock.js/core/vite`) and `env: { WARLOCK_TEST_PROJECT: "unit" }` to the project so such a spec fails with a message naming the import. `warlock check` (WL9021) also lists integration specs that never touch the app.',
      });
    }

    return output;
  },
};
