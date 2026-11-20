# Changelog — @warlock.js/devtools

All notable changes to `@warlock.js/devtools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.62.0

### Fixed

- Image, speech and transcription runs show their model in the Runs page, the run summary and the AI totals (Reports, Models, Errors) instead of `(unknown)`. Totals saved before the upgrade stay under `(unknown)`, so a range that spans the upgrade lists both.
- In production, `production.panels.ai` and `production.panels.agents` are ignored with one warning at boot: Runs and Agents are development tabs, and production shows AI totals in Reports, Models and Errors. Before, both tabs were listed and stayed empty. Their routes are no longer registered there.

## 5.61.0 - 2026-11-20

### Added

- The Jobs tab shows each schedule's last duration, last error, runs, failures and recent runs, and the job counts (waiting, active, delayed, failed, completed) of each queue. "Counts not available" appears only for a queue driver without `counts()`.

### Fixed

- Closed production monitor URLs answer exactly like any unknown URL of the app, including a web site's `route_not_found` answer (JSON and document), instead of Fastify's default 404. The app's global rate limit applies to them as to any unknown URL (same `x-ratelimit-*` headers, same 429), and an error of the app's catch-all gets the app's own error answer.
- The Jobs tab finds the active queue driver; before, it could not and always said the queue was not available.
- Error messages in the Jobs tab (last error, recent runs) are scrubbed like request errors: quoted values, emails and documents are removed.
- The Queries tab works when production mode is enabled only through `devtoolsConnector` options; `queryEvents: true` is no longer needed.

## 5.60.0 - 2026-11-19

### Added

- An AI sidebar group with six pages: Reports, Runs, Agents, Models, Errors and Evaluate. Reports, Models and Errors show estimated cost, tokens, error rate and latency over 24 hours, 7 days, 30 days or a custom range, with accessible charts (keyboard tooltips, table view) that keep each model's colour while filters change. Cost is an estimate from model pricing: runs of models without pricing are counted next to every cost (a model priced at 0 counts as priced), a model whose runs used no tokens shows "No tokens used", and a comparison whose previous period is older than the kept history reads "No earlier data". Custom ranges longer than 8 days use daily columns from local midnight to midnight.
- Runs gains search, status, type, exact HTTP request id and group-by filters, summary tiles (the estimated cost says how many unpriced runs it leaves out) and a cost tint on the span tree by each span's own cost; Errors lists recent failed runs inside the chosen range and filters; Agents shows the last 24 hours per agent; Evaluate grades a system prompt with the configured judge model and shows the score, issues and judge.
- AI report API: `GET /api/ai/reports`, `/models`, `/errors` (range, timezone, agent, model and provider filters, previous-period comparison, 15 s cache), `GET /api/ai/runs` (filter, `requestId`, group, stats) and `GET`/`POST /api/ai/evaluate`.
- Hourly AI rollups per hour, agent, model and provider (runs, tokens, estimated cost, errors by category, latency histogram), stored in the app database (`devtools_ai_rollups`, part of `devtoolsMigrations`), in JSON files in development and in memory in specs. A write that fails part-way retries only the totals it did not save, so nothing is counted twice.
- `devtools.ai` options: `reports`, `retentionDays` (30 in development, 90 in production, 1 to 400) and `flushIntervalMs` (default 60000, minimum 5000).
- Specific error codes for AI routes: `ai.range-invalid`, `ai.evaluate-unavailable`, `ai.prompt-not-found` and `ai.evaluate-failed`.
- Devtools publishes where it is mounted so other packages can point to it. In production, Reports, Models and Errors are listed only when Panoptic is installed.

### Changed

- Upgrade note: in production, the Reports, Models and Errors tabs are on by default once Panoptic loads. Run `warlock migrate` to create `devtools_ai_rollups`; until then each process logs one warning at boot and the pages show "AI reports need their table". Turning all three tabs off with `production.panels` also stops the totals from being written.
- The `ai` tab keeps its id (and `production.panels.ai`) and is titled "Runs", inside the AI sidebar group.

## 5.59.0 - 2026-11-19

### Added

- The dashboard uses the Warlock gold palette and logo, in the light and the dark theme, and shows the Warlock.js version in the sidebar header and the app's name and version in its footer. `DevtoolsSessionView` gains `warlockVersion` and `app`; both are `null` when signed out or not found, and only the app's own `package.json` name and version are read.
- Production option `twoFactor: "off"` requires no second factor (an account that has one is still asked for it); boot logs a warning when it is off.
- Production option `passwords: { minLength, rejectCommon }` sets the password rules for accounts, invites and the first admin (`minLength` is 8 or more, `rejectCommon` defaults to `true`).
- The AI tab tells which of four reasons it is empty: `@warlock.js/ai` is missing, `@warlock.js/ai-panoptic` is missing, Panoptic failed to load (with the load error and both versions), or observation is off. Each shows a title, one line and the command to run.
- A reconnect banner shows while the app is unreachable and panels refetch when it returns.

### Changed

- The `/ai` answer carries `reason`, `title`, `command` and `detail` when unavailable; `message` stays.
- A too-short password answers with the configured minimum length.

## 5.58.0 - 2026-11-18

### Added

- Read-only share links in the production monitor (`production.share.enabled`): an admin creates an expiring, revocable link to a shareable panel (the Grimoire product map) under Admin, Share links, with a label. The token stays in the URL fragment and is stored hashed; the link opens only that panel's shared view. Needs the new `devtools_shares` table from `devtoolsMigrations`.
- Panels can serve a folder of images (`files`), declare a shared view (`share`), and receive captured error counts (`errors`). View contexts gain `file()`, `shared` and `share`, and panel requests carry `shared` when they come through a share link.
- A panel view's `asset()` and `file()` return absolute URLs, so a view can `import()` another of its modules.

## 5.57.0 - 2026-11-18

### Upgrading

- The dashboard has a new palette and layout. A package panel whose stylesheet used CSS variables the dashboard never defined (anything outside `DEVTOOLS_PANEL_TOKENS`) should switch to the listed tokens; see "Styling a panel" in the docs.

### Added

- The `panels` option accepts `[specifier, options]` entries. The options object is passed to the panel factory next to `root` and `mode`, for example `panels: [["@warlock.js/grimoire/devtools", { ttlMs: 60_000 }]]`. An invalid entry is reported with what to change and skipped; the other panels still load.
- `DEVTOOLS_PANEL_TOKENS`: the CSS variables a package panel stylesheet may use. Every one is defined in the light and the dark theme, and a spec checks the definitions, their WCAG AA contrast and the built-in panel views.
- A command palette (Ctrl/Cmd+K, or the search button in the top bar) jumps to any tab, the account page or an admin page.
- A theme toggle (system, light, dark) in the top bar, saved in the browser.
- Package panels show a "Loading <title>…" state while their view loads, so a slow panel is never a blank area.

### Changed

- The dashboard has a new look: a left sidebar with grouped, icon-labelled tabs (Monitor, Application, AI, Packages), a slim top bar, and a slide-over menu on narrow screens. Light and dark themes use a tinted palette with one brand colour, and every text colour meets WCAG AA contrast on both themes.
- Every built-in tab opens with a description and its actions, a row of summary figures, and a filter bar with result counts and a Clear filters action. Requests gains a status-class filter, Queries a Slow / N+1 / Errors filter, Errors a Source filter, and Logs a message search and a level control.
- Status codes, methods and log levels are colour-coded pills, durations show a bar sized against the rest of the list, table headers stay in view while scrolling, and rows open their detail with the keyboard as well as the mouse. Tables scroll inside their card on narrow screens.
- Detail views are split into titled sections with key/value grids and code blocks with copy buttons. The request detail has a Close button and a waterfall legend.
- Badges gain `success`, `warning`, `info`, `brand` and `neutral` tones, buttons gain `brand` and `soft`, and empty states show an icon and what to do next.
- Sign-in, account and admin screens use the new look.

## 5.56.0 - 2026-11-17

### Upgrading

- The dashboard is now a React app and replaces `ui/app.js`. Panel view modules keep working unchanged. Styles of a view that relied on the old dashboard's CSS classes may look different.
- These panel ids are now reserved: `resources`, `health`, `errors`, `jobs`, `instances`, `auth`, `account` and `admin`. A panel that uses one is left out with a message.
- The production monitor is opt-in. Nothing changes until you set `production.enabled`. To use it, install `@warlock.js/devtools` as a regular dependency, add `devtoolsConnector()`, `devtoolsMigrations` and `registerDevtoolsCommands()` to `warlock.config.ts`, run `warlock migrate`, and set `DEVTOOLS_PATH` and the first admin in the environment. See "Devtools in production" in the docs.
- `GET api/logs` rows now carry `instance` and `requestId`.
- `GET <path>` without a trailing slash now redirects to `<path>/` in development too.

### Added

- Production monitor: a dashboard at a secret path that answers your app's own 404 to anyone who is not signed in. It has its own accounts (admin and viewer roles) stored through Cascade, forced password change, authenticator-app and passkey two-factor, recovery codes, invite links, sign-in rate limits, an audit log, and a switch to disable it from the dashboard. It refuses to start without a path, a first admin and an encryption key (`DT001` to `DT010`). A correct password does not reset the failed-try count (only a completed sign-in does), the per-IP limit counts an IPv6 client by its /64, and a caller over the IP limit costs no password check. Adding or removing an authenticator app or a passkey, and making new recovery codes, asks for the current password or a fresh passkey check.
- Production capture: sampled requests, query shapes, routes, error groups and warn and error logs are kept per process with bounded memory and written to the database as redacted samples (shapes only, never values). Request errors and `error` log lines lose quoted values, emails and `{ … }` documents before they are grouped, stored or shown, and a request that fails in a handler shows its message and stack in the Errors tab. Slow and failed requests outside the sample are kept as summaries. At the default sample rate the added cost is about 1.3 µs per request.
- Several instances share one view: each process writes a report, and the dashboard merges them with an instance picker.
- EXPLAIN by query shape: plain `EXPLAIN` for PostgreSQL reads and `queryPlanner` for MongoDB reads. Executing plans run only with `explain.executing: true`, and never for statements that write. PostgreSQL plans run in a read-only transaction that is rolled back, a MongoDB aggregate with `$out` or `$merge` is never explained, and production plans show `?` in place of the query's values.
- New tabs: Resources (memory, CPU, event loop, garbage collection), Health, Errors and Jobs. Queries and Routes show latency statistics with histograms, in development too.
- `warlock devtools:enable` and `warlock devtools:reset-admin` (`registerDevtoolsCommands()`), and `devtoolsMigrations`, from `@warlock.js/devtools/production`.
- Error groups group log lines that carry a request id, and the Health tab records no error while the app boots.
- Panels can set `production: true`, and the panel factory receives `mode` (`"development"` or `"production"`). In production a panel's GET routes need a signed-in user, and every other method needs an admin, the CSRF header, and is written to the audit log.

### Changed

- The dashboard tabs are rebuilt in React with the same features: requests with filters, waterfall, EXPLAIN and curl, queries, routes, logs, mail, AI runs, agent traces and API docs. The API docs tab works under `warlock start` (it builds the OpenAPI document from the registered routes). The dashboard shell loads in apps that drop a trailing slash before routing, its Content-Security-Policy replaces the app's own, an unknown asset under the dashboard path answers the app's own 404, and a dashboard error is logged with the route relative to the dashboard path.
- The live stream sends `retry` and `hello` first, and request and log events carry `instance`.
- Query shapes drop dollar-quoted strings.
- In development, a value logged as the message (such as an Error) shows as text, and a tab that fails to draw no longer blanks the dashboard.
- The server answers 503 with a build hint when `ui/dashboard/` is missing.

## 5.55.0 - 2026-11-17

### Added

- Register your own dashboard tab with one line in `src/config/devtools.ts`: `panels: ["<package>/devtools"]`. A panel declares an id and a title, the data routes served under `/__warlock/api/<id>` and a browser view module. Every route and file sits behind the devtools guard. A package entry resolves from the app root, also when the package only has an `import` condition in `exports`. A panel that lists the same method and path twice is left out with a message, a `panels` option that is not a list is reported once, and Back from a panel view returns to its first view.
- The Processes tab uses the same panel registration, with no visible change.

## 5.53.0 - 2026-11-11

### Upgrading

- Opening devtools on a custom dev hostname (for example `app.test`) or through a local reverse proxy gets a 404. Add `allowedHosts: ["app.test"]` to `src/config/devtools.ts`, and `allowProxied: true` when a local proxy sits in front.

### Security

- The dashboard and its API answer only requests addressed to a loopback host (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`), refuse requests whose `Origin` is another site, and refuse requests carrying `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP` or `Forwarded`. A loopback socket used to be enough, so a website that pointed its domain at `127.0.0.1`, or anyone reaching the dev server through a tunnel, could read request history, SQL bindings, captured mail and AI prompts. A refused request gets an empty 404, and the terminal prints one warning per reason naming the option to change.
- The minimum `fastify` version is 5.12.6.

### Added

- `allowedHosts` (default `[]`) and `allowProxied` (default `false`), read from the app's `src/config/devtools.ts` (a plain object, safe in production) or passed to `devtoolsConnector()`. `allowedHosts` names a custom dev hostname such as `"app.test"` (`".app.test"` also matches subdomains); `allowProxied` allows a local proxy nobody else can reach.

## 5.38.0 - 2026-10-25

### Added

- The Requests panel and `GET /__warlock/api/requests` also read core's persistent request log (`storage/logs/requests/*.jsonl`), so request history survives a restart and the 200-request ring buffer. Live and persisted requests are merged without duplicates by request id; requests read only from disk are marked `persisted`.
- Request filters: the list API takes `status` (`404` or a class such as `5xx`), `route`, `method`, `since`, `until`, `q` (text in the URL or id) and `limit`, answering 400 for a bad value; the dashboard has search, status and method filters.
- A saved request opens with its error (message, stack, phase, page file, site), the redacted request and response, the log entries and the query summary with N+1 findings. `GET /__warlock/api/requests/:id` carries the full record as `record`.
- Copy as curl: `GET /__warlock/api/requests/:id/curl` and a button in the request detail. Values the log redacted stay `[REDACTED]`.
- Agents tab at `/__warlock` for the per-turn agent traces `@warlock.js/ai` records in development: system prompt, tools offered with schema hashes and token estimates, tool calls with results and refusals, retries and re-prompts, usage and cost, and a comparison with the previous run of the same agent. It needs no Panoptic.
- `GET /__warlock/api/ai/agent-runs` (optionally `?requestId=`) and `GET /__warlock/api/ai/agent-runs/:id`, plus `agent-trace` events on the stream, behind the existing development and loopback guard. Runs started during an HTTP request link to it. Types `DevtoolsAgentRun` and `DevtoolsAgentTraceEvent`.

## 5.34.3 - 2026-10-20

### Changed

- The agent skill now exports as `warlock-js-devtools`; package discovery descriptions stay within 450 characters.

## 5.33.0 - 2026-10-19

### Added

- AI panel at `/__warlock` and AI runs in HTTP request details, powered by optional `@warlock.js/ai-panoptic`: model, token/cache usage, historical cost, provider cache-hit trips, tool timings, retries, truncation and compaction metadata.
- Read-only AI list/detail endpoints and `ai` stream updates behind the existing development/loopback guard, with install guidance when Panoptic is unavailable.
- Bounded content-free trace retention, request-local correlation and cleanup with the dashboard Clear action and connector shutdown; application exporter/cache stores remain independent.
- Add a read-only Processes panel and guarded `/api/processes` endpoint, discovering the application registration generated by `warlock add process` only in development.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Changed

- The `devtools-overview` skill shows how to read a request's devtools timeline from the terminal with `warlock trace`, and how coding agents read recent requests through the `requests_recent` tool of `warlock mcp`. The JSON API they use (`GET <path>/api/requests`, `GET <path>/api/requests/:id`) is unchanged.

## 5.28.0 - 2026-10-01

### Added

- **Swagger UI.** `/__warlock/docs/swagger` renders the same OpenAPI document with [Swagger UI](https://github.com/swagger-api/swagger-ui) (Apache-2.0), and the dashboard's **API** tab has a **Scalar | Swagger UI** switch (Scalar stays the default; the choice is remembered in the browser). The prebuilt `swagger-ui-dist` 5.33.0 bundle and stylesheet are vendored in `ui/vendor/swagger-ui/` with their license and notice and served as `assets/swagger-ui-bundle.js` and `assets/swagger-ui.css`, so apps install no extra dependencies. The schema validator badge is off, so the page makes no outside request.
- **Downloads in the API tab.** `OpenAPI JSON` (`/__warlock/api/openapi.json`) and `Postman collection` links.
- **`GET /__warlock/api/postman.json`** returns the Postman collection for the registered routes, built by core's `getDevelopmentPostmanCollection()`. It answers 503 when the host's core cannot build one, with the same dev-only, loopback-only guard.

## 5.27.0 - 2026-10-01

### Added

- **API docs page.** `/__warlock/docs` renders the app's OpenAPI 3.1 document with Scalar, and the dashboard has a new **API** tab that shows it. The document comes from `GET /__warlock/api/openapi.json`, built in-process by core's `buildDevelopmentOpenApiDocument()` from the routes already registered (the same generator as `warlock generate.openapi`); it answers 503 when the host provides none. Everything stays behind the existing dev-only, loopback-only guard.
- The API docs page uses [Scalar](https://github.com/scalar/scalar) (MIT). Its prebuilt browser bundle (1.72.2) is vendored in `ui/vendor/scalar/` and served as `assets/scalar.js`, so apps install no extra dependencies. Nothing is fetched from a CDN, and the page turns off Scalar's web fonts, telemetry, AI agent and MCP so it makes no outside request.

## 5.26.0 - 2026-09-30

### Changed

- Dependencies: `fastify` ^5.12.5 (security fixes).

## 5.25.0 - 2026-09-28

### Added

- New package. A development-only dashboard served at `/__warlock`: request timeline, queries with EXPLAIN, N+1 detection, dev mailbox, logs, cache operations and the route map. It refuses to run outside development and answers only loopback clients.
