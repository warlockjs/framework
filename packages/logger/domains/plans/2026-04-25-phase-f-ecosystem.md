# 2026-04-25 — Phase F: Ecosystem

**Status:** not-started
**Started:** —
**Context:** [backlog](../backlog.md#phase-f--ecosystem) · long-tail features and platform extensions. Ongoing work — items get picked off opportunistically rather than as a single sprint.

## Goal

Round out the ecosystem: CLI, query API, framework bridges, more adapters as the community asks for them.

## Tasks

### F1 — Replay / ingest CLI

- [ ] New binary entry: `npx @warlock.js/logger replay <pattern>`
- [ ] Reads `JSONFileLog` files (the format the package itself writes)
- [ ] Filters: `--level error`, `--module payments`, `--action charge`, `--since "1h ago"`, `--until "2026-04-25T10:00"`
- [ ] Output: pretty-printed (default), `--json` for piping, `--ndjson` for streaming
- [ ] `--follow` watches the file like `tail -f`
- [ ] Tests — golden-file tests against fixture log files

### F2 — Structured query API

- [ ] `log.query({ since, until, level, module, action, where })` — returns `LogMessage[]`
- [ ] Reads `JSONFileLog` files via `storagePath` configured on the channel
- [ ] Streams large files (don't load entire file into memory)
- [ ] Reuses CLI's filter primitives
- [ ] Tests — query crosses chunk-rotated files correctly

### F3 — `FdChannel`

- [ ] `new FdChannel({ fd: number })` writes via `fs.writeSync(fd, ...)`
- [ ] `new FdChannel({ path: "/var/run/app.sock" })` — opens a Unix socket
- [ ] `new FdChannel({ path: "/var/named.pipe" })` — opens a named pipe
- [ ] No buffer (writes synchronously, like `ConsoleLog`)
- [ ] Tests — fd 1 (stdout) end-to-end; mock socket for path mode

### F4 — Express / Fastify middleware bridges

- [ ] Tiny separate packages: `@warlock.js/logger-express`, `@warlock.js/logger-fastify`
- [ ] Each: middleware that creates a child logger with `{ requestId, userId? }` and stashes it on `req.log` / `request.log`
- [ ] Built on Phase B's `child` and `loggerContext`
- [ ] Tests against fixture express/fastify apps

### F5 — Prometheus metrics adapter

- [ ] `@warlock.js/logger-prometheus` package
- [ ] `prometheusAdapter(logger).register()` returns a `prom-client` registry containing logger counters (`logged`, `dropped`, etc.)
- [ ] `prometheusAdapter(logger).expose(port: 9090, path: "/metrics")` starts a tiny HTTP listener
- [ ] Tests against an in-memory `prom-client` registry

### F6 — More adapters added to `logger-adapters` over time

- [ ] **Mattermost** — webhook
- [ ] **MS Teams** — webhook
- [ ] **Splunk HEC** — HTTP Event Collector API
- [ ] **Rollbar** — peer: `rollbar`
- [ ] **Bugsnag** — peer: `@bugsnag/js`
- [ ] **Honeycomb** — peer: `libhoney`
- [ ] **NewRelic Logs** — HTTP only

Each follows the per-adapter checklist from Phase C.

## Verification

These ship piecemeal — each PR has its own test suite and skill doc update. No phase-wide verification needed.

## Critical files

- `@warlock.js/logger/bin/replay.ts` (new — CLI entry)
- `@warlock.js/logger/src/query.ts` (new)
- `@warlock.js/logger/src/channels/fd-channel.ts` (new)
- `@warlock.js/logger-express/` (new package)
- `@warlock.js/logger-fastify/` (new package)
- `@warlock.js/logger-prometheus/` (new package)
- `@warlock.js/logger-adapters/src/transports/{splunk,newrelic,honeycomb}-channel.ts` (new × 3)
- `@warlock.js/logger-adapters/src/error-tracking/{rollbar,bugsnag}-channel.ts` (new × 2)
- `@warlock.js/logger-adapters/src/messaging/{mattermost,teams}-channel.ts` (new × 2)

## Estimate

Open-ended. Pick items as community demand surfaces.

## Open questions

- **Q1.** Should `log.query()` live in core or in a separate `@warlock.js/logger-query` package? **Recommendation:** core — it's a natural counterpart to `JSONFileLog` and pulls no extra deps.
- **Q2.** Express/Fastify bridges — separate packages or sub-paths inside one `@warlock.js/logger-http` package? **Recommendation:** separate — Fastify users don't want Express deps and vice versa.
- **Q3.** Replay CLI — should it support `FileLog` plain-text files too, not just `JSONFileLog`? **Recommendation:** start JSON-only; add a regex parser for plain-text on demand.
