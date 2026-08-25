# B3 — Part 2: prod entry registers config-declared connectors (core)

Originals snapshotted beside this file as `<name>.orig`. No git operations were run.

## NEW src/connectors/register-configured-connectors.ts

- `registerConfiguredConnectors(): void` reads `connectors` off the resolved
  warlock config (`warlockConfigManager.get("connectors")`, the same getter the
  production builder uses) and registers each with `connectorsManager`.
- Skips any connector whose `name` the manager already holds, so repeated calls
  (generated entry, dev preloader) never stack duplicates that would boot and
  shut down twice.
- No-ops when the config manager is not loaded: `get` throws in that state, and
  an app that never loads a warlock config reaches this line legitimately.
  FOLLOW-UP for whoever wires the prod runtime: nothing in the generated entry
  loads the warlock config today (`bootstrap.ts` does not, and the generated
  `config-loader.ts` only loads `src/config/*`), so in a real production bundle
  this currently registers nothing. The registration point is correct; the
  config being resolved at that point is a separate wiring task.

## src/connectors/connectors-manager.ts

- Added `has(name: ConnectorName): boolean` — the minimal lookup the idempotent
  registration needs; the manager exposed no name lookup before.

## src/connectors/index.ts

- Exports `./register-configured-connectors`, so the generated entry (via
  `@warlock.js/core`) and the dev preloader call one implementation.

## src/production/production-builder.ts

- `generateEntryPoint()` emits a new section 2.5 between `./config-loader` and
  the early-phase start: the `registerConfiguredConnectors` import plus its call.

## Tests

- `tests/unit/production/generate-entry-point.test.ts`: the exact-import-lines
  assertion now includes the registration import; new describe asserts the
  import sits after `./config-loader`, the call after the import, and the early
  phase after the call — and that the call is emitted exactly once.
- `tests/unit/production/production-builder.contributions.test.ts`: the existing
  `warlockConfigManager` mock gained `isLoaded: true`; new describe covers
  registering a config connector, calling twice registering once, skipping a
  name already held (`http`), and an empty config array changing nothing.

## Verification

    node ../node_modules/vitest/vitest.mjs run \
      tests/unit/production/generate-entry-point.test.ts \
      tests/unit/production/production-builder.contributions.test.ts
    → 2 files passed, 24 tests passed
