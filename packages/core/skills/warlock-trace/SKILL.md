---
name: warlock-trace
description: 'Verify runtime behaviour without a browser: `warlock trace <method> <url> [--body json|@file] [--header k:v] [--json]` sends one request to the running `warlock dev` server and prints what devtools recorded for it — middleware chain with timings, validation result and errors, handler time, queries with N+1 flags, logs, cache operations, captured mails, the response and timings — as a versioned report (`schemaVersion: 1`); `traceRequest()` returns the same object. Triggers: `warlock trace`, `traceRequest`, `TraceReport`, `buildTraceReport`, `x-request-id`, `.warlock/dev-server.json`, `WL8008`, `WL8009`, `WL5004`, `--id-header`; "did validation pass for this request", "which queries does this endpoint run", "is there an N+1 on this route", "what middleware runs on this route", "check the endpoint after my change", "request timeline as JSON". Skip: the devtools dashboard in a browser — the `devtools-overview` skill of @warlock.js/devtools; static route facts (guard, rate limit, schemas) — the `warlock-inspect` topic; typecheck/lint/tests — the `warlock-check` topic.'
---

# Warlock — `warlock trace`

Send a real request to the running dev server and read back its devtools timeline. Use it after a change to confirm what the code actually does at runtime: the middleware that ran, whether validation refused the body, which queries ran and whether any is an N+1.

Needs `warlock dev` running in the project and `@warlock.js/devtools` installed (`npx warlock add devtools`). The dev server records its address in `.warlock/dev-server.json`; `trace` reads it from there.

```bash
npx warlock trace GET /posts
npx warlock trace POST /posts --body '{"title":"Hello"}' --json
npx warlock trace PATCH /posts/1 --body @payload.json -H "authorization: Bearer $TOKEN" --json
npx warlock trace GET /posts --url http://localhost:2030 --json   # explicit server
```

`--header` / `-H` repeats. A JSON `--body` is sent as `application/json` unless you pass a `content-type` header; `@file` reads the body from a file.

## Answer questions with jq

```bash
# Validation verdict and errors
npx warlock trace POST /posts --body '{"title":""}' --json | jq '.timeline.validation'
# → { "ran": true, "durationMs": 0.6, "passed": false, "errors": [{ "input": "title", "error": "The title is required" }] }

# N+1 queries with the line that issued them
npx warlock trace GET /posts --json | jq '.queries[] | select(.nPlusOne) | {sql, caller}'

# Middleware chain, in run order
npx warlock trace GET /admin/users -H "authorization: Bearer $TOKEN" --json \
  | jq -r '.timeline.middleware[] | "\(.index) \(.name) \(.durationMs)ms"'

# Status and body
npx warlock trace GET /posts/1 --json | jq '{status: .response.status, body: .response.body}'
```

## The report (schemaVersion 1)

Top-level keys: `requestId`, `server`, `request` (method, url, headers with credentials `[redacted]`, body), `response` (status, headers, body — parsed JSON or text, cut at 64 KiB with `truncated`), `route`, `error`, `timeline` (`phases`, `routeMatch`, `middleware[]`, `validation`, `handler`), `queries[]` (each with `nPlusOne`), `warnings[]`, `logs[]`, `cache[]`, `mails[]`, `timings` (`totalMs` server, `clientMs` round trip, `phasesMs` per phase).

`timeline.validation.passed`: `true` when the handler ran after validation, `false` when the request was answered with an error before the handler, `null` when the route validates nothing.

## From code

```ts
import { traceRequest } from "@warlock.js/core/tooling";

const report = await traceRequest({ method: "POST", url: "/posts", body: { title: "Hello" } });

const slowQueries = report.queries.filter((query) => Number(query.durationMs) > 50);
const nPlusOne = report.queries.some((query) => query.nPlusOne);
```

## How the request is matched

`trace` sends a fresh UUID as `x-request-id`. Core adopts it as `request.id` and echoes it back; devtools keys its record by that id. If the app renamed the header (`http.requestId.header`), pass `--id-header <name>`. If it disabled it (`http.requestId.enabled: false`), no record can be matched.

## Errors

| Code     | Meaning                                                             | Exit |
| -------- | ------------------------------------------------------------------- | ---- |
| `WL8008` | No dev server recorded, or it does not answer — start `warlock dev` | 2    |
| `WL8009` | Dev server up, devtools not mounted — `warlock add devtools`        | 2    |
| `WL5004` | Devtools has no record of the request (request id disabled)         | 1    |

Devtools is checked before anything is sent. With `--json` a failure prints `{ "ok": false, "code", "message" }`. Exit 2 means "this machine", not your code — start the server instead of editing code. `npx warlock explain <code>` prints the fix.

## Gotchas

- Run it on the same machine as the dev server: devtools answers loopback requests only, in development only.
- Paths under the devtools prefix (`/__warlock`) are never recorded.
- Devtools keeps the last 200 requests in memory; a restart of `warlock dev` clears them.
- The request really runs: a `POST` writes to the development database.

## See also

- The `warlock-inspect` topic — the static facts of a route (guard, rate limit, schemas).
- The `warlock-check` topic — typecheck, lint, tests and conventions in one run.
- The `devtools-overview` skill of `@warlock.js/devtools` — the dashboard behind the timeline.
