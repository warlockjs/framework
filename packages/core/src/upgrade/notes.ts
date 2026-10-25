import type { UpgradeNote } from "./types";

/**
 * Breaking changes with nothing to edit in source: they change data or
 * operations. Printed so the rollout plans for them.
 */
export const UPGRADE_NOTES: readonly UpgradeNote[] = [
  {
    version: "5.38.0",
    text: 'New apps (`warlock add test`, create-warlock) boot the test framework once per Vitest worker (`tests.lifetime: "worker"`, `resetDatabase: true`, `isolate: false`, one database per worker) and guard the unit project against app imports. Existing apps keep their test configuration unchanged; the `test-runtime-worker-lifetime` step lists where to opt in. A spec that changes global configuration opts out of a worker runtime with `setupTest({ lifetime: "file" })`.',
  },
  {
    version: "5.36.0",
    text: "Vitest 5 changes defaults: `clearMocks` is true, `json`/`junit` reporters write to `.vitest/` instead of stdout, `-t` joins names with ` > `, nested `vi.mock`/`vi.hoisted` calls throw and unawaited `resolves`/`rejects` assertions fail the test. `clearMocks: true` also clears the calls a module made when it was imported (for example a scheduler registering jobs from a `main.ts`) before the first test runs, so a test asserting those calls fails: import the module inside the test, or set `clearMocks: false`. Vite 8 needs Node.js 20.19 or 22.12+ and bundles with Rolldown.",
  },
  {
    version: "5.34.0",
    text: "ESLint and Prettier support is gone in 5.34.0. Oxlint/Oxfmt is the only toolchain. The oxc-toolchain-removal step migrates remaining legacy configs/dependencies; review its manual findings. New/migrated templates enable correctness: error, which may report additional defects.",
  },
  {
    version: "5.30.0",
    text: "Auth login throttle keys are hashed: counters and lockouts written by 5.29 are forgotten on upgrade (locked accounts and IPs unlock).",
  },
  {
    version: "5.30.0",
    text: "Image derivatives use a new cache layout: the first request re-renders each one. Delete the old two-level cache folders once the rollout is done.",
  },
];
