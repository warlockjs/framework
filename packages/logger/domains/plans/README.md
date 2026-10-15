# logger — plans

Implementation plans for the `logger` domain. Active plans sit here; finished ones move to `archive/`.

## Completed (archived)

- [2026-04-25 — Comprehensive unit tests](./archive/2026-04-25-unit-tests.md) — vitest migration, auto-flush, docs sweep, skill files. Long superseded: the suite now stands at **189 tests** after the 2026-06-01 release-prep pass (see [`../backlog.md`](../backlog.md)).

## Roadmap (not started)

Each phase below has its own plan file. See [`../backlog.md`](../backlog.md) for the full feature list.

- [Phase A — Production credibility](./2026-04-25-phase-a-production-credibility.md) — pluggable buffer store, redaction, pino-stream shim, sampling, metrics
- [Phase B — Context revolution](./2026-04-25-phase-b-context-revolution.md) — child loggers, AsyncLocalStorage propagation via `@warlock.js/context`, Cascade bridge, `flushAsync`
- [Phase C — Integrations sprint](./2026-04-25-phase-c-integrations-sprint.md) — `@warlock.js/logger-adapters` package: Slack, Discord, Telegram, Sentry, Loki, Datadog, Elastic, CloudWatch, more
- [Phase D — Platform maturity](./2026-04-25-phase-d-platform-maturity.md) — pluggable formatters (ECS / pino / logfmt), custom levels with TS augmentation, OTel bridge, dedupe, hot-reload
- [Phase E — DX polish](./2026-04-25-phase-e-dx-polish.md) — pretty mode, `log.timer`, `log.assert`, `log.when`, crash-dump rescue, env presets, log signing
- [Phase F — Ecosystem](./2026-04-25-phase-f-ecosystem.md) — replay CLI, query API, `FdChannel`, Express/Fastify bridges, Prometheus metrics, more adapters
