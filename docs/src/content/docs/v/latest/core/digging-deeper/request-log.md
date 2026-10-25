---
title: "Request log"
description: "http.logging.requests — a persistent, redacted record of every request (or just the failing and slow ones): what it contains, channels and the default daily JSON-lines file, filtering and sampling, retention, and reading it with warlock logs, devtools and MCP."
sidebar:
  order: 18
  label: "Request log"
---

**New in 5.38.** When a request fails in production, the terminal is long gone and the log has a `Completed Request … 500` line and little else. The request log keeps one record per request: the URL, the route, the status and timing, the input (redacted), the response, the log entries the request emitted, how many queries it ran, and the error with its stack, phase, page file and site.

It is written **after the response has been sent**, through buffered logger channels, so it never slows a request down, and a failure in the log is reported once and never reaches the request.

## Turn it on

```ts title="src/config/http.ts"
export default {
  logging: {
    requests: {
      enabled: true, // default: true in development, false everywhere else
    },
  },
};
```

In development it is on without any configuration. In production it is off until you enable it, and then it keeps **only errors** by default (`5xx` responses and requests that threw).

```ts title="src/config/http.ts"
export default {
  logging: {
    requests: {
      enabled: true,
      only: "slow", // "all" | "errors" | "slow"
      slowMs: 800,
      sampleRate: 0.25,
      include: { body: true }, // bodies are off in production unless you ask
      retention: { maxDays: 7, maxSizeMb: 128 },
    },
  },
};
```

The value is read once and cached for the process, like `http.tracing`. A disabled app pays one boolean check per request and allocates nothing.

| Option         | Default                                      | Meaning                                                                                             |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `enabled`      | `true` in development, `false` otherwise     | Turn the log on.                                                                                    |
| `channels`     | a daily JSON-lines file (see below)          | Logger channel names, or channel instances, that receive each record.                               |
| `only`         | `"all"` in development, `"errors"` otherwise | `"all"`, `"errors"` (`5xx` or threw), or `"slow"` (at least `slowMs`).                              |
| `slowMs`       | `1000`                                       | The threshold of `only: "slow"`.                                                                    |
| `sampleRate`   | `1`                                          | Share of requests kept, 0 to 1. Errors are always kept when `only` includes them (`all`, `errors`). |
| `include`      | everything; see below                        | Which parts of a request are recorded.                                                              |
| `maxBodyBytes` | `16384`                                      | Cap on each recorded body. A larger one is cut and ends with `…[truncated, N bytes]`.               |
| `retention`    | `{ maxDays: 14, maxSizeMb: 256 }`            | Pruning of the default file channel.                                                                |

`include` takes `headers`, `body`, `query`, `params`, `session`, `response`, `stack`, `logs`, `queries` and `phases`, each a boolean. Everything is on in development. Outside development `body` and `response` (the response body and headers) default to `false`, and request headers pass an allowlist (`accept`, `content-type`, `user-agent`, `host`, `origin`, `referer`, `x-request-id`, `x-forwarded-*`, `traceparent`, `accept-language`, `accept-encoding`, `content-length`), so cookies and credentials are never written, whatever their names.

## What a record holds

One JSON object per request. Fields that are off, empty or unknown are left out.

```json
{
  "type": "request",
  "id": "f3c1d0…",
  "traceId": "f3c1d0…",
  "time": "2026-10-24T12:00:00.000Z",
  "method": "POST",
  "url": "/posts/7?token=[REDACTED]",
  "route": { "name": "posts.update", "pattern": "/posts/:id" },
  "params": { "id": "7" },
  "query": { "token": "[REDACTED]" },
  "headers": { "accept": "application/json", "authorization": "[REDACTED]" },
  "body": { "title": "Hello", "password": "[REDACTED]" },
  "session": { "userId": 12, "userType": "admin" },
  "ip": "203.0.113.7",
  "status": 500,
  "durationMs": 84.2,
  "response": {
    "size": 41,
    "headers": { "content-type": "application/json" },
    "body": { "error": "…" }
  },
  "phases": [
    { "name": "validation", "durationMs": 1.1 },
    { "name": "handler", "durationMs": 80.3 }
  ],
  "logs": [
    {
      "level": "error",
      "module": "http",
      "action": "request-error",
      "message": "db down",
      "at": 1792843200123
    }
  ],
  "queries": {
    "count": 9,
    "slowest": { "durationMs": 31, "query": "select * from posts where id = ?" },
    "nPlusOne": [{ "query": "select * from users where id = ?", "count": 8 }]
  },
  "error": {
    "message": "db down",
    "name": "Error",
    "stack": "Error: db down\n    at …",
    "phase": "loader",
    "file": "src/app/posts/post.page.tsx",
    "site": "main"
  }
}
```

- `logs` are the logger entries emitted while the request ran, matched by request id (at most 200 per request).
- `queries` needs `@warlock.js/cascade`: queries are counted per request, `slowest` is the slowest, and a query shape that ran five times or more is listed under `nPlusOne`. Shapes carry no bound values.
- `phases` come from [request tracing](./request-tracing.md) spans (route match, middleware, validation, handler and a page's phases). Turning the request log on registers an internal tracing hook for them; without spans a request has one `handler` phase.
- `error` is attached to `5xx` responses and to requests that threw. For a failing page it is the same record `@warlock.js/web` logs (message, stack, phase, page file, site); for a thrown or logged `HttpError`/`AppError` it is that error. `include.stack: false` drops the stack.
- `session` is read from `request.locals.user` (set by `@warlock.js/auth`): its `id` and `userType`.

## Redaction and privacy

The record goes through the same rules as every other log entry, and the request log adds no way around them:

- The logger's redaction (`log.setRedact(...)`, the built-in denylist of passwords, tokens, API keys, `authorization`, `cookie`, …) runs over the whole record, including headers, the body and the response body.
- Credential-bearing query parameters are masked in `url` and `query` ([`http.logging.redactQueryParams`](./logging.md#request-logs-and-sensitive-routes) adds names).
- [`http.logging.private`](./logging.md#hide-input-for-a-family-of-urls) rules and a route's own `logging: { body: false, query: false }` apply. A route that hides its request body also has its response body left out, because a route that accepts a secret may echo it.
- Uploaded files are recorded as `{ file, mimeType }`, never their contents.
- The body is the body **as received**, before validation, so keep `include.body` off (the production default) unless you need it, and prefer a route-level `logging: { body: false }` on routes with secrets.

## Where the records go

By default, a JSON-lines file per day in `storage/logs/requests`:

```text
storage/logs/requests/2026-10-24.jsonl
```

Writes are buffered (a write every 20 records or a few seconds, and on exit) and the file rotates by size like any `FileLog`. Retention runs when the app boots and whenever a new day's file starts: files older than `retention.maxDays` are deleted, then the oldest files are deleted while the directory is larger than `retention.maxSizeMb`. The file being written is never deleted.

To send records elsewhere, name logger channels or pass channel instances:

```ts title="src/config/http.ts"
import { LogChannel, type LoggingData } from "@warlock.js/logger";

class RequestShipper extends LogChannel {
  public name = "request-shipper";

  public async log(data: LoggingData) {
    await ship(data.context); // data.context is the RequestLogRecord
  }
}

export default {
  logging: {
    requests: {
      enabled: true,
      channels: ["sentry", new RequestShipper()], // a name on the logger, or an instance
    },
  },
};
```

Each channel receives `{ type, module: "http", action: "request", message, context }`: `type` is `error` for a `5xx` and `info` otherwise, `message` is `METHOD url status Nms`, and `context` is the record. Records bypass the logger's console channels, so they never clutter the terminal. The default channel writes the record as one JSON line; the read tools below read the **default file channel only**.

## Read it back

- [`warlock logs requests`](/v/latest/core/cli/logs/) lists records with `--status`, `--route`, `--since` and `--limit`; `warlock logs request <id>` prints one. Both work on a stopped app and on a server that only has the files.
- [Devtools](/v/latest/devtools/) shows the persisted history next to the live requests, with filters, the error, logs and queries of a record, and **Copy as curl**.
- The [`request_log` MCP tool](/v/latest/core/cli/mcp/) lists and opens records for coding agents (read-only).
- From code: `listRequestLogs(filter?)`, `getRequestLog(id)` and `requestLogToCurl(record)` are exported from `@warlock.js/core`, and the record type is `RequestLogRecord`.

## Good to know

- The record is built after the response is sent. A request killed with the process (`SIGKILL`) before its record is flushed is lost; a graceful exit flushes.
- `only: "slow"` keeps slow requests only, not fast failures. To keep both, use `only: "all"` with a `sampleRate`: errors are kept whatever the rate.
- A `4xx` is not an error for `only: "errors"`. Use `only: "all"` with `sampleRate` to keep a share of them, or filter the file with `warlock logs requests --status 4xx`.
- Turning the request log on also turns request tracing's internal dispatch on (spans are timed for every request), for the `phases` field. `include.phases: false` avoids that.

## See also

- [Logging](./logging.md) — channels, redaction and `http.logging`.
- [Request tracing](./request-tracing.md) — the spans behind `phases`.
- [`warlock logs`](/v/latest/core/cli/logs/)
