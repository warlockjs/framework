---
name: request-log
description: 'Persistent, redacted request log (`http.logging.requests`) — one JSON record per request in `storage/logs/requests/YYYY-MM-DD.jsonl`, kept after restarts: URL, route, status, timing, redacted headers/body/response, log entries, query count with N+1, and the 5xx error with stack, phase, page file and site. Covers `enabled`/`only`/`slowMs`/`sampleRate`/`include`/`maxBodyBytes`/`retention`/`channels`, production defaults, reading it with `warlock logs requests` / `warlock logs request <id>`, the `request_log` MCP tool and devtools, and `listRequestLogs`/`getRequestLog`/`RequestLogRecord`. Triggers: "why did this request 500 in production", "request history", "find the failing request", "http.logging.requests", "warlock logs". Skip: lifecycle log lines and hiding a route''s body (`http.logging`, `logging: { body: false }`) — the logging docs; timing spans/OTel — the `request-tracing` topic; a live timeline of a dev request — `warlock-trace`.'
---

# Warlock — request log

Use it to answer "what happened to that request?" after the fact, in production
or after a dev-server restart. One JSON record per request is written **after
the response is sent**, so it never slows a request and never breaks one (a
failing channel is reported once on stderr).

## Turn it on

```ts
// src/config/http.ts
export default {
  logging: {
    requests: {
      enabled: true, // default: true in development, false elsewhere
      only: "errors", // "all" | "errors" | "slow"   (default: "all" in dev, "errors" otherwise)
      slowMs: 1000,
      sampleRate: 1, // 0..1; 5xx are always kept when `only` is "all" or "errors"
      include: { body: false, response: false }, // production defaults; headers are allowlisted
      maxBodyBytes: 16384,
      retention: { maxDays: 14, maxSizeMb: 256 }, // default file channel
      // channels: ["sentry", myChannel] // default: daily JSON-lines file
    },
  },
};
```

Resolved once and cached for the process. Disabled means one boolean check per
request, nothing else.

## What a record has

`type`, `id`, `traceId`, `time` (ISO), `method`, `url` (credential query values
masked), `route: { name, pattern }`, `params`, `query`, `headers`, `body`,
`session: { userId, userType }`, `ip`, `status`, `durationMs`,
`response: { size, headers?, body? }`, `phases`, `logs` (entries emitted during
the request, by request id, max 200), `queries: { count, slowest?, nPlusOne? }`,
and `error: { message, name, stack, phase, file, site }` for a 5xx or a request
that threw. The type is `RequestLogRecord`, exported from `@warlock.js/core`.

## Privacy rules you can rely on

- The logger's redaction (default key denylist plus `log.setRedact`) runs over
  the whole record. `authorization`, `cookie`, tokens and passwords are
  `[REDACTED]`.
- Outside development request headers pass an allowlist (no cookies or
  credentials at all), and `body` / `response` are off unless set to `true`.
- `http.logging.private` URL rules and a route's `logging: { body: false, query: false }`
  apply; a route that hides its request body also hides its response body.
- Uploaded files are `{ file, mimeType }` only. Bodies over `maxBodyBytes` end
  with `…[truncated, N bytes]`.

Keep `include.body` off on apps that accept secrets in free-form fields: the
body is recorded as received, before validation.

## Read it

```bash
warlock logs requests --status 5xx --since 1h          # list, newest first
warlock logs requests --route posts --limit 20 --json
warlock logs request <id> --json                       # one record in full
```

- MCP: the read-only `request_log` tool (`id` for one record, else filters
  `status`, `route`, `method`, `since`, `q`, `limit`).
- Devtools merges the files with its live ring buffer (no duplicates by id),
  filters, opens a saved request and copies it as curl.
- Code: `listRequestLogs(filter?)`, `getRequestLog(id)`, `requestLogToCurl(record)`.

These read the **default file channel** (`storage/logs/requests`). Custom
`channels` are write-only from the framework's point of view.

## Gotchas

- A 4xx is not an error for `only: "errors"`; use `only: "all"` with a
  `sampleRate` to keep a share of them.
- Turning it on registers an internal tracing hook (for `phases`) and a passive
  log collector; neither changes where your logs go.
- Do not copy a record into tickets without checking `body`: redaction is by key
  name, so a secret under an unlisted key (`providerId`) is not masked.
