# Changelog — @warlock.js/core

All notable changes to `@warlock.js/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

- `lowerStage3Decorators()` — shared Vite/Vitest plugin that lowers TC39 Stage-3 decorators with esbuild before oxc / the SSR rewrite mangles them. Drop it first in a config's `plugins` so model-decorated files load under Vitest 4 / Vite 8.
- `warlock add test` now scaffolds a `vite.config.ts` that includes `lowerStage3Decorators()`, so a fresh project can test decorated models out of the box.
- `warlock add test` `test`/`test:coverage` scripts now run one-shot (`vitest run`) instead of watch mode — safe for CI by default.
- `startHttpTestServer` now starts early-phase connectors (database, cache, logger, …) **before** loading app modules, then late-phase connectors (http, socket) after — mirroring the dev/prod boot order. Fixes a `MissingDataSourceError` when a module's `main.ts` boot side-effect queries the DB at import time under the Vitest integration harness.

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
