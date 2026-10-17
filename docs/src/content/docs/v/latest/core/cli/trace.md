---
title: "warlock trace"
description: Send one request to the running dev server and print what devtools recorded for it — middleware, validation result, handler, queries with N+1 flags, logs, cache operations, captured mails, the response and timings — as a versioned JSON report (schemaVersion 1).
sidebar:
  order: 12
  label: "warlock trace"
---

`warlock trace` verifies runtime behaviour without a browser. It sends one request to the running `warlock dev` server, then reads that request's timeline back from [devtools](../../devtools/) and prints it: which middleware ran and for how long, whether validation passed (and its errors when it did not), the handler time, every query with N+1 flags, logs, cache operations, captured mails and the response.

```bash
warlock trace GET /posts
warlock trace POST /posts --body '{"title":"Hello"}' --json
warlock trace PATCH /posts/1 --body @payload.json -H "authorization: Bearer $TOKEN" --json
```

## What it needs

- `warlock dev` running in the project. The dev server records its address in `.warlock/dev-server.json` when it is ready; `trace` reads it from there. Pass `--url` to point at a server explicitly.
- `@warlock.js/devtools` installed (`warlock add devtools`). Devtools only runs in development and only answers loopback requests, so `trace` must run on the same machine.

Nothing boots in the `trace` process itself: it is an HTTP client of the dev server.

| Flag              | Type    | Description                                                                                     |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `--body, -b`      | string  | Request body: JSON text (sent as `application/json`), plain text, or `@file` to read a file.    |
| `--header, -H`    | string  | A header as `name:value`. Repeat it for several headers.                                        |
| `--url, -u`       | string  | Dev server origin, e.g. `http://localhost:2030`. Default: read from `.warlock/dev-server.json`. |
| `--devtools-path` | string  | Devtools mount path. Default `/__warlock`, or what the dev server recorded.                     |
| `--id-header`     | string  | The app's request id header (`http.requestId.header`). Default `x-request-id`.                  |
| `--timeout, -t`   | string  | How long to wait for devtools to settle the record, in ms. Default `5000`.                      |
| `--json, -j`      | boolean | Print the report as JSON. stdout carries only the JSON.                                         |

A JSON body gets `content-type: application/json` unless you pass your own `content-type` header.

## How the request is found

Core adopts an incoming `x-request-id` header as `request.id` (validated: printable ASCII, at most 128 characters) and echoes it back on the response — see `http.requestId` and [request tracing](../digging-deeper/request-tracing.md). Devtools keys its records by `request.id`. So `trace` sends a fresh UUID as `x-request-id` (or the one you pass with `-H`), reads the echoed id from the response, and fetches `GET <devtools>/api/requests/<id>`, polling until devtools has settled the record.

If the app sets `http.requestId.enabled: false`, the id is neither adopted nor echoed and the record cannot be found — the command fails with `WL5004`. With a custom `http.requestId.header`, name it with `--id-header x-correlation-id` so the id is sent and read under that header.

## The report

```json
{
  "schemaVersion": 1,
  "requestId": "1f0c4c1e-6a9b-4f53-9d6e-3c9a8f2b7d10",
  "server": "http://localhost:2030",
  "request": {
    "method": "POST",
    "url": "http://localhost:2030/posts",
    "headers": {
      "authorization": "[redacted]",
      "content-type": "application/json",
      "x-request-id": "1f0c…"
    },
    "body": { "title": "" }
  },
  "response": {
    "status": 422,
    "headers": { "content-type": "application/json; charset=utf-8", "x-request-id": "1f0c…" },
    "body": { "errors": [{ "input": "title", "error": "The title is required" }] },
    "truncated": false
  },
  "route": "/posts",
  "error": null,
  "timeline": {
    "phases": [
      {
        "name": "route.match",
        "startedAt": 1712.4,
        "durationMs": 0.1,
        "attrs": { "route": "/posts" }
      },
      {
        "name": "middleware",
        "startedAt": 1712.6,
        "durationMs": 1.8,
        "attrs": { "name": "authMiddleware", "index": 0 }
      },
      { "name": "validation", "startedAt": 1714.5, "durationMs": 0.6 }
    ],
    "routeMatch": { "durationMs": 0.1 },
    "middleware": [{ "name": "authMiddleware", "index": 0, "durationMs": 1.8 }],
    "validation": {
      "ran": true,
      "durationMs": 0.6,
      "passed": false,
      "errors": [{ "input": "title", "error": "The title is required" }]
    },
    "handler": null
  },
  "queries": [],
  "warnings": [],
  "logs": [],
  "cache": [],
  "mails": [],
  "timings": {
    "totalMs": 3.4,
    "clientMs": 6.1,
    "phasesMs": { "route.match": 0.1, "middleware": 1.8, "validation": 0.6 }
  }
}
```

- `request.headers` and `response.headers` print `authorization`, `cookie` and `proxy-authorization` as `[redacted]`.
- `response.body` is parsed JSON when the response is JSON, otherwise text; bodies over 64 KiB are cut and `truncated` is `true`.
- `timeline.validation.passed` is `true` when validation ran and the handler ran after it (or the response succeeded), `false` when it ran and the request was answered with an error before the handler, `null` when the route validates nothing. `errors` is the response body's `errors` key (the framework's failure body), or the whole body for a custom failure body.
- Each entry of `queries` is the devtools query record (`sql` or `collection`/`command`, `durationMs`, `shape`, `caller`, `error`) plus `nPlusOne: true` when its shape is one devtools reported as an N+1. `warnings` carries the N+1 reports themselves.
- `timings.totalMs` is the server-side duration devtools measured; `clientMs` is the round trip seen by `trace`; `phasesMs` sums each phase name.

Within `schemaVersion: 1`, fields are only added. Message texts are not a contract.

## Answer questions with jq

```bash
# Did validation pass, and if not, why?
warlock trace POST /posts --body '{"title":""}' --json | jq '.timeline.validation'

# Which queries are N+1, and where were they issued?
warlock trace GET /posts --json | jq '.queries[] | select(.nPlusOne) | {sql, caller}'

# The middleware chain with timings
warlock trace GET /admin/users -H "authorization: Bearer $TOKEN" --json | jq -r '.timeline.middleware[] | "\(.name) \(.durationMs)ms"'
```

## Errors and exit codes

| Code     | Meaning                                                                                             | Exit |
| -------- | --------------------------------------------------------------------------------------------------- | ---- |
| `WL8008` | No dev server is recorded, or it does not answer. Start `warlock dev`, or pass `--url`.             | 2    |
| `WL8009` | The dev server answers but devtools is not mounted. `warlock add devtools`, restart dev.            | 2    |
| `WL5004` | Devtools holds no record of the request (request id disabled, or a path under the devtools prefix). | 1    |

Devtools is checked before the request is sent, so a missing dev server or devtools never sends anything. With `--json`, a failure prints `{ "ok": false, "code": "WL8008", "message": "…" }`. `warlock explain <code>` prints the fix — see [error codes](./error-codes.md).

## From code

```ts
import { traceRequest } from "@warlock.js/core/tooling";

const report = await traceRequest({ method: "POST", url: "/posts", body: { title: "Hello" } });

if (report.timeline.validation.passed === false) {
  console.log(report.timeline.validation.errors);
}
```

`traceRequest()` takes the same inputs as the flags (`serverUrl`, `devtoolsPath`, `headers`, `timeoutMs`) and throws a `WarlockError` with the codes above.
