# 2026-04-25 — Phase C: Integrations sprint

**Status:** not-started
**Started:** —
**Context:** [backlog](../backlog.md#phase-c--integrations-sprint) · the marketing surface. Single package, lazy-loaded peers — same pattern as [`@warlock.js/cascade/src/drivers/mongodb/mongodb-driver.ts`](../../../@warlock.js/cascade/src/drivers/mongodb/mongodb-driver.ts) and [`@warlock.js/core/src/storage/drivers/cloud-driver.ts`](../../../@warlock.js/core/src/storage/drivers/cloud-driver.ts).

## Goal

Ship `@warlock.js/logger-adapters` with 13 channel implementations. Each ~50–100 LOC. The peer SDK is what users `npm install` only when they actually need that integration.

## Architecture

```
@warlock.js/logger-adapters/
├── src/
│   ├── shared/
│   │   ├── batching-mixin.ts       (collect + send every N or every M ms)
│   │   ├── retry-helper.ts         (5xx, 429, network errors → exponential backoff)
│   │   └── lazy-load.ts            (utility for the cascade-style lazy peer load)
│   ├── messaging/
│   │   ├── slack-channel.ts
│   │   ├── discord-channel.ts
│   │   ├── telegram-channel.ts
│   │   ├── email-channel.ts
│   │   ├── webhook-channel.ts      (no peer — pure fetch)
│   │   └── pagerduty-channel.ts
│   ├── error-tracking/
│   │   └── sentry-channel.ts
│   ├── transports/
│   │   ├── loki-channel.ts
│   │   ├── datadog-channel.ts
│   │   ├── elasticsearch-channel.ts
│   │   ├── cloudwatch-channel.ts
│   │   ├── betterstack-channel.ts
│   │   └── axiom-channel.ts
│   └── index.ts
└── _package.json    (peers all marked optional)
```

## Tasks

### Shared utilities (do these FIRST — every adapter depends on them)

- [ ] **C14 — `BatchingChannelMixin`** — buffers entries, flushes every `batchSize` or every `flushInterval` ms; gzip optional. Used by every HTTP-based adapter.
- [ ] **C15 — Retry helper** — adapt the cascade `withRetry` pattern: exponential backoff, retryable-error classification (5xx, 429, ECONNRESET, ETIMEDOUT).
- [ ] **`lazy-load` utility** — generalizes the `loadMongoDB()` / `loadS3()` / `loadPg()` pattern so each adapter doesn't duplicate ~30 lines.

### Messaging / alerting

- [ ] **C1 — `SlackChannel`** (peer: webhook URL or `@slack/web-api`)
- [ ] **C2 — `DiscordChannel`** (peer: `discord.js` for richer embeds, or webhook URL only)
- [ ] **C3 — `TelegramChannel`** (peer: `node-telegram-bot-api` or just fetch on Bot API)
- [ ] **C4 — `EmailChannel`** (peer: `nodemailer`) — designed for digest mode, not per-entry
- [ ] **C5 — `GenericWebhookChannel`** (no peer — fetch + Mustache-style template)
- [ ] **C6 — `PagerDutyChannel`** (peer: HTTP only against Events API v2)

### Error tracking

- [ ] **C7 — `SentryChannel`** (peer: `@sentry/node`) — error logs become Sentry events; preserves `stack`, attaches `module`/`action`/`context` as breadcrumbs

### Log aggregators

- [ ] **C8 — `LokiChannel`** (HTTP only) — Loki push API, batched
- [ ] **C9 — `DatadogChannel`** (HTTP only) — Datadog Logs ingestion
- [ ] **C10 — `ElasticsearchChannel`** (peer: `@elastic/elasticsearch`)
- [ ] **C11 — `CloudWatchChannel`** (peer: `@aws-sdk/client-cloudwatch-logs`)
- [ ] **C12 — `BetterStackChannel`** (HTTP only)
- [ ] **C13 — `AxiomChannel`** (HTTP only)

## Per-adapter checklist (template)

For each of C1–C13:

- [ ] `extends LogChannel<XxxConfig>` with explicit `name`, `description`
- [ ] Lazy peer SDK load + `XXX_INSTALL_INSTRUCTIONS` (if peer required)
- [ ] `init()` validates required config (URL, token, etc.) and warms the peer
- [ ] `log(data)` calls `shouldBeLogged` first, then the adapter-specific delivery
- [ ] Uses `BatchingChannelMixin` if HTTP-based
- [ ] Uses retry helper for transient failures
- [ ] `flushSync()` and `flushAsync()` drain the batch buffer
- [ ] Tests: success path + retry path + missing peer SDK error message
- [ ] Skill subdoc `domains/logger/skills/subskills/adapters/<name>.md` — install + config + recipes

## Verification

- Each adapter has unit tests against a mocked HTTP layer
- One integration test per category (Slack happy path, Sentry error event, Loki push) using `nock` or `msw`
- README per adapter in the package showing minimal config

## Critical files

- `@warlock.js/logger-adapters/_package.json` (every peer marked `peerDependenciesMeta: { ..., optional: true }`)
- `@warlock.js/logger-adapters/src/index.ts` (barrel)
- `@warlock.js/logger-adapters/src/shared/*.ts`
- `@warlock.js/logger-adapters/src/messaging/*.ts`
- `@warlock.js/logger-adapters/src/error-tracking/*.ts`
- `@warlock.js/logger-adapters/src/transports/*.ts`
- `@warlock.js/logger-adapters/skills/SKILL.md` + `subskills/`
- `domains/logger-adapters/` (new domain folder mirroring `domains/logger/`)

## Estimate

~3 weeks. Adapters are parallelizable — 4–5 per week with the shared utilities ready.

## Open questions

- **Q1.** Should the shared utilities live in core `@warlock.js/logger` or in `logger-adapters`? **Recommendation:** `logger-adapters` until a third-party custom channel needs them — then promote to core. Avoids API commitment.
- **Q2.** `EmailChannel` digest mode — buffer until `emailEvery: "1h"` or until N errors? **Recommendation:** both — `digestEvery: "1h"` with `digestMaxEntries: 50` short-circuit.
- **Q3.** Should `SentryChannel` swallow the original log call, or fan out to both Sentry and other channels? **Recommendation:** fan out — Sentry is a sink, not a transformer. The `Logger` already broadcasts; Sentry is just one destination among many.
