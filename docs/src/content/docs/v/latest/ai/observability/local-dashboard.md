---
title: "The local dashboard"
description: "A zero-setup local UI for Panoptic traces — ai.config({ panoptic: { dashboard } }) starts a loopback-only node:http server over the trace store, serving headline aggregates, a searchable newest-first trace list, a two-pane drawer (call tree / Gantt timeline + node detail), light/dark/system theme, cost heatmap, group-by-session/prompt, and deep-links, plus the low-level dashboard(store, options) API and its read-only JSON routes."
sidebar:
  order: 4
  label: "Local dashboard"
---

Panoptic ships a **zero-dependency local dashboard**: a tiny `node:http` server that serves one self-contained HTML page over an [in-memory trace store](./querying-traces). No build step, no framework, no external assets — it polls a read-only JSON API and renders your latest runs. It's a dev tool for eyeballing what your agents actually did, not a production observability backend (for that, point an exporter at OTel or Langfuse).

## The primary path — `ai.config`

The documented way to start it is the `dashboard` slot on [`ai.config({ panoptic })`](./configuring-panoptic):

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic";

ai.config({
  panoptic: {
    observeAll: true,
    dashboard: { port: 4319, open: true },
  },
});
```

That's it. Panoptic:

- creates an in-memory store and registers it as an exporter (so traces fill it as runs complete), **unless** you already passed a store via `exporters` — in which case that store is reused and the dashboard reads it;
- starts the server on the configured port, binding loopback-only;
- opens your browser at the URL when `open: true`.

Set `dashboard: true` to take every default, or pass a `DashboardOptions` object to override them.

> **The dashboard needs a queryable store.** If you set `dashboard` without any store among `exporters`, Panoptic creates and registers one for you. If you want to also `query()` / `aggregate()` that same store from code, pass your own `createInMemoryTraceStore()` in `exporters` and it'll back the dashboard too.

## `DashboardOptions`

Every field is optional with a safe default:

```ts
type DashboardOptions = {
  port?: number;     // default 4319 — pass 0 for an OS-assigned ephemeral port
  host?: string;     // default "127.0.0.1" — loopback only
  basePath?: string; // default "/" — mount prefix for the UI + every /api route
  open?: boolean;    // default false — open the default browser once listening
  title?: string;    // default "Panoptic" — shown in the page header
  authToken?: string;      // require `Authorization: Bearer <token>` (or `?token=`) — REQUIRED off-loopback
  allowedHosts?: string[]; // Host-header allowlist (DNS-rebind guard) — defaults to the loopback names
};
```

| Option | Default | Notes |
| --- | --- | --- |
| `port` | `4319` | Pass `0` for an ephemeral port — the real one comes back on the handle's `port`. A port already in use rejects with a clear `port … in use` error, not a raw `EADDRINUSE`. |
| `host` | `"127.0.0.1"` | Loopback only by default — see the [security note](#security-loopback-only-by-default). |
| `basePath` | `"/"` | A non-root value (e.g. `"/panoptic"`) prefixes both the page and every `/api/...` route. Normalized to leading-and-trailing-slash form internally. |
| `open` | `false` | Best-effort browser launch via the platform opener; a launch failure never rejects the start. |
| `title` | `"Panoptic"` | Baked into the served page header at start time. |
| `authToken` | _unset_ | When set, every request must present `Authorization: Bearer <token>` (or a `?token=<token>` query param) or gets `401`. **Required** when `host` is non-loopback — starting off-loopback without one rejects at `dashboard()`. |
| `allowedHosts` | loopback names | `Host`-header allowlist defending against DNS-rebinding; a request whose `Host` isn't listed gets `403`. Defaults to `localhost` / `127.0.0.1` / `[::1]` for a loopback bind — list your expected host(s) for a non-loopback one. |

## The low-level `dashboard(store, options)`

`ai.config` constructs (or reuses) the store and calls `dashboard()` for you. Reach for the function directly only when you manage the store yourself:

```ts
import { dashboard, createInMemoryTraceStore, panoptic } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
const observe = panoptic({ exporters: [store] }); // fill the store as runs complete

const handle = await dashboard(store, { port: 4319, open: true });
console.log(handle.url); // http://127.0.0.1:4319/

// ...later, on teardown:
await handle.close();
```

`dashboard(store, options)` returns a `Promise<DashboardHandle>` that resolves **once the server is listening**:

```ts
type DashboardHandle = {
  readonly url: string;          // resolved http://host:port{basePath}
  readonly port: number;         // resolved port — the real one when port: 0
  close(): Promise<void>;        // stop the server, release the port
};
```

The store is the **live** object the collector fills, so every poll reflects the latest completed traces with no extra wiring. Use the imperative form when you want to start the dashboard from your own pipeline, choose the port at runtime (`port: 0` then read `handle.port`), or own the server lifecycle (`handle.close()` in a test's teardown).

## What the page shows

The served page is dependency-free vanilla JS that polls the JSON API and renders:

- **Headline aggregates** from `/api/aggregate` — trace count, completed / failed / cancelled counts, and arrow-coded token rollups (`↓input · ↑output · total`) plus total cost.
- **A per-type Stats panel** (toggled on) above the list — one row per root type (`Agent` / `Workflow` / `Supervisor` / `Team` / `Planner` / …) with Count, Failed (and its rate), p50 and p95 latency, total Tokens, and total Cost, computed over the **active filtered set**. Distinct from the headline strip: that's whole-store counts, this breaks the current slice down by type.
- **A newest-first trace list** from `/api/traces` (the store already sorts by root `startedAt`, descending), each row carrying a **cost-heatmap accent** tinted by its rollup cost relative to the trace's most expensive node.
- **A two-pane drawer** per selected trace: the left pane toggles between a collapsible **nested call tree** and a **Gantt timeline** (span offset + duration, critical path highlighted); the right pane shows the selected node's detail. Both walk each trace's `root.children` — the same span tree the exporters see, with per-span status, timing, arrow-coded tokens, per-node rollup cost, and (when [content capture](./what-panoptic-traces) is on) input/output. The node detail also shows **started** and **ended** wall-clock timestamps — formatted `28 Jun 2026 03:16 PM` (named month, 12-hour, minute precision) — alongside the elapsed duration, and renders metadata keys humanized (`Supervisor Terminated By`, not raw `supervisor.terminatedBy`).
- **A metadata panel** — session id, ids, version, attributes — and colour-coded Title-case type labels (`Supervisor` / `Team` / `Agent` / `Tool` / …; `Team` is its own type, distinct from `Supervisor`).

### Theme, search, grouping, deep-links

- **Theme** — light / dark / system toggle, persisted to `localStorage` (no longer just `color-scheme`).
- **Search & filter** — client-side free-text search (name + session) plus status / type / session / prompt filter chips (type chips list only the types actually present) and an `Errors only` shortcut chip in the status row. Status and type labels render **Title-cased** everywhere — row badges, drawer, filter chips, group headers (`Completed` / `Workflow`, not `completed` / `workflow`) — while the underlying filter keys stay lowercase. These mirror the pure [`filterTraces` / `matchesFilter`](./querying-traces#reusing-the-dashboards-trace-list-logic) folds exported from the package.
- **Group-by** — a collapsible group-by-session view, a **prompt-version** view that slices each run of `support@2` apart from `support@3` (off the `agent.promptName` / `agent.promptVersion` stamps), and a **group-by-type** view that buckets the list by root type (`Agent` / `Workflow` / `Supervisor` / `Team` / `Planner` / …) under collapsible `Type (N)` headers. The three group-by modes are mutually exclusive.
- **Deep-links** — the open trace + span are reflected in the URL hash (`#trace=&span=`) and re-opened on load, so a drawer view is shareable / bookmarkable.

## The JSON API

The dashboard server exposes three **read-only** `GET` routes under `basePath` (all under `{basePath}api`). They're a thin shell over the [trace store](./querying-traces), so you can also curl them or build your own UI:

| Route | Backed by | Returns |
| --- | --- | --- |
| `GET {base}api/traces` | `store.query(parseQuery(searchParams))` | Matching traces, newest-started first. |
| `GET {base}api/traces/:id` | `store.get(id)` | One `Trace` by id, or `404 { error: "trace_not_found" }`. |
| `GET {base}api/aggregate` | `store.aggregate(parseQuery(searchParams))` | The `TraceAggregate` rollup for the filter. |

The query string maps onto a [`TraceQuery`](./querying-traces#filtering-with-tracequery): `traceId`, `sessionId`, `status` (**repeatable** — `?status=failed&status=cancelled`), `startedAfter`, and `startedBefore`. Unknown params and unknown `status` tokens are dropped. So filtering is just a query string:

```bash
# failed or cancelled runs for one session, as JSON
curl 'http://127.0.0.1:4319/api/traces?sessionId=session-42&status=failed&status=cancelled'

# the aggregate rollup for that same slice
curl 'http://127.0.0.1:4319/api/aggregate?sessionId=session-42'
```

Non-`GET` methods get `405`; anything outside these routes (and the page itself) gets `404`. The store shapes are already JSON-safe, so responses are a plain `JSON.stringify` — no serializer and no write surface (these routes are read-only). When `authToken` is set, the same bearer check guards them, and security headers (`nosniff`, a strict CSP, `X-Frame-Options: DENY`) ride on every response.

## Security: loopback-only by default

The dashboard surfaces whatever the store holds — including **prompt and tool content** when [content capture](./what-panoptic-traces) is enabled. So it binds to `127.0.0.1` by default: the page and its API are reachable only from the local machine, and it stays a read-only dev tool (no write surface). (Persistence is opt-in via a [cache-backed store](./querying-traces#persisting-traces-across-restarts); when you enable it, your traces — content included — outlive the process, so guard the cache accordingly.)

Going off-loopback is **gated**. Set `host` to a non-loopback value and you **must** also pass an `authToken`, or `dashboard()` rejects at start — it refuses to serve raw prompt content on a public interface unauthenticated. With a token set, every request needs `Authorization: Bearer <token>` (or a `?token=` query param) and its `Host` header is checked against `allowedHosts` (a DNS-rebinding guard); security headers (`X-Content-Type-Options: nosniff`, a strict CSP, `X-Frame-Options: DENY`) ride on every response. Even then, only do this for an isolated container you reach through an SSH tunnel or behind your own authenticating proxy — never expose it to an untrusted network with content capture on.

## Gotchas

- **The store must be filling.** The dashboard only shows traces the collector has written to its store. With `ai.config`, that means `observeAll: true` (or per-flow `observe: true`) — otherwise the store stays empty and the page shows nothing. See [Configuring Panoptic](./configuring-panoptic#choosing-what-gets-observed).
- **Port in use → actionable error.** A busy port rejects with `Panoptic dashboard: port … in use; pass { port: 0 } for an ephemeral port` rather than a raw Node error. Use `port: 0` in tests so parallel runs never collide.
- **`open: true` is best-effort.** A failed browser launch is swallowed — the server still starts and the handle still resolves. Read `handle.url` and open it yourself if nothing pops up.
- **Started at most once.** Via `ai.config`, the dashboard is idempotent — repeat `ai.config({ panoptic: { dashboard } })` calls don't start a second server. Use the low-level `dashboard()` directly if you genuinely need more than one.
- **Persistence is opt-in.** The default in-memory store is wiped on process exit (and bounded by its `capacity` if you set one). For trace history that survives a restart, back the dashboard with a [cache-persistent store](./querying-traces#persisting-traces-across-restarts) via [`ai.config({ panoptic: { cache } })`](./configuring-panoptic#persisting-traces-across-a-restart). For long-term archives still use a durable exporter (OTel / Langfuse / file).

## Related

- [Configuring Panoptic](./configuring-panoptic) — the `ai.config({ panoptic })` path that starts this dashboard.
- [Querying traces](./querying-traces) — the in-memory store the dashboard reads, and its `query()` / `aggregate()` API the JSON routes wrap.
- [What Panoptic traces](./what-panoptic-traces) — the `Trace` / `TraceSpan` shape the page renders, and content capture.
- [Exporter output](./exporter-output) — durable backends to use alongside (or instead of) the local dashboard.
