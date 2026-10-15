# WR-019: Logger methods return promises

Package: `@warlock.js/logger` 5.29.0.
Classification: API/DX request.

`log.info/warn/error(...)` return `Promise<this>`, so every call site trips
`@typescript-eslint/no-floating-promises`. The Bureau lint gate flagged about
60 sites, all fixed with `await` in async code or `void` in synchronous
callbacks. Channel fan-out is synchronous in practice, so the returned promise
carries no useful rejection. Request: synchronous `void` methods plus an
explicit `flush()`, or documented fire-and-forget semantics.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
