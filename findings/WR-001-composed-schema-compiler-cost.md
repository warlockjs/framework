# WR-001: Composed schema compiler cost

Packages: `@warlock.js/seal`, `@warlock.js/core` and `@warlock.js/web` 5.29.0;
TypeScript 5.9.3; TypeScript ESLint parser/plugin 8.71.1.

The frozen Bureau source at tree `379c4419435c8c426f0359d9380889a3b1687544`
reproduces the resource failure with the committed lockfile and tsconfig:

```sh
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --extendedDiagnostics
node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --extendedDiagnostics
```

The first run aborts after approximately 62 seconds. The second passes in about
44 seconds and reports 4,856,547K memory, 2,003,765 types and 5,418,851
instantiations. Profiling shows distributed costs from nested object/union
validator graphs and inferred output consumed across services. Three checked
public schema boundaries reduce approximately 93MB but still fail with the 4GiB
ceiling; that experiment was discarded. Larger heap peaks are influenced by
garbage collection and are not themselves proof of default-heap failure.

Request: an official compact schema/DTO boundary or inference optimization that
preserves input/output inference, tagged narrowing, Standard Schema and JSON/
OpenAPI methods, plus a large-composed-schema compiler-memory benchmark.

Workaround: compiler-only 8GiB ceilings in build/type/lint commands. Runtime and
browser memory settings are unchanged. There is no standalone minimal package
reproducer yet, so this is not classified as a proven Seal implementation bug.

Evidence: `/tmp/bureau-2-type-memory-ready-7iljzdzk/manifest.json`, its profiles,
logs and discarded patch; [compiler-resources.md](compiler-resources.md).

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
