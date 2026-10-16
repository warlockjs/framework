---
name: use-local-dashboard
description: 'Run the zero-setup local Panoptic dashboard — a loopback `node:http` server over a trace store served from `ai.config({ panoptic: { dashboard } })`, with a two-pane call-tree + metadata UI (light/dark/system theme, search/filter, session + prompt-version grouping, cost heatmap, Gantt timeline, errors filter, hash deep-links) and an optional cache-backed persistent store. Triggers: `dashboard`, `DashboardOptions`, `DashboardHandle`, `ai.config({ panoptic })`, `panoptic.dashboard`, `panoptic.cache`, `port: 4319`, `basePath`, `open`, `authToken`, `allowedHosts`, `/api/traces`, `/api/aggregate`, `/api/traces/:id`, `createRequestHandler`, `dashboardHtml`, `sanitizeHref`, `ServeConfig`, `TraceStoreContract`, `createCacheTraceStore`, theme, dark mode, call tree, metadata panel, cost heatmap, timeline / Gantt, errors only, deep-link, group by session, prompt version, group by type, type stats panel, started / ended timestamps, team type; ''open a local AI trace dashboard'', ''view agent traces in the browser'', ''self-hosted panoptic UI'', ''inspect traces without Langfuse'', ''spin up a dev observability server'', ''dark mode dashboard'', ''persist traces across restart'', ''group traces by session / prompt version / type'', ''cost heatmap'', ''timeline / waterfall view'', ''filter failed runs in the dashboard'', ''per-type stats panel'', ''is the dashboard bearer token safe'', ''markdown links XSS in trace content''; typical import `import { ai } from "@warlock.js/ai"` + `import "@warlock.js/ai-panoptic"`. Skip: shipping traces to a backend (OTel / Langfuse / file) — the `export-traces` topic; the queryable store API the dashboard reads — the `query-traces` topic; wiring the subscriber by hand — the `observe-with-panoptic` topic.'
---

# The local Panoptic dashboard — zero-setup trace viewing

A loopback-only `node:http` server that serves one self-contained HTML page polling a read-only JSON API over a trace store. No external backend and no build step; it binds `127.0.0.1` with no auth by default, and gains optional bearer-token auth + a Host allowlist (`authToken` / `allowedHosts`, **required** off-loopback). The store is the live object the collector fills, so each poll reflects the latest completed traces.

## The documented path — `ai.config({ panoptic: { dashboard } })`

You almost never call `dashboard(...)` directly. Set it declaratively and the side-effect import wires the store, the collector, and the server for you:

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic"; // side-effect: subscribes panoptic to the config seam

ai.config({
  panoptic: {
    dashboard: true, // serve on http://127.0.0.1:4319/
    observeAll: true, // route every workflow/supervisor/team run to the collector
  },
});
```

`dashboard: true` uses the defaults. Pass an object to override:

```ts
ai.config({
  panoptic: {
    exporters: [createInMemoryTraceStore({ capacity: 5000 })],
    dashboard: { port: 4319, open: true, title: "My App — AI traces" },
    observeAll: true,
  },
});
```

**Where the dashboard reads its traces from.** It needs a queryable store (a `TraceStoreContract`). Panoptic resolves one in this order:

1. The first **store-shaped exporter** in `config.exporters` — `createInMemoryTraceStore()` doubles as an `ExporterContract`, so a store passed in `exporters` is reused (captured AND served from the same object).
2. If none was supplied but `dashboard` is set, panoptic creates a fresh in-memory store and registers it as an exporter so the collector fills it.

So `dashboard: true` with no exporters Just Works — you get a store for free. Supply your own when you want a capacity cap or want to `query` / `aggregate` it from app code too.

**Idempotent.** Applying the config is safe on every `ai.config(...)` merge: the collector is registered as a core `Observer` exactly once and the dashboard is started at most once. Repeat calls only refresh the `observeAll` flag (latest config wins). `panoptic` undefined in the config is a no-op.

## What the UI shows

The page is one self-contained, dependency-free vanilla-JS file (no bundler, no framework, works offline). It polls the JSON API every 2s and renders:

- **Header** — the Warlock logo + your `title`, the `TraceAggregate` headline counts (traces / completed / failed / cancelled), tokens as **`↓input · ↑output · total`**, total cost, an **errors-only** toggle, a **search** box, and a **light / dark / system** theme switch (persisted to `localStorage`, so the choice survives a reload; `system` follows the OS `prefers-color-scheme`).
- **Trace list** — newest-first clickable master rows, each led by a **colour-coded Title-case type label** (`Supervisor` / `Team` / `Workflow` / `Agent` / `Tool` / …; `ai.team` reports its own `team` type rather than `supervisor`, so it groups, filters, and labels separately). An optional **group-by-session** view collapses runs under collapsible session headers; a **group-by-prompt** view does the same over the `name@version` prompt key (see _Prompt-version linkage_ below); a **group-by-type** view buckets the list by root type under collapsible `Type (N)` headers (`Agent (12)`, `Team (3)`, …). The three groupings are mutually exclusive.
- **Two-pane drawer** (click a row) — a collapsible **nested call tree** on the left and the **selected node's detail** on the right: rich structured input/output (chat bubbles / key-value / Markdown), a per-node **token breakdown** (`↓in · ↑out · total`), the node's **rollup cost** (its own cost, else the sum of its children — so wrapper nodes that carry tokens but no cost don't double-count), and a **metadata panel** with humanized keys (`Supervisor Terminated By`, `Span ID` — not raw `supervisor.terminatedBy`), and **started** / **ended** wall-clock timestamps (`28 Jun 2026 03:16 PM` — named month, 12-hour, minute precision) alongside the elapsed duration. Zero-valued token/cost rows are hidden so the panel stays readable.
- **Cost heatmap** — every tree node and trace row carries a left accent tinted by its rollup cost relative to the trace's most expensive node, with a small legend, so the spend hot-spots jump out at a glance.
- **Timeline view** — the drawer's left pane toggles between the nested call **Tree** and a Gantt **Timeline** (each span drawn at its offset from the root start, width = duration, critical path highlighted).
- **Stats panel** — a header **Stats** toggle shows a per-type aggregate table above the trace list, one row per root type (`Agent` / `Team` / `Workflow` / …) with Count, Failed (rate), p50 / p95 latency, total Tokens, and total Cost, computed over the active filtered set. Distinct from the headline counts in the header.

All UI state (selected trace, selected span, collapsed nodes, theme, filters) lives in JS, **not** the DOM, so the 2s poll never disturbs an open drawer.

### Filtering & grouping (all client-side over the polled list)

The list narrows entirely in the browser — no server round-trip per keystroke:

- **Search** — free-text, case-insensitive, matched against root span name + session id.
- **Status / type chips** — restrict to selected terminal statuses or executable types. Chip, badge, drawer, and group-header labels are **Title-cased** everywhere (`Completed`, `Workflow`, `Team`); the underlying filter keys stay lowercase (`completed`, `workflow`, `team`).
- **Errors-only** — header toggle that keeps just `failed` / `cancelled` runs.
- **Session chip** — exact `sessionId`; **prompt chip** — exact `name@version` key.
- **Group-by-type** — buckets the list by root type under `Type (N)` headers; mutually exclusive with group-by-session and group-by-prompt.

The pure matching/grouping rules are unit-tested in `trace-filter.ts` and mirrored 1:1 by the inlined dashboard JS, exported for reuse / your own list views:

```ts
import {
  filterTraces,
  matchesFilter,
  groupBySession,
  rollupCost,
  maxNodeCost,
  heatIntensity,
  type TraceFilter,
  type SessionGroup,
} from "@warlock.js/ai-panoptic"; // dashboard helpers, re-exported

const failed = filterTraces(traces, { errorsOnly: true });
const bySession = groupBySession(failed); // SessionGroup[], sessionless → "(no session)"
```

`TraceFilter` is `{ text?, statuses?, types?, sessionId?, promptKey?, errorsOnly? }` — every field optional and ANDed, so `{}` matches everything. `rollupCost(span)` / `maxNodeCost(root)` / `heatIntensity(nodeCost, maxCost)` are the pure heatmap folds (intensity in `[0,1]`, `0` for a free trace rather than dividing by zero).

### Deep-links

The open trace + span are reflected in the URL hash (`#trace=<id>&span=<id>`) and re-opened from it on load — so a drawer view is **shareable / bookmarkable**. (A live socket tail is a noted follow-up; this pass stays on the 2s poll.)

### Prompt-version linkage

When an agent ran against a _named_ `ai.prompts` builder, the collector stamps `agent.promptName` / `agent.promptVersion` onto the root span. The dashboard derives a `name@version` key from them (`tracePromptKey(trace)`) and offers **filter-by-prompt** and **group-by-prompt** beside session — so a reviewer sees every run of `support@2` together and compares its cost / failure rate against `support@3`. Runs with no named prompt bucket under `"(no prompt)"`.

```ts
import { tracePromptKey, groupByPrompt, type PromptGroup } from "@warlock.js/ai-panoptic";

const byPrompt = groupByPrompt(store.query()); // PromptGroup[] keyed by name@version
```

## Persistent traces — `cache` (survive a restart)

By default the dashboard reads a fresh **in-memory** store, so traces vanish on restart. Point `panoptic.cache` at a `@warlock.js/cache` `CacheDriver` (Redis, file, …) and panoptic serves the dashboard from a **cache-backed** store instead — traces persist and re-hydrate on the next boot:

```ts
import { ai } from "@warlock.js/ai";
import "@warlock.js/ai-panoptic";
import { RedisCacheDriver } from "@warlock.js/cache";

ai.config({
  panoptic: {
    dashboard: true,
    observeAll: true,
    // A driver, or a (possibly async) factory resolved lazily on first use —
    // the factory form defers the Redis connect until the first trace lands.
    cache: async () => {
      const driver = new RedisCacheDriver();
      await driver.connect();
      return driver;
    },
  },
});
```

Panoptic awaits the store's `ready()` hydration **before** the server starts serving, so a restart surfaces previously-persisted traces immediately. Reads stay synchronous (served from an in-memory mirror); writes go through to the cache fire-and-forget, so a flaky cache never throws into the collector's hot path. A store-shaped exporter you pass via `exporters` still wins over `cache`. The store building block (`createCacheTraceStore`) and its durability contract live in the `query-traces` topic.

## The low-level building block — `dashboard(store, options)`

Reach for this directly only when you manage the store yourself (e.g. a long-lived store you also query elsewhere, or a non-default lifecycle). It returns a `Promise<DashboardHandle>`:

```ts
import { dashboard, createInMemoryTraceStore } from "@warlock.js/ai-panoptic";

const store = createInMemoryTraceStore();
const handle = await dashboard(store, { port: 4319, open: true });

console.log(handle.url); // http://127.0.0.1:4319/
console.log(handle.port); // 4319 (the REAL OS port when port: 0 was passed)

// ...on teardown:
await handle.close();
```

The store is the same object the collector writes to — wire the collector to it (pass it as an exporter to `panoptic({ exporters: [store] })` or via `ai.config`) and the dashboard reflects new traces on its next poll.

### `DashboardOptions`

Every field optional, every default safe:

| Option         | Default        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`         | `4319`         | Pass `0` for an ephemeral port — the resolved port comes back on `handle.port`. A busy port rejects with a clear `Error` (`port N in use; pass { port: 0 }`), not raw `EADDRINUSE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `host`         | `"127.0.0.1"`  | **Loopback only** by default, so prompt content is never exposed to the LAN. Binding a non-loopback interface is gated — it requires `authToken` (see below) or `dashboard()` rejects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `basePath`     | `"/"`          | Mount-path prefix for both the page and every `/api/...` route, e.g. `"/panoptic"`. Normalized to leading + trailing slash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `open`         | `false`        | Open the default browser at the resolved URL once listening. Best-effort and fully swallowed — failing to open a browser never rejects the start.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `title`        | `"Panoptic"`   | Header title baked into the served page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `authToken`    | _unset_        | Bearer token required on every request. Compared with `crypto.timingSafeEqual` (constant-time, length-checked first) against both the header and query-string forms — never a plain `===` — so a network-reachable dashboard doesn't leak the token to a byte-at-a-time timing attack. `Authorization: Bearer <token>` is accepted on every route; `?token=` is accepted **only on the HTML page route** (the JSON API routes are header-only), since the page load is the one request that structurally can't carry a header — this narrows the token's footprint in access/proxy logs and browser history. Missing/wrong → `401`. **Required** when `host` is non-loopback. |
| `allowedHosts` | loopback names | `Host`-header allowlist (DNS-rebind guard); an unlisted `Host` → `403`. Defaults to `localhost` / `127.0.0.1` / `[::1]` for a loopback bind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### `DashboardHandle`

```ts
type DashboardHandle = {
  readonly url: string; // http://host:port{basePath}
  readonly port: number; // real OS port (when port: 0 was requested)
  close(): Promise<void>; // stop the server, release the port
};
```

## The JSON API

Every route is **`GET`-only and read-only** (non-`GET` → `405`), mounted under `basePath` — EXCEPT the one opt-in `POST .../spans/:spanId/evaluate` route `DashboardOptions.evaluate` enables (see the `evaluate-system-prompt` topic); absent that config, it 405s like everything else. The page polls the `GET` routes; you can curl them too. Store shapes are already JSON-safe, so responses are a plain `JSON.stringify`.

| Route                                              | Returns                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/traces`                                  | `store.query(...)` — the trace list, filtered by the query string (`id` / `sessionId` / `status` / time window, parsed by `parseQuery`). |
| `GET /api/traces/:id`                              | `store.get(id)` — one full trace, or `404 { error: "trace_not_found" }`.                                                                 |
| `GET /api/aggregate`                               | `store.aggregate(...)` — the usage + cost + status rollup over the same query filter.                                                    |
| `GET /` (basePath)                                 | the self-contained HTML page.                                                                                                            |
| `POST /api/traces/:traceId/spans/:spanId/evaluate` | grades the span's last captured system prompt — only when `evaluate` is configured.                                                      |

Query-string filters map 1:1 onto `TraceQuery`:

```sh
curl 'http://127.0.0.1:4319/api/traces?status=failed'
curl 'http://127.0.0.1:4319/api/aggregate?sessionId=sess_42'
```

(The exact filter keys and the aggregate shape live in the `query-traces` topic.)

## Advanced — build the handler yourself

`createRequestHandler(store, config)` is the bare `(req, res) => void` the server closes over — split out from the lifecycle so it unit-tests without binding a port, and so you can mount the same routes inside an existing server:

```ts
import { createRequestHandler } from "@warlock.js/ai-panoptic";
import { createServer } from "node:http";

const handler = createRequestHandler(store, {
  basePath: "/",
  title: "Panoptic",
  allowedHosts: ["127.0.0.1", "localhost"],
});
createServer(handler).listen(4319, "127.0.0.1");
```

`dashboardHtml(basePath, title, evaluateEnabled?, evaluateDefaultInstructions?)` returns the served page as a string if you embed it elsewhere. `ServeConfig` is `{ basePath; title; allowedHosts; authToken?; evaluate? }`.

## Security note

The dashboard surfaces whatever the store holds — including captured prompt/response content when content capture is on (`captureContent`). It binds **loopback-only** by default precisely so that content never leaves the machine. Binding a non-loopback host is gated — it requires an `authToken` (and checks a `Host` allowlist, sending `nosniff` / CSP / `X-Frame-Options: DENY` on every response) — but still prefer loopback for dev, and for production ship to a real backend via an exporter rather than exposing the dashboard. The dashboard has exactly one write-capable route (`evaluate`, off by default) — everything else stays read-only regardless of configuration.

**Trace content is untrusted input to the dashboard's own UI, and is treated that way:**

- **Markdown links in captured content are sanitized.** `span.input`/`span.output` can contain model output or attacker-controlled tool results — i.e. prompt-injected content — and the drawer renders it as Markdown. Link URLs go through `sanitizeHref` (a scheme allowlist: `http:`, `https:`, `mailto:`, plus relative/anchor URLs) after normalizing the way a browser will — attribute-entity decode, strip of ignored control chars/whitespace, lowercase — so `javascript:`/`data:`/`vbscript:` payloads (including case/whitespace/entity-obfuscated variants, and scheme-relative `//host` links) never become a live `href`; a rejected link renders its label as plain text instead. This closes a stored-XSS path that could otherwise reach the in-page bearer token.
- **The bearer token is no longer a page-global.** The client script's `TOKEN` is sealed inside its own inner IIFE that exposes only the `fetchAuthed` helper, so other code in the page's closure can't read the raw token by name.

These three findings (link sanitization + the two token-handling items above) came from the same audit; none is independently exploitable today, but each narrowed the blast radius of a future bug in an operator-facing surface that renders untrusted model/tool content.

## See also

- The `observe-with-panoptic` topic — the `ai.config({ panoptic })` wiring and the underlying `panoptic(...)` subscriber that fills the store.
- The `query-traces` topic — the `TraceStoreContract` (`query` / `get` / `aggregate`) the dashboard reads, the `TraceQuery` filter, and capacity eviction.
- The `export-traces` topic — shipping traces to OTel / Langfuse / a file instead of (or alongside) the local dashboard.
- The `evaluate-system-prompt` topic — the drawer's "Evaluate system prompt" action, the dashboard's one write route.
