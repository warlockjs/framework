---
name: devtools-overview
description: 'Development-only dashboard for Warlock.js apps at `/__warlock`: request timeline (router + page middleware, loaders, render, deferred values), every SQL/Mongo query with EXPLAIN, N+1 warnings naming the file and line, a dev mailbox, logs, cache operations, AI traces per HTTP request (model, tokens, cost, cache hits, tools, retries, truncation, compaction), the route map and an API docs page (`/__warlock/docs`, the OpenAPI 3.1 document of the app rendered with Scalar or Swagger UI at `/__warlock/docs/swagger`, with OpenAPI and Postman downloads). Use for: "why is this page slow", "which queries does this request run", "find N+1 queries", "see the email my app just sent in dev", "open the dashboard", "browse my API docs in dev", "see the OpenAPI for my routes", "open Swagger UI for my API", "export my routes to Postman". Install with `warlock add devtools`; never registered in warlock.config.ts. Not this package: production monitoring/APM or OpenTelemetry export — use `http.tracing` hooks in @warlock.js/core; slow-query logging in production — subscribe to cascade `dataSourceRegistry.on("query")` yourself.'
---

# `@warlock.js/devtools` — overview

A dashboard for **development only**, served by your own app at `/__warlock`.
It shows what each request did: its timing waterfall, the queries it ran, the
cache operations, the logs, and any mail it sent.

## Install: one command, no config

```bash
warlock add devtools   # adds @warlock.js/devtools as a DEV dependency
warlock dev            # open http://localhost:<port>/__warlock
```

There's nothing to register. `warlock dev` loads devtools automatically when
the package is installed.

**Do not** add `devtoolsConnector()` to `warlock.config.ts`. Devtools is a
dev dependency, so a production install doesn't have it, and a config import
of it would fail to resolve there.

## Why it can't leak into production

1. **It isn't installed there.** Production installs omit dev dependencies.
2. **It refuses to run outside development.** If it's present anyway, it logs
   one warning (`@warlock.js/devtools only runs in development; it is not mounted`)
   and mounts nothing.
3. **It only answers loopback clients.** Every dashboard and API route answers
   404 unless the connection comes from `127.0.0.1` / `::1`. It checks the
   socket address, not `X-Forwarded-For`, so a forwarded-for header can't
   unlock it.

## What each panel shows

| Panel        | What you see                                                                                                                                                                                                                                      | Where it comes from                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Requests** | Each request with its status, duration and query count. Click one for a waterfall: router middleware, `page.middleware`, loaders, `page.cache` hit/miss, `render.shell`, `defer.settle`, with queries and cache ops placed on the same time axis. | core `registerTracingHooks()`             |
| **Queries**  | SQL + bindings or the Mongo command, duration, rows, and an **Explain** button (Postgres `SELECT` only; runs `EXPLAIN (FORMAT JSON)`, never `ANALYZE`)                                                                                            | cascade `dataSourceRegistry.on("query")`  |
| **N+1**      | `⚠ N+1: 12× "select … where post_id = $1" — src/app/posts/services/list-posts.service.ts:18`, shown on the request and printed in the terminal                                                                                                    | same query shape ≥ 5 times in one request |
| **Mail**     | Every mail sent in development: headers, HTML (sandboxed) and text, attachment names                                                                                                                                                              | core `mailEvents.onCaptured()`            |
| **Logs**     | Log entries per request, filterable by level and module                                                                                                                                                                                           | a logger channel                          |
| **Cache**    | hit / miss / set / removed / `invalidated` (tags, keys removed)                                                                                                                                                                                   | cache `cache.on(...)`                     |
| **Routes**   | Every HTTP route with its method, path, name and middleware                                                                                                                                                                                       | core router                               |
| **API**      | The app's API reference: every route with its parameters, request body, responses and auth                                                                                                                                                        | core `getDevelopmentOpenApiDocument()`    |

Work outside a request (boot, scheduler ticks, queue jobs) goes to a separate
background list, so it never clutters a request's timeline.

## AI runs alongside HTTP requests

The **AI** tab and each request's **AI runs** section display completed traces
from optional `@warlock.js/ai-panoptic`. If it cannot be imported, the tab shows
install/restart guidance and the other panels keep working.

```bash
warlock add devtools
npm install @warlock.js/ai @warlock.js/ai-panoptic
```

At app boot, enable observation, then restart `warlock dev`:

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic";
ai.config({ panoptic: { observeAll: true } });
```

No `dashboard: true` or extra listener port is needed. Existing `attach`,
middleware and explicit collection through Panoptic's built-in collector also
feed the panel. An installed but unobserved flow produces no trace.

- `DevtoolsAiRun` and `DevtoolsAiEvent` are public types from
  `@warlock.js/devtools`; `DevtoolsStreamEvent` includes the `ai` event.
- Read all runs with `GET /__warlock/api/ai`, or filter by an exact HTTP id with
  `GET /__warlock/api/ai?requestId=<encoded-id>`. Responses include `available`,
  `runs` and a root-usage `aggregate`; unavailable responses contain `message`.
- Inspect tools/timings, retry attempts and compaction records with
  `GET /__warlock/api/ai/runs/<encoded-trace-id>` (404 when evicted). The existing
  stream emits `ai` events with `{ traceId, requestId? }`.
- Model, input/output/cache-read/cache-write tokens and historical USD cost come
  from the trace, never a guessed price table. Unknown cost is unpriced. Root
  usage includes children already; do not sum all spans for a run total.
- Cache hits count trips reporting positive provider `cachedTokens`.
  Semantic-cache hits have no explicit report flag and remain unreported; zero
  tokens alone do not prove a hit. `—` means unreported rather than zero.
- `incomplete` status or normalized `AGENT_INCOMPLETE` / `AgentIncompleteError`
  marks truncation. Recovered truncated trips still contribute to their count.
- Compaction metadata includes applied/skipped agent decisions and provider
  compaction-block counts; summary content is omitted. Orchestrator result-only
  compaction cannot be reconstructed from a report-only trace.

A same-origin browser tool can consume the public types directly:

```ts
import type { DevtoolsAiEvent, DevtoolsAiRun, DevtoolsStreamEvent } from "@warlock.js/devtools";

const response = await fetch("/__warlock/api/ai?requestId=request-42");
const { runs }: { runs: DevtoolsAiRun[] } = await response.json();
console.log(runs.map((run) => [run.traceId, run.usage, run.cost]));

function handleStream(event: DevtoolsStreamEvent): void {
  if (event.type === "ai") {
    const update: DevtoolsAiEvent = event.data;
    console.log(update.traceId, update.requestId);
  }
}
handleStream({ type: "ai", data: { traceId: "run-42", requestId: "request-42" } });
```

Request correlation reads core's current request id at collection time, before
exporters. Concurrent/late runs can retain their async context. No id means
background; `sessionId` is never substituted. Replayed reports outside the
request cannot recover its context automatically.

Devtools retains its own content-free in-memory store, at most `maxRequests`
traces (200 by default), independently of HTTP request retention. Clear/shutdown
empties this view, leaving application exporter/cache stores alone. Boot-time
and persisted traces are not replayed. The source only attaches in development;
AI routes keep the same socket-loopback guard as every other panel.

## API docs

`/__warlock/docs` renders the app's OpenAPI 3.1 document with [Scalar](https://github.com/scalar/scalar); the dashboard's **API** tab shows the same page and has a **Scalar | Swagger UI** switch (remembered in the browser). `/__warlock/docs/swagger` renders the same document with [Swagger UI](https://github.com/swagger-api/swagger-ui). The document comes from `GET /__warlock/api/openapi.json`, built in-process by core's `getDevelopmentOpenApiDocument()` from the routes already registered, so it is the same generator as `warlock generate.openapi` and follows your edits with no CLI run. It covers API routes (not pages): paths, parameters, request bodies from Seal validation, responses from each handler's `responseSchema`, `401`/`422` and bearer/cookie security from `authMiddleware()`. See core's `generate-openapi` topic for what is documented and how to declare it.

- It answers `503` from `/__warlock/api/openapi.json` when the host provides no generator.
- Same guard as the rest of devtools: dev-only and loopback-only.
- Scalar's prebuilt bundle is vendored and served as `assets/scalar.js`, so apps install nothing extra. The page fetches nothing from a CDN, and Scalar's web fonts, telemetry, AI agent and MCP are turned off.
- Swagger UI's prebuilt bundle (swagger-ui-dist, Apache-2.0) is vendored too, served as `assets/swagger-ui-bundle.js` and `assets/swagger-ui.css`; its schema validator badge is off, so it fetches nothing from outside either.
- The API tab links `OpenAPI JSON` (`/__warlock/api/openapi.json`) and `Postman collection` (`/__warlock/api/postman.json`, built by core's `getDevelopmentPostmanCollection()`; `503` when core cannot build one) for importing the routes into Postman or Insomnia.
- To write a file instead, run `warlock generate.openapi` (default `storage/openapi/openapi.json`).

## Options

`warlock dev` uses the defaults: path `/__warlock`, the last 200 requests
kept, and an N+1 threshold of 5. Everything lives in memory and is gone on
restart.

## From the terminal (agents)

`npx warlock trace POST /posts --body '{"title":"Hi"}' --json` sends one
request to the running dev server and prints this dashboard's record of it as
JSON — middleware, validation result, queries with N+1 flags, logs, response
and timings. See the `warlock-trace` skill of `@warlock.js/core`.

`npx warlock mcp` (or `npx warlock dev --mcp`) gives a coding agent the same
records through its `requests_recent` tool: the newest requests with their
phases, queries flagged `nPlusOne`, warnings, logs and timings. See the
`warlock-mcp` skill of `@warlock.js/core`.

## Secrets

Query bindings and log context go through the logger's redaction rules
before they're stored. The data is still real request data, which is exactly
why the dashboard is development-only and loopback-only.

## Related

- Building your own tooling on the same hooks: core `registerTracingHooks()`,
  cascade `dataSourceRegistry.on("query")`, core `mailEvents.onCaptured()` and
  the cache `invalidated` event are public APIs that also work without devtools.

## Process supervision panel

Run `npx warlock add process` to create an app-owned supervisor and
`src/app/processes/devtools.ts`, exporting `processPanel = { list: () =>
processes.list() }`. Devtools discovers this registration only in development.
The **Processes** tab refreshes `GET /__warlock/api/processes`: PIDs, workload
categories, labels, display commands, limits, enforcement, and peak memory.
It excludes ownership tokens. Without registration the list is empty. The
endpoint retains development/loopback guards and provides no stop action.
Use the `supervise-processes` skill of `@warlock.js/process` for launch,
recovery and stop APIs; configure one owner/registry per application instance.
