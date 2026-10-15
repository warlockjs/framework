# WR-017: Core root import reaches optional subsystems

Package: `@warlock.js/core` 5.29.0 (root export only), Node 22.13.0, esbuild 0.27.7.
Classification: packaging feature request, confirmed by a reproducible bundle failure.

Expected: a small standalone program that imports one public error class
(`BadRequestError`/`HttpError`) can be bundled without the application runtime.
Actual: Core exposes only its root entry, and that root initializes Cascade,
Cache, Web and the MongoDB driver. Bundling the Bureau managed native helper
(`scripts/build-managed-native-helper.mjs`) failed with
`Could not resolve "mongodb"` from `@warlock.js/cascade/esm/drivers/mongodb`;
declaring Core's graph side-effect free still kept
`cascade/esm/context/database-data-source-context.mjs` live.

Workaround (application, 2026-10-15): the helper bundle substitutes two
Bureau-owned error modules with core-free variants of the same class names and
codes (`*-helper.error.ts`). No package API is aliased. The bundle guard now
refuses any Core or optional-subsystem input. Request: side-effect-free subpath
exports such as `@warlock.js/core/errors`, plus a `sideEffects` declaration.
This resolves the earlier "standalone native helper dependency closure"
investigation.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
