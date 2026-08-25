# B3.1 — bake config connectors into the generated prod entry (kill the silent no-op)

Follow-up to B3. Originals snapshotted beside this file as `<name>.orig`. No git
operations were run.

## Problem

The generated entry called `registerConfiguredConnectors()` with no argument, and
nothing inside a production bundle ever loads `warlock.config.ts` — the generated
`bootstrap.ts` does not, and `config-loader.ts` only loads `src/config/*`. The
`isLoaded` guard therefore made the call a no-op in every real artifact: the
bundle registered ZERO config-declared connectors and reported success.

## Fix — bake the array at build time

The config is imported statically by the generated entry, so esbuild bundles it
into the artifact. The array the build drained contributions from is literally
the array the runtime registers. No runtime file load, no drift, nothing to
resolve on disk beside the bundle.

### src/connectors/register-configured-connectors.ts

- Signature is now `registerConfiguredConnectors(connectors?: Connector[]): void`.
- Array PASSED → registers from it (skipping names the manager already holds) and
  never touches `warlockConfigManager`. This is the production-entry path.
- Array OMITTED → reads `warlockConfigManager.get("connectors") ?? []` as before,
  for the dev preloader.
- The silent `if (!isLoaded) return;` is GONE. The omitted path now throws
  `"registerConfiguredConnectors: warlock config is not loaded; pass the
  connectors array explicitly or load the config first"` — an unloaded config is
  a caller asking to read a source that does not exist yet, not "nothing to do".
- Manager read moved into a private `configuredConnectors()` helper so the throw
  sits on the only path that can hit it.

### src/production/production-builder.ts

- New module constant `APP_ROOT_FROM_PRODUCTION_DIR = "../../"` — the hop from
  `.warlock/production/` back to the app root, already spelled out inline in the
  `../../src/app/…` (`globModule`, `globModuleDirectory`) and `../../src/config/…`
  (`generateConfigLoader`) imports. Named once so a generator reaching a new
  app-root file cannot pick a different depth.
- `generateEntryPoint()` section 2.5 now emits a static default import of the
  app's `warlock.config` and passes its `connectors`. Relative, so the
  `assertGeneratedImportsAreDeclared` bare-specifier check is unaffected.

Emitted section 2.5, verbatim:

    // 2.5 Register connectors declared in warlock.config (the same array this
    //     build read its contributions from, so built-for and boots-with match).
    //     The config is imported STATICALLY so esbuild bakes it into the bundle
    //     and the array is handed over explicitly — an artifact has no
    //     warlock.config.ts beside it to read at runtime, and a registration
    //     that quietly found nothing to register is the exact drift this
    //     section exists to prevent.
    import { registerConfiguredConnectors } from "@warlock.js/core";
    import warlockConfig from "../../warlock.config";
    registerConfiguredConnectors(warlockConfig.connectors ?? []);

Position is unchanged: after `import "./config-loader";`, before the early-phase
`connectorsManager.startPhase(ConnectorLifecyclePhase.Early)`.

Resolution check: `warlock.config.ts` sits at the app root and the entry is
generated at `.warlock/production/app.ts`, so `../../warlock.config` is the same
two-level hop the generated `../../src/app/…` imports already use and rely on.
The config exports `default` (see `WarlockConfigManager.doLoad`, which reads
`configModule.default`), so a default import is the right shape.

## Tests (existing files extended, no new files)

`tests/unit/production/generate-entry-point.test.ts`

- Exact-import-lines assertion gained `import warlockConfig from "../../warlock.config";`.
- Section 2.5 ordering now also pins the config import between the
  `registerConfiguredConnectors` import and the call.
- New: the config import uses the app-root `../../` hop.
- New: the call passes the array explicitly, and the old no-argument form
  `registerConfiguredConnectors();` is asserted ABSENT.
- New: a config with no `connectors` key is covered by the emitted `?? []`
  fallback — asserted on the whole emitted line, not a substring.
- Once-only assertion retargeted at the new call text.

`tests/unit/production/production-builder.contributions.test.ts`

- The `warlockConfigManager` mock's `isLoaded` became a getter over a mutable
  hoisted flag, so the unloaded case needs no second module mock.
- Split into two describes: explicit-array (production entry) — registers,
  dedupes, empty array is a no-op, and `warlockConfigManager.get` is asserted
  NOT called; omitted-array (dev preloader) — reads the loaded config, and
  THROWS when the config is not loaded (this replaces the old silent-skip
  assertion "does nothing when the config declares no connectors").

## Verification

    node ../node_modules/vitest/vitest.mjs run \
      tests/unit/production/generate-entry-point.test.ts \
      tests/unit/production/production-builder.contributions.test.ts
    → 2 files passed, 31 tests passed

`tsc --noEmit` reports no error in either touched source file. The two TS2790
`delete this.options.*` errors in `production-builder.ts` `bundle()` are
pre-existing (present in `production-builder.ts.orig` at the same statements)
and untouched here.
