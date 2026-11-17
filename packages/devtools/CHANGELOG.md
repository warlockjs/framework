# Changelog — @warlock.js/devtools

All notable changes to `@warlock.js/devtools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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
