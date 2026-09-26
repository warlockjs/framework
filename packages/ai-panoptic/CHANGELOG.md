# Changelog — @warlock.js/ai-panoptic

All notable changes to `@warlock.js/ai-panoptic` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.23.0 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.1 - 2026-09-25

### Changed

- Lockstep patch release; package APIs are unchanged.

## 5.22.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.

## 5.21.0 - 2026-09-25

### Changed

- Lockstep release maintenance and dependency refresh.
## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.11.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.11.0._

## 5.10.0 - 2026-09-14

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.10.0._

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/ai-panoptic`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/ai-panoptic`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/ai-panoptic`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

### Security

- **Dashboard stored XSS via `javascript:` markdown links — fixed.** The dashboard's markdown link renderer (`mdInline` in `ui.html.ts`) rewrote `[text](url)` into a live `<a href>` without validating the URL scheme, so a `javascript:` URL embedded in captured trace content (`span.input` / `span.output` under `captureContent` — i.e. prompt-injected model output or attacker-controlled tool results) became a stored XSS that fired when an operator clicked the link; the page's CSP (`script-src 'unsafe-inline'`) permits `javascript:` URI execution and does not restrict top-level navigation, putting the in-page bearer token in reach. Link URLs are now checked against a scheme allowlist (`http:`, `https:`, `mailto:`, plus relative/anchor URLs) after normalizing the URL the way a browser will — attribute-entity decode, strip of ignored control chars/whitespace (`java\tscript:`), lowercase — and scheme-relative `//host` links are rejected too; a rejected URL renders its label as plain text with no `href` at all. Regression-tested by executing the actual inlined client renderer against `javascript:`/`data:`/`vbscript:` payloads and their case/whitespace/entity obfuscations (`ui.html.md-links.spec.ts`)
- **Dashboard token-handling hardening (3 residual findings from the same audit as the XSS above).** None of these are exploitable on their own today, but each widened the blast radius of a future bug:
  - *Bearer token no longer a page-global.* `ui.html.ts`'s client script kept `TOKEN` as a `var` shared across its whole ~1000-line closure. It's now sealed inside its own inner IIFE that exposes only the `fetchAuthed` helper — code elsewhere in that closure (present or future) can no longer read the raw token by name.
  - *Constant-time token comparison.* `serve.ts`'s `isAuthorized` compared the header/query token with plain `===`, which short-circuits on the first differing byte and is a textbook timing side-channel — the one scenario the package's own docs call out as realistic (`authToken` is required specifically when bound off-loopback, i.e. reachable over a network). Both the header and query-string checks now go through `crypto.timingSafeEqual` on length-checked, equal-length buffers.
  - *Token-in-URL narrowed to the one route that needs it.* `?token=` is no longer accepted on the JSON API routes, only on the HTML page route. The page's own polling already re-sends the token as an `Authorization` header (fixed in 4.8.2), so the only request that structurally *can't* carry a header is the initial browser navigation that loads the HTML shell — that's the sole remaining query-string exposure, narrowing the token's footprint in access/proxy logs and browser history from every poll to one request.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.8.2 - 2026-07-22

### Added

- **`DashboardOptions.evaluate`** — an "Evaluate system prompt" drawer action that grades a trace's last captured system prompt via an LLM judge, editable per-run instructions included; the dashboard's first and only write-capable route (`POST .../spans/:spanId/evaluate`), off unless configured and gated by the same `authToken` / `allowedHosts` checks as every other route
- `evaluateSystemPrompt` / `extractLastSystemPrompt` / `findSpanById` — the building blocks behind the drawer action, exported for scripting a grade outside the UI

### Fixed

- The dashboard's client-side poll (`GET {basePath}api/aggregate` / `api/traces`) now carries the page's `?token=` as an `Authorization: Bearer` header on every request — previously, once `authToken` was configured the initial page load succeeded (the browser's navigation request carries the query string) but every subsequent 2s poll had no auth attached and 401'd forever, leaving the dashboard stuck on an empty/error state despite loading successfully
- `PanopticConfig.cache` failures (hydrate-on-startup or write-through — bad URL, unreachable Redis, auth failure) are no longer swallowed into total silence: a new `PanopticConfig.onError` hook fires on every failure, defaulting to `log.error("ai-panoptic", "cacheStore", error)` when not supplied, so a misconfigured cache driver now surfaces in logs instead of leaving the dashboard permanently empty with zero diagnostic

## 4.5.0 - 2026-07-01

### Added

- **Zero-setup local dashboard** — `dashboard(store, options)` serves a loopback-only mini-Langfuse (default `127.0.0.1:4319`) with no Docker and no account: light / dark / system theme, a two-pane drawer (nested call tree / detail), a metadata panel, colour-coded Title-case type labels, arrow-coded token rollups (`↓input · ↑output · total`), per-node rollup cost, and the Warlock logo.
- **Dashboard search / filter / grouping** — client-side free-text search, status / type / session / prompt filter chips, an errors-only toggle, and group-by Session / Prompt / Type with a per-type aggregate-stats panel (count, failure rate, p50 / p95 latency, tokens, cost).
- **Cost heatmap, timeline view, and deep-links** — each node carries a cost-tinted accent; the drawer toggles between the call tree and a Gantt timeline (critical path highlighted); the open trace + span are reflected in the URL hash for shareable views.
- **Prompt-version linkage** — agent spans stamp `agent.promptName` / `agent.promptVersion`; the dashboard filters and groups by the resolved `name@version` key.
- **Cache-backed persistent trace store** — `createCacheTraceStore(cache, options)` persists traces through any `@warlock.js/cache` driver, serves reads from an in-memory mirror, and re-hydrates on `ready()` so traces survive a restart; `ai.config({ panoptic: { cache } })` wires it.
- **Declarative `ai.config({ panoptic })`** — configure panoptic once; it registers on core's observer registry and starts the dashboard. Per-flow `observe` + `observeAll` opt flows into observation.
- **`ContentCaptureOptions.fullHistory`** — capture the agent's complete message history on the span; agent content is emitted as a `[system, user]` chat array; Langfuse gets trace-level `input` / `output`.
- **`onError` hook** — handle isolated exporter failures on `panoptic()` / `createCollector()`.
- **Pure trace-list helpers** exported from the package root (`filterTraces` / `groupBySession` / `groupByPrompt` / `groupByType` / `aggregateByType` / `rollupCost` / …) so your own views mirror the dashboard's rules.

### Changed

- **Title-case status & type labels** across rows, drawer, chips, and group headers (underlying filter keys stay lowercase); `team` is a first-class dashboard type; type chips show only present types; drawer metadata keys are humanized; the group-by toggles became a single `Group` dropdown.

### Fixed

- **Isolated exporter failures no longer fail silently** — a failing exporter still never crashes the run, but now warns once (or calls `onError`).

### Security

- **Dashboard hardening** — bearer-token auth (`authToken`, required when binding off-loopback), a `Host`-header allowlist (DNS-rebinding guard), and security response headers (`nosniff` / `X-Frame-Options: DENY` / locked-down CSP) on every response.
- **Error redaction** — captured error `message` / `stack` are scrubbed of secrets (Bearer tokens, API keys) and a retained `cause` is deep-redacted (auth / cookie headers stripped) before a trace is stored or exported.

## 4.4.0 - 2026-06-21

### Added

- **Opt-in content capture.** `panoptic({ captureContent, redactContent })` copies the agent prompt / response and each tool's args / result onto spans, surfaced by the console (`io`), file, OTel (`gen_ai.prompt` / `gen_ai.completion`), and Langfuse exporters. Off by default; a `ContentRedactor` masks each value.

### Fixed

- **Langfuse token accounting** — generations now meter their own usage (rolled-up minus children) and the root execution is metered, so the trace total no longer double-counts nested spans.

## 4.3.0 - 2026-06-21

Initial release — observability collector + exporters for `@warlock.js/ai`.

### Added

- `panoptic()` — the one-call subscriber factory: builds a collector, registers exporters, and feeds traces via `attach()`, `middleware()`, or `collect()`.
- Exporters — `consoleExporter()`, `fileExporter()` (JSON-Lines), `otelExporter()` (GenAI semantic conventions), and `langfuseExporter()`. `@opentelemetry/*` and `langfuse` are optional peers, lazily imported.
- `createInMemoryTraceStore()` — a queryable in-memory trace store (`query` / `aggregate` by runId, sessionId, status, time window; optional `capacity` FIFO cap) that doubles as an exporter.
- Vendor-neutral trace contracts (`Trace` / `TraceSpan` / `CollectorContract` / `ExporterContract`) derived 1:1 from the core `BaseReport` tree, plus skills for observing, exporting, and querying traces.

### Fixed

- **Failed root runs now carry their error in every export** (threaded from the result envelope onto the root span).
- **Per-span exporters now receive every span** (the collector walks the finalized tree).
- **`panoptic().middleware()` now works on a supervisor** (the middleware declares a `supervisor` hook map).

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
