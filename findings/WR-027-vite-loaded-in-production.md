# WR-027: Vite loaded in production

Package: `@warlock.js/web` 5.29.0 (with `@warlock.js/core` 5.29.0), Node 22.13.0.
Classification: performance request, measured during the 0.30 performance pass
(`apps/bureau/docs/performance-0.30.md`).

The web connector statically imports Vite, so a production start of a built app
loads it anyway. Rollup's loader calls `process.report.getReport()` for ~0.55 s of
the cold start. Separately, `@fastify/static`, pulled in through Core, calls
`os.cpus()` at load (~0.4-0.5 s). Request: import Vite lazily, only in development
or build mode, and defer optional static-serving setup until first use.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
