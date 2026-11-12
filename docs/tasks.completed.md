# Completed tasks

Newest first. Each entry records the release that shipped it and how it was verified.

### T-099 [chore] Upgrade notes miss the route-hook typing change

- Source: application upgrade report of 2026-11-12.
- What and why: since the fastify floor moved in 5.53, installs resolve fastify 5.12.8, which types route hooks with
  `this: FastifyInstance`. A spec that calls a `RouteOptions["serverOptions"]` hook directly fails with TS2740, and
  nothing in the upgrade notes said so. The route options page and the integration-test pitfalls now explain the fix
  (`hook.call(fastify, request, reply)`), and the 5.53.1 changelog, release summary and release entry carry it as an
  upgrade note.
- Evidence: `node_modules/fastify/types/hooks.d.ts:40` (the `this` typing);
  `docs/src/content/docs/v/latest/core/the-basics/routing-deep.md`;
  `docs/src/content/docs/v/latest/core/testing/integration-tests.md`; `packages/core/CHANGELOG.md` (5.53.1).
- Acceptance: the note is in the docs pages and the 5.53.1 upgrade notes.
- Shipped: 5.53.1 (tag `v5.53.1`).
- Verified: the typing was read in the installed fastify types; documentation only, covered by the docs build and the
  public-text gate of the release.

### T-098 [bug] Route registration fails a large app at the 30-second limit

- Source: application upgrade report of 2026-11-12.
- What and why: the route-registration child had one 30-second limit for the whole step (default
  `build.routeRegistrationTimeoutMs`, or `WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS`). A large app whose modules
  were each fast still failed a build with "Route registration child timed out after 30015ms", and the message did not
  say how to raise the limit. The limit now restarts each time the child finishes a route module, so it measures
  time without progress; a single module longer than the limit still fails. The default stays 30000 ms. The error
  now names both settings with an example (`routeRegistrationTimeoutMs: 120000`,
  `WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS=120000`). A value an app set now means the longest time one module may take.
- Evidence: `packages/core/src/production/registration-child-runner.ts:108-124` (timer and message), `:153-156`
  (restart on progress); `packages/core/src/production/resolve-build-config.ts:121` (the variable);
  `packages/core/src/warlock-config/default-configurations.ts:7`; `packages/core/src/warlock-config/types.ts`
  (setting documentation); `docs/src/content/docs/v/latest/core/architecture-concepts/warlock-config.md`;
  `packages/core/skills/run-app/SKILL.md`.
- Acceptance: a child that keeps finishing modules is not cut off at the limit; a single module longer than the limit
  still fails; the message names the setting and the variable.
- Shipped: 5.53.1 (tag `v5.53.1`).
- Verified: new specs in `packages/core/src/production/registration-child-runner.spec.ts` (message text, restart across
  modules, one long module still times out) and `route-registration-snapshot.spec.ts` pass; the core typecheck is
  clean; workspace typecheck, unit tests, lint, format and gates ran on the release tree. Time spent before the first
  progress message (child start, file scan) still counts against one window. Not confirmed on the reporting app: if
  one module alone takes longer than the limit, the setting still needs raising, and the message now says how.

### T-097 [bug] Shell assignment refusals reuse the `"nested"` ask reason

- Source: application upgrade report of 2026-11-12.
- What and why: a command that sets a variable which steers which program runs (`NODE_OPTIONS=`, `PATH=`, `PAGER=`,
  `GIT_*_COMMAND`, `*_ASKPASS`, `LD_*`, also through `env`, `export`, `read`, `printf -v`, `getopts`) reached
  `shell.onAsk` with `reason: "nested"`, the reason `bash -c` uses, so an approval handler could not tell the model
  which rule it hit. It now arrives as `reason: "assignment"` with the variable name in the new optional `variable`
  field, and the text the model reads names the variable. A PowerShell `$env:NAME = value` was already refused as
  `"unsupported-syntax"` (asked as `"unparsed"` with `onAsk`); it is not parsed as an assignment, there is no
  PowerShell assignment grammar to attach a check to, and the docs now describe that behaviour.
- Evidence: `packages/ai-workspace/src/contracts/shell-approval.type.ts:38,53`;
  `packages/ai-workspace/src/policy/shell-check.ts:576`; `packages/ai-workspace/src/ops.ts:126`;
  `docs/src/content/docs/v/latest/ai/tools/use-workspace.md`; `packages/ai-workspace/skills/use-a-workspace/SKILL.md`.
- Acceptance: every assignment form asks with `"assignment"` and its variable; real runner asks stay `"nested"`
  without `variable`; the refusal text names the variable.
- Shipped: 5.53.1 (tag `v5.53.1`).
- Verified: `shell-check.spec.ts` and `shell-rules.spec.ts` (end to end through `onAsk`) pass, and the package
  typecheck passes; the PowerShell behaviour is pinned by a new spec; workspace typecheck, unit tests, lint, format
  and gates ran on the release tree. Behaviour change for apps: a handler that matches `"nested"` exactly no longer
  sees these asks (listed under Upgrading in the changelog).

### T-096 [bug] Published source maps point at files an installed app does not have

- Source: application upgrade report of 2026-11-12.
- What and why: 5.53.0 removed `sourcesContent` from the published source maps to shrink tarballs, but their
  `sources` still name files in the framework's own repository. The dev server's bundler looked each one up on disk
  and logged "Sourcemap for … points to a source file outside its package" (225 warnings per start in the report),
  burying real warnings. The tarballs ship no source files, so there is no content-free form that avoids the lookup
  and keeps stack traces readable. The release step now keeps `sourcesContent` (the 5.52 map shape, which did not
  warn) and checks every code map before packing: a map whose sources have no embedded content and do not resolve
  inside the package refuses to pack, naming the package and the first maps. Tarballs are back to their 5.52 size
  (`@warlock.js/core` about 3.5 MB instead of 2.4 MB).
- Evidence: `tools/release/scripts/strip-source-map-sources.ts:27` (`assertSourceMapsSelfContained`);
  `tools/release/scripts/release-family.ts:33,800`;
  `tools/release/scripts/__tests__/strip-source-map-sources.spec.ts`.
- Acceptance: published maps carry `sourcesContent`; a build that would publish maps without it stops at the
  release step.
- Shipped: 5.53.1 (tag `v5.53.1`).
- Verified: the check's spec (9 cases) passes. Run read-only against the published tarballs, it passes all 31 packages
  of 5.52.0 (for example core 711 maps, web 324) and refuses the 5.53.0 tarballs of web (327 maps) and core (731).
  Not run in an app: that `warlock dev` shows no source-map warnings with the 5.53.1 tarballs is inferred from 5.52.0
  having the same map shape and from the bundler's lookup rule. The check tests existence in the build directory and
  does not check that `files` in `package.json` would leave a package-internal source out of the tarball. The file
  keeps its old name; renaming it is a cosmetic follow-up.

### T-095 [bug] A Windows script that awaits a supervisor call exits with code 13

- Source: application upgrade report of 2026-11-12.
- What and why: on Windows, `await supervisor(...).recover()` at the top level of a script with nothing else keeping
  Node running exited with code 13 ("unsettled top-level await") about 20 ms in. Every supervisor call first asks the
  PowerShell process-query helper who owns a pid. The helper, its pipes and the timer guarding its answer were all
  unreferenced, so nothing held Node open while PowerShell started (about a second). The answer timer now stays
  referenced while a caller waits (cleared on reply, retry, failure and close, and bounded by
  `observationTimeoutMs`); an idle helper still never keeps the host alive. `recover()` with no registry file yet
  resolves with an empty recovery on every platform. `spawn()` and `list()` had the same exposure; in an app, the
  server kept Node alive, so only a bare script showed it. A pending query can now delay a natural exit by up to
  `observationTimeoutMs`.
- Evidence: `packages/process/src/windows-helper.ts:185-199` (`send()`), `:56-63` (unreferenced child and pipes);
  `packages/process/src/supervisor.ts:164-197`; `packages/process/src/registry.ts:81-123`;
  `packages/process/tests/host-exit.test.ts`; `docs/src/content/docs/v/latest/process/index.mdx`.
- Acceptance: a top-level `await processes.recover()` settles on Windows with an empty recovery when the registry
  file does not exist.
- Shipped: 5.53.1 (tag `v5.53.1`).
- Verified: not run on Windows locally (no Windows machine). The report's repro settles on Linux because the helper is
  Windows-only. The mechanism was reproduced on Linux by driving the real `WindowsProcessHelper` with a stand-in helper
  that answers after 300 ms: before the fix the script exited 13 after 33 ms ("Detected unsettled top-level await"),
  after it the script exited 0 after 336 ms with the rows. `host-exit.test.ts` (3 cases; two fail before the fix on
  Linux and pass after), `windows-helper.test.ts`, `windows-supervisor.test.ts` and `observation.test.ts` pass, and the
  package typecheck is clean (it covers `src` only). The third case runs the real PowerShell path on the Windows CI
  job (`windows.yml`, matrix entry `process`), which is the first real Windows run of the fix.

### T-094 [bug] The global rate-limit key answers 500 for a client that disconnected

- Source: application upgrade report of 2026-11-12.
- What and why: the global `http.rateLimit` key (new in 5.53.0) called `normalizeIP(request.ip)`. When the client's
  socket is already gone, `request.ip` is `undefined` and the call throws `TypeError: Cannot read properties of
  undefined (reading 'toLowerCase')`, so the request answered 500 and recorded an error (about 13 times in one dev
  session on a long-lived stream route the browser reopens and drops). The key now falls back to the socket's remote
  address, then to the shared `unknown` bucket that `middleware.rateLimit()` uses, and only passes a string to
  `normalizeIP`. `request.detectIp()` returns an empty string in that case instead of `undefined`; `ipFilter` already
  refused a falsy address and the idempotency scope already used `"unknown"`.
- Evidence: `packages/core/src/http/build-rate-limit-options.ts:13,25-38`; `packages/core/src/http/trusted-proxy.ts:89-111`;
  `packages/core/src/http/trusted-proxy.spec.ts`; `packages/core/src/http/build-rate-limit-options.spec.ts`.
- Acceptance: a request without a client address is counted in the `unknown` bucket and answers normally.
- Shipped: 5.53.1 (tag `v5.53.1`).
- Verified: the plugin's throw on an undefined address was confirmed by running the installed rate-limit plugin.
  `build-rate-limit-options.spec.ts` (the real plugin with `ip` set to undefined answers 200, 200, 429; direct cases for
  the socket fallback and `unknown`) and the new `trusted-proxy.spec.ts` pass; the core typecheck is clean. The new
  specs were not run against the pre-fix code.

### T-093 [bug] HTTP request handling hardening

- Source: security and performance audit of 2026-11-11.
- What and why: request parsing let one anonymous request hold memory or the event loop, and trusted spoofable
  headers. Multipart bodies now have a 25 MB total cap (`http.multipart.maxTotalSize`, checked against
  `Content-Length` and while files stream) and `http.multipart.routes` / route `uploads` to parse uploads only where
  declared. Urlencoded bodies are decoded in one pass with `http.urlencoded.maxFields` (1000); array indexes above
  `http.input.maxArrayIndex` are dropped. `X-Real-IP` is no longer trusted under `trustProxy: true`
  (`http.realIpHeader` opts in). Uploads are sniffed by their bytes: SVG through `image()` is opt-in and markup is
  stored as `application/octet-stream`. Also: `http.requestTimeout` (300 s), `http.allowedHosts`,
  `request.signedCookie()`, readiness single-flight with a check timeout and a status-only production `/ready`,
  `ipFilter` patterns validated at boot, idempotency keys that include params and query, refusal of a duplicate
  in-flight request id, no page caching for unknown locales, and one-round-trip rate-limit counters.
- Evidence: `packages/core/src/http/multipart.ts`, `parse-urlencoded-body.ts`, `trusted-proxy.ts`,
  `uploads/sniff-upload-type.ts`, `allowed-hosts.ts`, `health.ts`, `request.ts`.
- Acceptance: each limit refuses with a coded error that names its setting; upgrade notes list every new refusal.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck (first-pass failures were
  fixed during review and re-run); independent review of the area, which also made the docs tell apps with a raised
  `fileUploadLimit` to raise `maxTotalSize`.

### T-092 [bug] Responses, errors and request logging

- Source: security and performance audit of 2026-11-11.
- What and why: 5xx responses could carry raw error messages and file paths, and every request paid for log entries
  no channel kept. A root error handler now answers opaque 5xx bodies, `sendFile`/`downloadFile` no longer expose
  paths, and a refused filter value answers 400. `http.compression` (gzip/brotli on `node:zlib`, off by default, on in
  new apps) also compresses streamed pages progressively; `sendFile` answers `Range` requests. `Response.parse` is a
  copy-on-write walk; request log entries and snapshots are built only when a channel keeps the level; header, CSP,
  CSRF-origin, route-handler, middleware-list and route-name lookups are cached; proxy and parser modules load lazily;
  `request.on()` warns once as deprecated.
- Evidence: `packages/core/src/http/server-error-handler.ts`, `compression.ts`, `file-range.ts`, `response.ts`,
  `error-mapper.ts`, `packages/core/src/router/router.ts`.
- Acceptance: identical response bodies for existing handlers; compression and Range covered by specs with real
  servers.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, which fixed a regression where a logger mock without `isEnabled` turned every request into a 500, added the
  400 mapping for refused filters, and documented when not to compress.

### T-091 [bug] Repositories, storage and encryption

- Source: security and performance audit of 2026-11-11.
- What and why: a client could disable pagination, bypass or flood the list cache, reach private hosts through a DNS
  answer that changed after the check, and replay temporary URLs across tenants. A client `paginate=false` is now
  capped at `maxPerPage` unless the repository sets `allowClientUnpaginated`; client `purgeCache`/`cacheKey` are
  ignored and list cache keys are narrowed. Remote fetches for storage connect only to checked addresses. Local
  temporary-URL tokens are versioned, strictly parsed and bound to the tenant prefix. `decrypt()` requires a 16-byte
  IV and tag; the environment report masks URL credentials; downloads keep only allowed extensions; stored MIME types
  follow the file extension. Passwords over 72 bytes warn (`rejectLongPasswords` refuses); native `bcrypt` is used when
  installed. The database cache driver's namespace removal and `flush()` work again; `bulkDelete` has a size limit and
  bounded concurrency; MongoDB keeps query events for the request log.
- Evidence: `packages/core/src/repositories/repository.manager.ts`, `packages/core/src/storage/utils/safe-fetch.ts`,
  `packages/core/src/storage/drivers/local-driver.ts`, `packages/core/src/encryption/encrypt.ts`,
  `packages/core/src/encryption/password.ts`, `packages/core/src/cache/database-cache-driver.ts`,
  `packages/core/src/connectors/database-query-events.ts`.
- Acceptance: server code outside a request keeps every option as before; upgrade notes cover the token and MIME
  changes.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, which made a server value that differs from the client's win, read the opt-in lazily, and fixed expired-row
  removal under a global prefix.

### T-090 [bug] ORM queries

- Source: security and performance audit of 2026-11-11.
- What and why: some query helpers put client text into SQL, MongoDB dropped filters it could not translate, and
  wildcard patterns could run unbounded regexes. MongoDB LIKE patterns are now capped (`driverOptions.like`); every
  operation is translated or throws, writes on grouped pipelines are refused, `$` field names and operator-shaped
  values are refused. PostgreSQL binds `has()` counts, whitelists operators, aggregates and casts, and resolves JSON
  paths at parse time against the query's tables and aliases (inside condition groups too). Pagination is capped by
  `maxLimit` (1000); bad counts throw `UnsafeFilterError`. The MongoDB query log carries no values and query events are
  off in production unless `queryEvents` is set. Performance: count pipelines drop sorts and unread lookups,
  `chunk()` pages by key, column-name conversion is memoised, `insertMany` splits at the parameter limit, TTL purges
  run in batches.
- Evidence: `packages/cascade/src/utils/like-pattern-limits.ts`, `drivers/mongodb/mongodb-filter-guards.ts`,
  `drivers/postgres/sql-comparison-operator.ts`, `query-builder/json-path-operand.ts`,
  `query-builder/pagination-limits.ts`, `query-builder/keyset-chunk.ts`.
- Acceptance: no filter is silently dropped on MongoDB; client-shaped refusals are `UnsafeFilterError` (400).
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, which kept `table.column` paths working in JSON helpers, closed the same injection inside `where()` callbacks,
  and warns once when something listens to MongoDB query events that are off.

### T-089 [bug] ORM models

- Source: security and performance audit of 2026-11-11.
- What and why: prototype keys could reach the dirty tracker, nested MongoDB updates skipped validation, `strictMode`
  never applied, and upserts and restores ignored global scopes. `__proto__`/`constructor`/`prototype` path segments
  now throw; nested updates validate through their root field; `strictMode` `"strip"`/`"allow"` take effect; upsert,
  restore and restore-all honour global scopes. Performance: the dirty tracker copies on write and diffs lazily,
  scope-free writes skip the id pre-fetch, sibling eager loads run together outside transactions, sync fan-out runs in
  commit order with retries, validators are reused per model class, unique/exists rules use `exists()`, and
  `idReservationBlockSize` reserves ids in blocks (opt-in).
- Evidence: `packages/cascade/src/utils/safe-path.ts`, `writer/database-writer.ts`, `database-dirty-tracker.ts`,
  `restorer/database-restorer.ts`, `relations/relation-loader.ts`, `model/generate-model-id.ts`.
- Acceptance: dirty sets, originals and changed values identical to 5.52 (pinned before the change); upgrade notes for
  the `strictMode` and nested-validation changes.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, including a differential run of the old and new dirty tracker over random documents and operations, which also
  made soft-delete scope detection exact and kept nested unsets written as removals.

### T-088 [bug] Validation limits

- Source: security and performance audit of 2026-11-11.
- What and why: large or hostile input could fan out unbounded work, pollute prototypes or pass unsafe URLs. Arrays and
  records without an explicit bound now stop at 10,000 items/keys, items validate in batches of 64, and at most 100
  errors are collected (all configurable). `__proto__` keys are refused or dropped; `url()` refuses `javascript:`,
  `data:`, `vbscript:` and `file:` unless `protocols` allows them; `NaN`/`Infinity` fail number rules and numeric
  mutators convert only numeric input; output deeper than `maxDepth` (256) fails; malformed `urlDecode()` input passes
  through; container mutators run once; `g`/`y` patterns are stateless.
- Evidence: `packages/seal/src/helpers/limits.ts`, `helpers/validate-items.ts`, `rules/string/url.ts`.
- Acceptance: each limit fails with a named rule; upgrade notes list the ways back.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area (limits, batching and mutator paths; the object output walk and the rule diffs were not read line by line).

### T-087 [bug] Cache, logger and context

- Source: security and performance audit of 2026-11-11.
- What and why: the LRU driver handed out shared objects, file-driver locks could have two winners, key parts could
  collide, cache logs leaked keys by default, log files could lose or wipe entries, and log text could carry terminal
  escapes. The LRU now returns copies; expired file entries are removed under a guard; key segments are escaped
  (`escapeCacheKeySegment`); per-operation cache logging is off by default; tag pruning samples instead of reading whole
  indexes (`exists`, `tagSample`, `removeMany`); Redis/pg reads skip an extra clone; memory drivers default to 10,000
  entries. File logs swap their buffer before writing, report failures, cap buffered entries, escape CR/LF and
  neutralise terminal escapes; a corrupt JSON log is set aside and `format: "jsonl"` appends; `ConsoleLog` gains
  `minLevel` and `Logger.isEnabled()`. Contexts share one async storage.
- Evidence: `packages/cache/src/drivers/file-cache-driver.ts`, `packages/cache/src/tagged-cache.ts`,
  `packages/cache/src/utils.ts`, `packages/logger/src/channels/file-log.ts`, `json-file-log.ts`,
  `packages/context/src/shared-storage.ts`.
- Acceptance: one winner among concurrent creators; no lost log entries under bursts; upgrade notes for the new
  defaults.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, which added the advice to keep rate limits and lockouts in a shared store now that the memory store is bounded.

### T-086 [bug] Auth and access

- Source: security and performance audit of 2026-11-11.
- What and why: concurrent guesses bypassed the login throttle, timing revealed which accounts exist, provider logins
  could take over unverified accounts, and tokens or their claims could be misused. Throttles count each attempt on
  arrival; unknown accounts spend one password check; reset and OTP delivery run after the response
  (`awaitDelivery`); provider linking follows `providers.linkExisting` (default `"verified"`); provider requests time
  out after 5 s; token claims must name the stored row's user; `Auth` hides `password`; credential failures log at
  debug. New opt-ins: `hashTokensAtRest`, `cookie.hostPrefix`, `accessToken.issuer`/`audience`, `emailLock: "pair"`,
  `passkeys.userVerification`. Production warns on short secrets and access tokens over 30 days. Performance:
  prepared JWT signers/verifiers, permission sets resolved once per user object for up to 1 s, revoke-all once per
  family, set-based one-time-token cleanup. `flush(user)` also clears the ambient tenant.
- Evidence: `packages/auth/src/middleware/login-throttle.middleware.ts`, `packages/auth/src/utils/token-digest.ts`,
  `packages/auth/src/providers/resolve-provider-user.ts`, `packages/auth/src/providers/provider-timeout.ts`,
  `packages/auth/src/services/jwt.ts`, `packages/access/src/services/resolution-memo.ts`.
- Acceptance: 20 concurrent logins reach the controller at most `max` times; hashed and legacy token rows behave the
  same.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, which fixed a race where a mistyped request locked an account its parallel correct login had just signed in
  to, and completed the upgrade notes; the Redis throttle spec and database integration suites were not run (T-014).

### T-085 [bug] Queue, scheduler and message bus

- Source: security and performance audit of 2026-11-11.
- What and why: a job payload could forge a context envelope, one-server jobs could fire on every server, a long job
  blocked the scheduler tick, and the message bus looped on invalid messages and lost consumers after reconnecting.
  Jobs now carry a versioned envelope that is never unwrapped from payload data; finished jobs are pruned by default
  (24 h / 1,000 completed, 7 d / 5,000 failed). `onOneServer()` intervals align to wall-clock boundaries; the tick
  never waits for a job (one at a time stays the default). Invalid messages are rejected instead of requeued, retry
  counts are parsed safely, request/reply uses direct reply-to, `disconnect()` is final, and channels re-bind after a
  reconnect. The memory store polls without copying.
- Evidence: `packages/queue/src/queue-context.ts`, `packages/queue/src/job-options.ts`,
  `packages/scheduler/src/scheduler.ts`, `packages/scheduler/src/job.ts`,
  `packages/herald/src/drivers/rabbitmq/rabbitmq-channel.ts`, `rabbitmq-driver.ts`.
- Acceptance: workers upgraded before dispatchers run old and new jobs (upgrade note).
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  area, which added the rolling-deploy note for the envelope; message-bus specs use fake channels, no live broker
  (T-014).

### T-084 [bug] Web page cache, multi-site and sitemaps

- Source: security and performance audit of 2026-11-11.
- What and why: cache keys could be poisoned or flooded and multi-site lookups grew without bound. The page cache now
  keys on the selected site's host, keeps nested query values distinct, never stores responses with unkeyed query
  parameters, caps stored variants per route (`pageCache.maxEntriesPerRoute`, 1000), sends `Vary: Cookie, locale` when
  the URL does not pin the locale, and accepts `cache.query` and `cache.varyHeaders`. The site resolver memo is an LRU
  bounded at 10,000 hosts. Error details are hidden under `warlock start` and any non-development environment. Per-site
  sitemaps are cached with validators and suppliers get `{ site, tenantKey, shared }`; sitemap paths are encoded;
  `web.tlsAskAllow` restricts certificate checks. Performance: compiled site route matcher, supplier concurrency,
  single-render shard writer, cached sitemap generations.
- Evidence: `packages/web/src/server/page-cache-key.ts`, `page-cache-route-cap.ts`, `page-vary-header.ts`,
  `error-disclosure.ts`, `tls-ask.ts`, `packages/web/src/sites/site-selector.ts`,
  `packages/web/src/sitemap/site-sitemap.ts`, `packages/sitemap/src/normalize-entry.ts`.
- Acceptance: a flood of distinct keys stores at most the route cap; no cache entry is shared across sites.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  web area.

### T-083 [bug] Web rendering, client and dev tools

- Source: security and performance audit of 2026-11-11.
- What and why: each page rendered twice and serialised its data up to seven times; dev tools trusted any loopback
  request. Pages now render once on the streaming renderer (data requests discard the stream), the payload is
  serialised once, translation pruning uses an index, production documents preload each route's chunks, page modules
  and the client manifest are cached, and the locale-routing table is no longer duplicated in the payload.
  `web.loaders: "parallel"` is an opt-in. Client: a click joins a pending hover prefetch (hover waits 65 ms) and live
  pages stop polling in hidden tabs. Forms echo fewer secret-looking fields (`redactValues` adds to the defaults,
  `echoValues: false`). The dev server keeps its host check for dynamic sites (`web.devAllowedHosts`); dev tools require
  a loopback or allowed `Host`, a matching `Origin` and no proxy headers.
- Evidence: `packages/web/src/server/render-page.ts`, `build-hydration-payload.ts`, `client-manifest.ts`,
  `execute-page-request.ts`, `action-state.ts`, `packages/web/src/client/navigation/prefetch.ts`,
  `live-page-data.ts`, `packages/web/src/vite/dev-server-config.ts`, `packages/devtools/src/server/guard.ts`.
- Acceptance: identical document bytes and escalation order; existing render contract specs unchanged.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  web area, which made a client disconnect abort a shell that is still waiting.

### T-082 [bug] AI serve and guardrails

- Source: security and performance audit of 2026-11-11.
- What and why: `ai.serve` streamed tool calls, reasoning and raw errors to clients, output guardrails ran after the
  text had already streamed, and some detectors were quadratic. `ai.serve` now sends a safe event set and a
  `{ text, data, error }` result (`events: "all"` restores), never crashes on a failing callback, validates `input`
  (`maxInputChars`), and adds `authorize`, `public` and `maxConcurrent` with a production warning when unauthenticated.
  Output checks buffer streamed text per trip (`stream: "unguarded"` opts out); input checks run once per text. The PII
  email scan is linear, injection phrases match through spacing and Unicode tricks, and `ai.guardrail.links` strips
  external image and link URLs from model output.
- Evidence: `packages/ai/src/serve/serve.ts`, `serve/public-error.ts`, `packages/ai/src/guard/guard.ts`,
  `guard/detectors/pii.ts`, `guard/detectors/injection.ts`, `guard/detectors/links.ts`.
- Acceptance: redacted values never reach the stream; adversarial inputs return in linear time.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  AI area, which fixed PII redaction failing open on a very large number of addresses, a quadratic title scan and
  `<image>` tags in the links filter.

### T-081 [bug] AI stores, retrieval and outbound requests

- Source: security and performance audit of 2026-11-11.
- What and why: checkpoints were never pruned on PostgreSQL/Redis, an interrupt could be resumed twice, reviewed
  skills could be swapped, the semantic cache answered across agents and sessions, RAG namespaces overlapped, and
  outbound requests could be rebound to private addresses. Checkpoint pruning keeps exactly `keepSnapshots` turns
  (Redis stores one key per turn), interrupt resumes claim atomically, skill candidates are stored apart and promoted
  by content hash, Redis stores index with sets, and the skill catalog is one read. Outbound requests pin checked
  addresses on every hop, the deadline covers the body, and cross-origin redirects drop credential headers. The
  semantic cache requires a matching context fingerprint and a session by default and skips tool runs. RAG matches
  namespaces exactly; scoped similarity widens until enough hits pass; HTML-to-text is linear; local attachments
  resolve symlinks inside allowed roots.
- Evidence: `packages/ai/src/checkpoint/redis.ts`, `checkpoint/pg.ts`, `human/resume.ts`,
  `skills/store/procedural-skill-store.ts`, `security/outbound-policy.ts`, `middleware/builtins/semantic-cache.ts`,
  `rag/retrieve.ts`, `utils/similar-within.ts`, `rag/loaders/load-html.ts`, `utils/prepare-attachment-part.ts`.
- Acceptance: a rebinding answer is refused at connect time with no request reaching the private host.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  AI area, which fixed a primary-key collision when compaction re-saved a turn on PostgreSQL; no real PostgreSQL,
  Redis or rebinding resolver was used (T-014).

### T-080 [bug] AI workspace, tools, CLI agents and trace dashboard

- Source: security and performance audit of 2026-11-11.
- What and why: tools could leak API keys to other hosts, hang on slow bodies or run quadratic parsers, and the
  workspace shell and search had bypasses and unbounded work. `http_request` keeps static headers on the `baseUrl`
  origin and follows redirects itself; `fetch_url`, `http_request` and `web_search` deadlines cover the body; MCP
  responses are capped (`maxResponseBytes`). HTML-to-Markdown, `grep` (a linear-time matcher with a work allowance that
  yields) and globs are linear; `grep` skips files over 2 MB. Lines assigning command variables (`PATH`,
  `NODE_OPTIONS`, `GIT_*`) are refused under command rules; `run_tests` refuses option-like patterns; spill files are
  private; child processes stop with the host. CLI agents gain `inheritEnv: "curated"`; the trace dashboard answers bad
  ids with 400, keeps 1,000 traces by default and lists summaries.
- Evidence: `packages/ai-tools/src/http/http-request.ts`, `web/html-to-markdown.ts`, `mcp/transport.ts`,
  `packages/ai-workspace/src/search/linear-regex.ts`, `policy/jail.ts`, `policy/shell-check.ts`, `backends/local.ts`,
  `output/spill.ts`, `packages/ai-cli/src/session/environment.ts`, `packages/ai-panoptic/src/dashboard/serve.ts`.
- Acceptance: outputs equal the previous implementations on randomised differential runs; hostile inputs finish
  quickly.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix; every package's unit-test suite and the full typecheck; independent review of the
  AI area, which capped list/quote nesting in the Markdown converter, made long `grep` scans yield to abort, and
  refused assignments through `read`, `printf -v` and `getopts`.

### T-079 [bug] Scaffold and supply chain

- Source: security and performance audit of 2026-11-11.
- What and why: new apps started with a 12 GiB upload limit, guessable reset codes, account enumeration, tokens
  without expiry and open admin routes. The template now caps uploads at 10 MB; reset codes come from a CSPRNG, are
  stored as HMACs, attempt-limited and single-use; forgot-password answers the same for every email and works after the
  response; tokens last 1 h / 7 d with refresh and `hashTokensAtRest`; users get a role, an admin middleware and post
  ownership checks (uploads stored after the check); `.env.*` files are ignored; production logs from `info`;
  compression on; bounded memory cache; CORS from `CORS_ORIGINS`; explicit `http.multipart.routes: "all"`. The
  scaffolder never installs through `npx` implicitly, drops the release-age exclusion and records `agentKit.pick`.
  Supply chain: dependency floors raised (fastify, fast-jwt, devalue), mail/image peers widened, every workflow action
  pinned by SHA, published source maps without embedded sources, unused scaffolder dependencies removed.
- Evidence: `packages/create-warlock/templates/warlock/src/app/auth/services/otp.service.ts`,
  `forgot-password.service.ts`, `src/app/auth/middleware/admin.middleware.ts`,
  `tools/release/scripts/strip-source-map-sources.ts`, `.github/workflows/release.yml`.
- Acceptance: a fresh app passes every `warlock doctor` deployment check.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each fix (template specs run the services against in-memory fakes); template typecheck,
  format and lint gates; every package's unit-test suite and the full typecheck; independent review of the area, which
  moved the update-post image save after the author check and the forgot-password work off the response.

### T-078 [feature] Deployment checks in `warlock doctor`

- Source: security and performance audit of 2026-11-11.
- What and why: risky production settings went unnoticed. `warlock doctor` gains nine warning-only checks that read
  the resolved config and name the setting to change: upload limits, CORS, auth token secrets and lifetimes, trust
  proxy, request timeout, production logging, compression, ignored `.env` files and unbounded memory caches.
- Evidence: `packages/core/src/cli/commands/doctor/checks/index.ts:1-62`,
  `packages/core/src/cli/commands/doctor/checks/config-values.ts`.
- Acceptance: a freshly generated app gets no warning; each check has pass, warn and absent-setting specs.
- Shipped: 5.53.0 (tag `v5.53.0`).
- Verified: new specs for each check (pass, warn and absent-setting cases) and the updated doctor command spec;
  core's unit-test suite and the full typecheck.

### T-006 [bug] An unrelated import aliased as `t` counts as a translator

- Source: owner, app field report of 2026-11-11.
- What and why: translators are matched by bare name, so `import { translateCopy as t }` marks the page dynamic.
- Evidence: `packages/core/src/localization/translation-usage.ts:51-56`, `:300-310`.
- Acceptance: an import whose imported name is not a translator does not bind a translator; `trans as t` still does.
- Shipped: 5.52.0 (npm 2026-11-11 17:16 UTC, tag v5.52.0 on d0d4d6195; fix commit d93ee99a0, Windows path fix d0d4d6195).
- Verified: new specs; full typecheck; core, web and auth unit tests; release gate (all packages, blog on the tarballs) green in run 43062033333.

### T-005 [bug] A string equal to a group name ships the whole group

- Source: owner, app field report of 2026-11-11.
- What and why: any key-shaped literal reaches its subtree, so a site name `"client"` ships every `client.*` key.
- Evidence: `packages/core/src/localization/translation-usage.ts:381`, `reaches`.
- Acceptance: a free-standing literal reaches only an exact key; translator arguments and declarations unchanged.
- Shipped: 5.52.0 (npm 2026-11-11 17:16 UTC, tag v5.52.0 on d0d4d6195; fix commit d93ee99a0, Windows path fix d0d4d6195).
- Verified: new specs; full typecheck; core, web and auth unit tests; release gate (all packages, blog on the tarballs) green in run 43062033333.

### T-004 [feature] `config.translations` cannot cover a computed lookup

- Source: owner, app field report of 2026-11-11 (a signed-out page shipped 2,117 keys, 97 KB inline).
- What and why: a declaration is merged as one more usage and the page stays dynamic, so it still ships every key.
- Evidence: `packages/core/src/localization/translation-usage-graph.ts:50-57`, `translation-usage.ts` `mergeTranslationUsage`.
- Acceptance: an exhaustive declaration form (`{ keys, exhaustive: true }`) limits the page to static plus declared keys.
- Shipped: 5.52.0 (npm 2026-11-11 17:16 UTC, tag v5.52.0 on d0d4d6195; fix commit d93ee99a0, Windows path fix d0d4d6195).
- Verified: new specs; full typecheck; core, web and auth unit tests; release gate (all packages, blog on the tarballs) green in run 43062033333.

### T-003 [bug] Repository default `orderBy` is dropped with the caller's

- Source: owner, app field report of 2026-11-11.
- What and why: `list()` merges config and repository defaults with the caller's options, then sanitizes the merged
  result as client input, so a default order on a non-sortable column is deleted (and warned on every call).
- Evidence: `packages/core/src/repositories/repository.manager.ts:599`, `:790-840`.
- Acceptance: only caller options are sanitized; trusted defaults always apply; warning once per repository; specs, docs.
- Shipped: 5.52.0 (npm 2026-11-11 17:16 UTC, tag v5.52.0 on d0d4d6195; fix commit d93ee99a0, Windows path fix d0d4d6195).
- Verified: new specs; full typecheck; core, web and auth unit tests; release gate (all packages, blog on the tarballs) green in run 43062033333.

### T-002 [bug] Email sign-in is case-sensitive

- Source: owner, app field report of 2026-11-11 (first seen in production 2026-11-04).
- What and why: `attemptLogin` looks the user up with the credentials as typed, so `Sara@x.io` does not find
  `sara@x.io`; the login throttle already folds case, so mis-cased attempts also lock out the right spelling.
- Evidence: `packages/auth/src/services/auth.service.ts:598-606`, `packages/auth/src/middleware/login-throttle.middleware.ts:129`.
- Acceptance: identifiers trimmed and the email lower-cased by one helper shared with the throttle; legacy rows stored
  with capitals still sign in; configurable; specs and docs.
- Shipped: 5.52.0 (npm 2026-11-11 17:16 UTC, tag v5.52.0 on d0d4d6195; fix commit d93ee99a0, Windows path fix d0d4d6195).
- Verified: new specs; full typecheck; core, web and auth unit tests; release gate (all packages, blog on the tarballs) green in run 43062033333.

### T-001 [bug] Multi-site: a `locales.json` above the site folders reaches no page

- Source: owner, app field report of 2026-11-11 (private Artifact), reproduced against 5.47.2 and 5.51.0 source.
- What and why: with `web.sites` set, `src/web/locales.json` is discovered, typed and counted for key ownership, but no
  page receives it; pages render raw keys with no warning. Pages get `webRoot` = the site folder, and the manifest only
  pairs a dictionary with a page when the two `webRoot` values are equal.
- Evidence: `packages/web/src/build/build-route-locale-manifest.ts:145-148`, `packages/web/src/build/discover-pages.ts:1024`
  and `:1318-1325`, `packages/web/src/build/route-locale-key-ownership.ts`.
- Acceptance: a dictionary above the site folders reaches every page under it in dev, production and SSR, matching the
  browser payload; a dictionary that reaches no page logs a build warning; single-site apps unchanged; specs and docs.
- Shipped: 5.52.0 (npm 2026-11-11 17:16 UTC, tag v5.52.0 on d0d4d6195; fix commit d93ee99a0, Windows path fix d0d4d6195).
- Verified: new specs; full typecheck; core, web and auth unit tests; release gate (all packages, blog on the tarballs) green in run 43062033333.
