# logger

`@warlock.js/logger` — the logging primitive for Warlock apps. Covers console output, file output (plain + JSON), chunking, rotation, grouping, unhandled-rejection capture.

**Status:** Active — test coverage phase (2026-04-25).

## Layout

- [`docs/`](./docs/) — user-facing guides (getting started, channels, configuration, custom channels, recipes, API reference, types)
- [`plans/`](./plans/) — implementation plans
- [`backlog.md`](./backlog.md) — future enhancements surfaced during the test-coverage phase

No `design/` yet — architectural notes live in the package README and inside the source files. Promote them here once the backlog items that require design work are picked up.

## Package

Source: [`@warlock.js/logger/`](../../@warlock.js/logger/) — Vitest specs colocated with source (`.spec.ts`).

Run the suite from the repo root:

```bash
npx vitest run --root @warlock.js/logger
```
