# Open tasks

Open work for the framework repository. Finished entries move to `tasks.completed.md` (newest first).

## Owner decisions waiting

- Next-major items (T-007, T-009, T-033) wait for 6.0.

## Next release

- 5.62.0: T-185, T-186 and T-187 are fixed on main (b779cc0e5) and verified (typecheck + unit tests of devtools,
  ai-panoptic, ai-anthropic; review pass). Next step: full workspace verification, release gate, publish.
- 5.61.0 shipped T-142, T-143, T-146, T-149, T-151, T-169 and T-178 (see `tasks.completed.md`).

## From the 2026-11-20 AI findings page

Source for all three: app findings page https://claude.ai/artifact/2oVjQgDQeLsNPzETbXNBzF (reported against 5.59.0).
Each repro was re-run on the 5.61.0 sources on 2026-11-20 and still reproduces.

### T-185 [bug] Production monitor: the Runs and Agents tabs can be turned on but never collect

- What and why: `production.panels: { ai: true, agents: true }` mounts both tabs, but production never attaches the
  AI or agent-trace source, so `/api/ai` answers `not-collected` and `/api/ai/agent-runs` tells a production user to
  run an agent in development. Since 5.60.0 production has hourly totals (Reports, Models, Errors), so usage is
  visible; what is missing is the run list, or a clear refusal.
- Evidence: `packages/devtools/src/production/boot.ts:229-233` attaches only the mail source;
  `packages/devtools/src/devtools-connector.ts:128-134` (development only);
  `packages/devtools/src/production/http/mount.ts:500` registers the AI routes without `ai`/`agentTraces`;
  `packages/devtools/src/server/ai-routes.ts:13-17`; tab defaults in `packages/devtools/src/production/contracts.ts:469-470`.
- Decide one of: a content-free production run list (name, model, usage, cost, duration, status; no prompt text,
  bounded store) fed to the Runs/Agents routes, or a config error (DT code) when `production.panels.ai`/`agents` is
  `true`. The Agents message in production should not point to `warlock dev` either way.
- Acceptance: spec that boots production with both tabs on and gets either runs or the config error; docs
  (`devtools/production` page), skill and CHANGELOG.
- Decision (2026-11-20): no production run store (production keeps hourly totals across instances; a per-process run
  list would differ per instance). `ai`/`agents` set to `true` in production are dropped with one boot warning that
  points to Reports, Models and Errors; no boot error, so apps that already set the flags keep booting.
- Status: fixed on main in b779cc0e5 (2026-11-20); ships in 5.62.0.

### T-186 [bug] Image runs carry no model in Panoptic span attributes

- What and why: an `ai.image` report has `model: { name, provider }` and `imageCount`, but
  `extractSpanAttributes` has no `image` case, so the span has no attributes. The development Runs tab shows
  `models: []`, and the production rollups count image runs under model `(unknown)`.
- Evidence: `packages/ai-panoptic/src/collector/extract-span-attributes.ts:72-104` (switch without `image`);
  `packages/ai/src/image/image.ts:66-72` (report shape); readers of `agent.model.name` in
  `packages/devtools/src/sources/ai-source.ts:177`, `packages/devtools/src/ai/reports/runs.ts:74`,
  `packages/devtools/src/ai/rollup/extract.ts:242`.
- Fix: an `image` case that writes the model name/provider (the same keys the readers use, or a shared
  `model.name` key read by all three) and `image.count`. Check `speech` and the other `MODEL_SPAN_TYPES` in
  `rollup/extract.ts:12` for the same gap.
- Acceptance: spec with `MockImageModel` through Panoptic and the devtools source shows the model in the run summary
  and the rollup key; ai-panoptic + devtools CHANGELOG.
- Status: fixed on main in b779cc0e5 (2026-11-20); ships in 5.62.0.

### T-187 [bug] Anthropic: `cacheControl.breakpoints` drops the automatic request-level cache marker

- What and why: with `promptCaching: true`, any `breakpoints > 0` removes the request-level `cache_control`, so a
  multi-trip agent stops reading its history from cache (reported live: trip 2 read 0 cached tokens with the hint vs
  26,957 without, about 27K tokens of history). The JSDoc says the hint replaces the marker, but the public docs do
  not: `ai/providers/anthropic.mdx` (Prompt caching) describes "two independent breakpoints" and never mentions the
  automatic marker, and `ai/best-practices/cost-and-efficiency.md:153-156` recommends `breakpoints: 1` for a
  multi-trip agent.
- Evidence: `packages/ai-anthropic/src/model.ts:1029-1037` (`buildAutomaticCacheControl`), `:1000-1021`
  (`buildSystem`); `packages/ai-anthropic/src/config.type.ts:90-110`.
- Fix: keep the request-level marker next to the system breakpoint (Anthropic allows 4 breakpoints: tools, system,
  automatic = 3), and update both docs pages; check Bedrock for the same choice.
- Acceptance: mocked-fetch spec: `{ breakpoints: 1 }` sends the system block marker, the tools marker and the top-level
  `cache_control`; docs, skill, CHANGELOG.
- Status: fixed on main in b779cc0e5 (2026-11-20); ships in 5.62.0.

## From the 5.61.0 release

### T-182 [feature] Production monitor: closed URLs hit with a request body differ from an unknown URL

- Source: 5.61.0 review, 2026-11-20.
- What and why: 5.61.0 makes closed monitor URLs answer like an unknown URL for `GET` and `HEAD` (same body, headers,
  rate-limit headers and 429). For `POST` and other methods with a body, an unknown URL can answer 400/413 from body
  parsing before routing, while the monitor refuses before reading the body and answers 404. That difference existed
  before 5.61.0; `devtools/security.mdx` now says so.
- Evidence: `packages/devtools/src/production/http/mount.ts` (the gate and `notFound`), `answerUnknownUrl` in
  `packages/core/src/router/router.ts`.
- Acceptance: a spec sends the same malformed and oversized bodies to a closed monitor URL and an unknown URL and gets
  the same status and body; the security page sentence is narrowed back if it matches.
- Status: open.

### T-183 [feature] Grimoire dev tab: stream partial answers on the first open, refresh live facts after route edits

- Source: 5.61.0 build (T-169, T-178), 2026-11-20.
- What and why: an open that comes before the dev-start warm-up ends still waits for the whole build (about 6.7 s on a
  10,400-file app); the panel routes return whole JSON, so partial answers need a streaming panel contract. Live
  route facts are read on the first open only; after a route edit the tab needs `warlock grimoire build` or a restart.
- Evidence: `findings/5.61/reports/live-checks.md` (timings), `packages/grimoire/src/devtools/snapshot-source.ts`
  (`liveFacts`), `packages/grimoire/src/devtools/index.ts` (warm-up).
- Acceptance: the first open shows the summary before the full book is built; a route edit in dev shows up in the tab
  without a manual build; specs.
- Status: open; do only if an app asks (vet first).

## From the 5.60.0 release

### T-180 [bug] `warlock dev` exits with 0xC0000409 on Windows while many files change

- Source: app findings page (T-179), seen on an old 4.5 version, not re-tested since.
- What: the dev server sometimes exits with code 3221226505 (0xC0000409, a native fast-fail) during rapid edits.
- Checked 2026-11-19 (5.60.0): file batches are serialised (`batchQueue`), file work is bounded, dev bootstrap logs
  uncaught errors instead of exiting. Only gap seen: the chokidar `error` listener is commented out in
  `packages/core/src/dev-server/files-watcher.ts`; not shown to kill the process.
- Acceptance: a repro on a Windows machine (many files saved at once, e.g. a formatter over the project) before any fix.
- Status: needs a Windows repro.

### T-181 [chore] Testcontainers-based integration suites cannot start on this server

- Source: 5.60.0 live PostgreSQL run, 2026-11-19. The 7 cascade PostgreSQL suites that start their own containers
  fail with ECONNRESET here and left 21 idle `postgres:16-alpine` containers behind (stopped and removed 2026-11-19
  at the owner's request; Docker still lists them as "Removal In Progress" because overlay2 reports the mounts busy).
- What: give the integration harness a way to use an existing database from env (`LOCAL_PG_*` / a Mongo URL) for every
  suite, so live runs need one named `--network host` container and no testcontainers.
- Status: open.

## From the 2026-11-19 app reviews

### T-168 [feature] Stamp releases from the app's release flow and add a "What's new" view to the Product map

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0): the app shipped two releases but its Grimoire had none, so every changelog line read "Not released yet".
- What and why: `warlock release` (or the package version and git tags) should stamp the changelogs and write the release file; the Product map gets a "What's new" view per release.
- Evidence: the release and changelog reading code is under `packages/grimoire/src/` (find `release` and `changelog`); the Product map "What changed" list is `packages/grimoire/ui/product-map.js:579` (T-159 redesigns it first).
- Acceptance: after a release, the changelog lines carry the version and the Product map shows a "What's new" view; specs; docs and CHANGELOG entry.
- Status: open; do after T-159 settles the "What changed" layout.

### T-171 [feature] Parked: requests only one app has made

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0, one app). Vetting rule: build only requests with a verified need; wait for a second app to ask.
- Items:
  1. Link flows to analytics events and funnels (an `analytics <name>` step or a pluggable fact source). The `event` step resolves only app event listeners (`packages/grimoire/src/warlock/adapter.ts`, named facts). See T-158.
  2. Product health from the app's own errors and feedback, and a configurable error window (today one hour: `packages/grimoire/src/devtools/product-map.ts:57`, matched by route and fed only by the monitor's error groups). See T-158.
  3. Plan gating and locales as structured data: `who` is free text and audience has many free-text values; ask is a declared audience and plan vocabulary and per-flow locale coverage.
  4. A screenshot workflow (`warlock grimoire shoot`: capture per page and story step plus a staleness check).
  5. A plain-words journey diagram of how flows connect, per feature and across features.
- Status: parked, one app asked. Revisit when a second app asks for the same item.

### T-172 [bug] Product map and developer UI issues seen in screenshots, no runnable repro yet

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0, 1440 px and 390 px, light and dark). Each item was observed through screenshots only; none has a runnable repro, so each needs reproducing before a fix.
- Items:
  1. Repeated rows in "Where you see it" on a feature page (the same page listed several times, one row per block). Partly checked: the row key includes the block (`packages/grimoire/src/devtools/product-map.ts:319`); whether the UI renders the block name is unverified (`packages/grimoire/ui/product-map.js`, the appearances list). Likely fix: show the block name or group by page.
  2. Developer feature page shows one card per finding in a very tall, ungrouped list with the neighbour graph underneath (`packages/grimoire/ui/grimoire-view.js`); the Check tab already groups the same findings. Likely fix: group by code and collapse, graph above.
  3. Raw ids and code terms on business screens: app group headings show ids instead of titles, "For free" in the flow meta line, raw case keys in "What if...", AC/T references in "What changed" (`packages/grimoire/ui/product-map.js`, near `:255` and `:694`; T-159 touches the "What changed" part).
  4. Overview task count ("0 open, 1 waiting") disagrees with the tab badge ("Tasks 1") when a task has the status "waiting for approval".
  5. Modules graph unreadable on a large app (labels cut from the left and overlapping, one 2,548-file node). Design opinion: cut labels from the right, split sites from modules, offer a top-N matrix.
  6. Phone width (390 px): the tab bar hides 5 of 8 tabs behind a fade with no hint, and the Apps page is very tall. Likely fix: a visible "more" control or a select; collapsed groups on Apps.
- Acceptance: for each item, a repro (a spec on the view data or a screenshot test) before the fix; items 5 and 6 need an owner design call first.
- Status: needs repro.

## 5.58.0: Grimoire flow pages, type-only reach and product map

Design: `findings/5.58/ARCHITECTURE.md` (decisions D1–D28); work-package briefs in `findings/5.58/briefs/`.

## After 5.56.0: production monitor follow-ups

### T-147 [chore] Real passkey sign-in in a browser

- Source: 5.56.0 security review and end-to-end run, 2026-11-17.
- What and why: passkey registration and sign-in were only tested against a fake adapter; no real WebAuthn ceremony
  ran (headless Chromium can do it with a virtual authenticator through CDP).
- Evidence: `packages/devtools/src/production/auth/passkeys.ts`, `findings/5.56/reports/E2E.md`.
- Acceptance: a Playwright run with a CDP virtual authenticator registers a passkey, signs in with it, and uses it as
  the step-up for recovery codes.
- Status: open.

## After 5.55.0: Grimoire follow-ups

### T-138 [chore] Build a book of the release gate's blog app in CI

- Source: 5.55.0 build and pilot, 2026-11-16.
- What and why: the PLAN's acceptance asks for a book of a real app, but 5.55.0 did not build one in CI. The release
  gate already builds the blog app from the packed tarballs, so the same run can build and check its book.
- Evidence: `tools/release/ci/blog-check.mjs`.
- Acceptance: the release gate builds the blog app's book, runs `warlock grimoire check` on it, and fails when either
  step fails.
- Status: open.

### T-139 [bug] Tooling commands exit before Grimoire's cached-routes fallback when the app's preload fails

- Source: 5.55.0 build and pilot, 2026-11-16.
- What and why: when the app's config or bootstrap fails during core's command preload, `warlock grimoire build` and
  `warlock grimoire check` exit before Grimoire can fall back to cached routes (GR8002). `warlock inspect` has the same
  problem. Core needs a way for tooling commands to catch a failed preload so they can continue.
- Evidence: `packages/grimoire/src/warlock/commands.ts`, `packages/grimoire/src/warlock/actions.ts:61-70` (the GR8002
  fallback); `packages/core/src/cli/cli-commands.manager.ts` (command preload).
- Acceptance: with a broken config, `warlock grimoire build` reports GR8002 and uses cached routes when they exist; a
  spec covers a failing bootstrap for `grimoire build`, `grimoire check` and `inspect`.
- Status: open.

### T-140 [feature] Top-level files of a mobile app folder are missing from the book

- Source: 5.55.0 build and pilot, 2026-11-16.
- What and why: `collectFiles({ dirs })` scans folders only, so a mobile app's top-level files (`App.tsx`, `index.ts`)
  are not in the book. Add file entries or a skip list to `collectFiles`.
- Evidence: `packages/grimoire/src/warlock/adapter.ts` (mobile source folders),
  `packages/core/src/tooling/inspect/collect-files.ts`.
- Acceptance: a mobile app fixture with `App.tsx` and `index.ts` at its root lists both in the book; a spec covers the
  new file entries (or the skip list).
- Status: open.

### T-144 [feature] Third measurement arm: the book alone

- Source: 5.55.0 build and pilot, 2026-11-16.
- What and why: the PLAN asks whether the book alone helps. The 5.55.0 measurement (T-136) compares the book, the written
  features and the skill together against nothing, so it cannot separate them. Add a third arm with the book only and no
  written features, same tasks and model.
- Evidence: T-136; `findings/6.0/PLAN-GRIMOIRE.md`.
- Acceptance: the measurement reports three arms (nothing, book only, book with features and skill) on the same ten
  tasks, with the numbers recorded as measured in the release summary.
- Status: open.

## Tasks

Ordered by value: security first, then performance, then features and bugs. Line numbers are as of 5.53.0; entries
T-100 and later are checked against 5.53.1.

### T-007 [decision] Coding-CLI adapters inherit the whole host environment by default

- Source: security and performance audit of 2026-11-11.
- What and why: a coding-CLI agent (`@warlock.js/ai-cli`) starts the external CLI with every variable of the host
  process (`inheritEnv: true`), so database URLs, cloud keys and other app secrets reach a tool driven by model
  output. 5.53.0 added `inheritEnv: "curated"` (a minimal system set plus the adapter's own `apiKeyEnv`) and a
  one-time production warning when `inheritEnv` is unset, but kept the default.
- Evidence: `packages/ai-cli/src/cli-agent.ts:123`, `:262-266`; `packages/ai-cli/src/session/environment.ts:41-75`,
  `:124-152`; `packages/ai-cli/src/contracts/options.type.ts:51-65`.
- Options: (a) flip the default to `"curated"` in the next minor with an upgrade note (apps that rely on extra
  variables must list them in `inheritEnv: [...]` or `env`); (b) flip it in the next major; (c) keep `true` and the
  warning.
- Recommendation: (b), after T-013 lets adapters declare the extra variables they need (base URLs, provider keys),
  so the curated set works for every built-in adapter without app changes.
- Acceptance: the chosen default ships with docs, skill, changelog and an upgrade note; a spec runs a fake CLI under
  the default and shows an unrelated secret absent and the adapter's credential present.
- Status: open. 5.54.0 ships T-013 (adapters declare the variables they need), the warning text and the docs. The default stays `inheritEnv: true` in 5.54; the flip to `"curated"` is planned for 6.0.
- Owner decision (2026-11-16): keep `inheritEnv: true` as the default in 5.54 (the warning stays); the flip to `"curated"` is planned for 6.0.

### T-009 [decision] Next-major default flips

- Source: security and performance audit of 2026-11-11.
- What and why: 5.53.0 shipped these as opt-ins or warnings to stay compatible. Each is safer as a default.
  1. `auth.passkeys.userVerification`: `"preferred"` → `"required"` (`packages/auth/src/services/auth-config.ts:374-375`).
  2. `loginThrottleMiddleware` `emailLock`: `"global"` → `"pair"`, so one IP cannot lock a victim's account from
     everywhere (`packages/auth/src/middleware/login-throttle.middleware.ts:87`, `:317`).
  3. `http.multipart.routes`: `"all"` → `"declared"`, so multipart bodies are parsed only on routes that take files
     (`packages/core/src/http/multipart.ts:42-51`). Needs T-012 first: web page actions cannot declare uploads yet.
  4. `ai.serve` refuses to start without `authToken`/`authorize` unless `public: true` (today a production warning,
     `packages/ai/src/serve/serve.ts:189`, `:400`).
  5. A boot error for JWT secrets under 32 bytes (today a production warning,
     `packages/auth/src/services/auth-config.ts:56-60`, `:198`, `:411`).
  6. JSON file logs default to `format: "jsonl"` (append-only, no read-modify-write;
     `packages/logger/src/channels/json-file-log.ts:85`).
     Other permissive defaults that could be reviewed at the same time: `attachmentPolicy.allowBareLocalPaths`
     (`packages/ai/src/utils/prepare-attachment-part.ts:268-284`) and `web.tlsAskAllow: "any"`
     (`packages/web/src/configurations.ts:108`).
- Options: per item, flip in the next major / keep the current default.
- Recommendation: flip all six in the next major (item 3 only once T-012 has shipped), each with an upgrade note
  naming the setting that restores the old behaviour.
- Acceptance: each chosen flip ships with specs for the new default, docs, skills, changelog and upgrade notes; the
  scaffold no longer sets values that now equal the default.
- Added 2026-11-19 (5.60.0): type `useCurrentUser<T>()` as `T | undefined` (it is undefined outside a request;
  5.60.0 documents it and points at `currentUser()` from `@warlock.js/auth`).
- Status: open (next major). 5.54.0 ships the warnings and docs that name the 6.0 change for all six items, and the scaffold sets the safe values explicitly (multipart `routes: "declared"`, `emailLock: "pair"`, a 32-byte JWT secret, `format: "jsonl"`; passkey `userVerification` is a comment because the template has no passkeys block). The default flips are planned for 6.0. The other permissive defaults named above (`attachmentPolicy.allowBareLocalPaths`, `web.tlsAskAllow`) were not changed.
- Owner decision (2026-11-16): no default flips in 5.54. Each item keeps its old default with a one-time warning that names the setting; the flips are planned for 6.0.

### T-014 [chore] Run the service-backed integration suites against the 5.53.0 changes

- Source: security and performance audit of 2026-11-11.
- What and why: 5.53.0 was verified with unit specs, fakes and the typecheck. Several changes were never run against
  a real service: auth token lookups `whereIn("token", [digest, raw])` and `OneTimeToken.purgeSpent()` query deletes
  (MongoDB, PostgreSQL); the login-throttle Redis spec; MongoDB nested-update validation under `strictMode`;
  `restore`/`upsert` with global scopes; PostgreSQL checkpoint upsert on the same turn; Redis checkpoint per-turn
  layout; RabbitMQ direct reply-to and reconnect; the template's OTP `atomic()` filters on PostgreSQL; DNS pinning
  against a real rebinding resolver.
- Evidence: `packages/auth/tests/integration/`, `packages/auth/src/middleware/login-throttle.redis.spec.ts`,
  `packages/core/src/http/rate-limit-cache-store.redis.spec.ts`, `packages/cache/src/drivers/redis-cache-driver.integration.spec.ts`,
  `packages/ai/src/checkpoint/pg.ts`, `packages/herald/src/drivers/rabbitmq/rabbitmq-channel.ts`.
- Acceptance: each suite runs green against real services (CI job or a documented local run); any failure becomes
  its own task.
- Status: open. 5.54.0 ran the MongoDB and PostgreSQL hardening suites (auth, 18 pass), the auth and core Redis specs, the cache Redis driver spec and the live cascade suites (49 pass; one regression found and fixed). Not run yet: the testcontainers suites (auth token models; cascade crud, query, relations, sync, persistence), RabbitMQ, the PostgreSQL checkpoint upsert, the Redis checkpoint layout and the rebinding resolver.

### T-033 [decision] Captured messages: text-only `content` for multipart messages

- Source: security and performance audit of 2026-11-11.
- What and why: with `captureMessages`, a multipart message stores its parts flattened to JSON in `content` and the
  original parts in `contentParts`, so attachments are stored twice and every turn re-reads them.
- Evidence: `packages/ai/src/agent/agent.ts:2759` (`captureMessages`);
  `packages/ai/src/contracts/result/execution-report.type.ts:17-24` (documented shape).
- Options: (a) `content` holds only the text parts when `contentParts` is set (documented shape change, minor with an
  upgrade note); (b) the same in the next major; (c) keep the shape.
- Recommendation: (b), unless no app reads `content` of multipart messages, then (a).
- Acceptance: the chosen shape with specs, docs and an upgrade note; session restore still rebuilds messages.
- Status: open (6.0). 5.54.0 ships no shape change; the change is planned for the next major.
- Owner decision (2026-11-16): option (b), the shape change in the next major. Not in 5.54.

### T-036 [feature] Database cache driver: one upsert per `set`, lean `get`

- Source: security and performance audit of 2026-11-11.
- What and why: `DatabaseCacheDriver.set` does a read then an insert or update, and `get` hydrates a model per read.
  A single upsert needs a unique index on `key` that the driver cannot assume today.
- Evidence: `packages/core/src/cache/database-cache-driver.ts:85`, `:128`.
- Acceptance: the cache migration ships the unique index; `set` uses one upsert with `conflictColumns: ["key"]`;
  `get` reads a raw row; specs on both database drivers.
- Status: open. 5.54.0 ships the lean row read in `get`, the opt-in `upsert: true` option (one upsert with `conflictColumns: ["key"]`) and `cacheMigration`, which creates the unique index on `key`. Still open: the default stays the read-then-write path (existing tables need the index first), the specs were not run against a real database on both drivers, and the default is not flipped.

### T-042 [feature] ORM hydration hot path

- Source: security and performance audit of 2026-11-11.
- What and why: per hydrated row the model resolves its driver twice, allocates `events` and `loadedRelations`
  eagerly, captures every string to restore undeclared date strings, and PostgreSQL sets one `WeakMap` entry per row
  for column types. Making `events`/`loadedRelations` lazy changes the model's own keys, so it needs care.
- Evidence: `packages/cascade/src/model/methods/hydration-methods.ts:14-39`; `packages/cascade/src/model/model.ts:668`,
  `:684`, `:707`; `packages/cascade/src/drivers/postgres/postgres-driver.ts:339`, `:736`, `:1846`.
- Acceptance: date keys computed once per model class; driver resolved once per result set; column types attached
  once per result; lazy `events`/`loadedRelations` only if serialisation and own-key specs stay identical; specs.
- Status: open. 5.54.0 ships date keys computed once per class, the driver resolved once per result set (`Model.hydrate(row, driver)`), and PostgreSQL column types attached once per result. Left for 6.0: lazy `events` and `loadedRelations`. Both are public enumerable own fields (`packages/cascade/src/model/model.ts:709`, `:725`), so a lazy version drops them from `Object.keys` and spread; keeping them as own keys saves nothing. `packages/cascade/src/model/model-own-keys.spec.ts` pins the current own keys, JSON and snapshot output for that change.

### T-047 [feature] Validation: synchronous rules where possible (next major)

- Source: security and performance audit of 2026-11-11.
- What and why: every rule and mutator is `async` and the public types require promises, so each field pays microtask
  hops per rule. A sync path needs `MaybePromise` types and explicit error ordering, which breaks plugins that call
  `rule.validate(...).then(...)`.
- Evidence: `packages/seal/src/types/rule-types.ts:47`; `packages/seal/src/types/mutator-types.ts:16`.
- Acceptance: rules/mutators typed `T | Promise<T>`, built-in rules sync, errors collected per index so their order
  does not depend on timing; specs; upgrade guide.
- Status: open (next major). 5.54.0 ships only the non-breaking part: rule and mutator loops skip `await` when a rule returns a non-promise, and the public types are unchanged. Left for 6.0: `MaybePromise` rule and mutator types, synchronous built-in rules, per-index error collection, and the upgrade guide.

### T-100 [bug] `warlock generate.typings` reported to hang on Windows

- Source: application upgrade report of 2026-11-12 (Windows 11, Node 24.15.0); the same report says it happened before
  and after 5.53.
- What and why: on Windows, the package scripts that run `warlock generate.typings` (the typecheck and the build) stop
  at that step. The team typechecks with `tsc --noEmit` directly and builds without the step. No further detail came
  with the report. Not confirmed from the source: the command does not reach the supervisor code fixed in 5.53.1
  (T-095). It runs `filesOrchestrator.initializeAll()`, `typeGenerator.generateAll()` and the connectors' typings
  (which fork the route-registration child and run web's `build.typings` hook). The scaffolded `recover()` call runs
  only in `Application.onValidateBoot`, which `generate.typings` never runs. Every step on the path is bounded or
  shared with paths that work on the reporting machine (`warlock build` and `warlock dev`), and a successful run ends
  through `exitAfterFlush(0)`, so a lingering handle cannot keep it open.
- Evidence: `packages/core/src/cli/commands/typings-generator.command.ts:30-52` (the action);
  `packages/core/src/production/registration-child-runner.ts:108-124,153-156` (timeout and restart on progress);
  `packages/core/src/cli/cli-commands.manager.ts:52,326` (`exitAfterFlush`);
  `packages/web/src/build/contribution.ts:382-411` (web's `typings` hook);
  `packages/web/src/build/load-web-build-config.ts:70` (`loadWebBuildConfig`);
  `packages/core/src/dev-server/type-generator.ts:51` (`listRouteLocaleKeysForTypeGeneration`);
  `packages/core/src/generations/features/process.feature.ts:27` (the scaffolded `recover()` call).
- Candidate causes, most likely first:
  1. The registration child is slow and the command prints nothing while it waits. The same app needed a 180-second
     limit for route registration (T-098), the limit now restarts on every module, so with a raised limit the total
     time is unbounded, and the child's output is shown only on failure. A run of several minutes with no output reads
     as a hang.
  2. Web's `build.typings` hook, which only `generate.typings` runs. `loadWebBuildConfig()` bundles `src/config/web.ts`
     with its app imports and imports the result in the CLI process; app code that runs at import (a database or cache
     client, a top-level await) can block it there. `warlock build` loads it too, so this ranks lower.
  3. `listRouteLocaleKeysForTypeGeneration()` imports `@warlock.js/web/build` into the CLI process. `warlock dev`
     does the same, so it is the least likely.
- How to settle it on a Windows machine, in the app:
  - Watch which files change. `generateAll` writes `.warlock/typings/*.d.ts`; web's hook writes
    `.warlock/typings/web-routes.d.ts` last. If the first group updates and the last never does, the hang is in the
    connector step. In Task Manager, a second `node.exe` child with CPU time still moving means the registration child is
    still importing (candidate 1).
  - Run `set WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS=30000` and then `npx warlock generate.typings`. A timeout error that
    names a module confirms candidate 1.
  - Run `node --inspect node_modules/@warlock.js/core/bin/warlock.js generate.typings`, attach the Chrome DevTools
    inspector, pause after a minute and read the stack. Or preload
    `--import data:text/javascript,setInterval(()=>console.error(Date.now(),process.getActiveResourcesInfo()),10000)`
    to print what the process is waiting on: a `ChildProcess` or `Pipe` points to candidate 1, a `TCPWrap` points to
    app code in candidate 2.
- Acceptance: the cause is identified on a Windows machine and either fixed with a spec (or, for candidate 1, the
  command prints progress and the child's output while it waits), or closed as an app-side import.
- Status: open (partly). 5.54.0 adds stage progress, a 15-second heartbeat, `WARLOCK_DEBUG_TYPINGS=1` with live child output, and a child-process spec. The cause is not found in source; it still needs a run on a Windows machine (the steps above).
- Owner decision: none; needs someone with a Windows machine to run the steps above.

### T-120 [bug] Windows CI: the development e2e test times out waiting for a hot update

- Source: main CI, Windows workflow, 2026-11-14 and 2026-11-16 (runs on commits with no web change also failed).
- What and why: `packages/core/tests/integration/e2e/web-development.test.ts` ("development regression: shared") fails on
  Windows about one run in four: `waitFor {"selector":"h1","text":"Revision 2"}` or `{"selector":"button","text":"Count 1"}`
  times out after 30 s, so an edit is not reflected in the browser in time. A re-run passes. Each failure emails the owner
  and makes main look red after a release.
- Evidence: Windows job logs of runs on f1af13d90 (2026-11-14), df75c43e5, ba5bf3e6a and 9c57b53a9 (2026-11-16); the
  evidence screenshots the test writes under `.warlock/e2e/web-development/shared/run-*`.
- 2026-11-20 (5.61.0 release commit fb11c741e, Windows run 44621635918): 4 of 4 attempts failed in this file: "shared"
  timed out on "Count 1" (twice) and "Revision 2", and "development regression: identifiers" failed twice with
  `expected undefined to be '_R_16_'` (an input's `dataset.hookId` read right after a click, before hydration set it).
  The identifiers failure had not been seen before. The 5.61.0 runtime diff touches no client or dev hot-update code,
  and the file passes 3 of 3 on Linux. Both failures point to slow hydration on the Windows runner. The workflow
  uploads no artifacts, so no browser console was available: upload `.warlock/e2e` on failure first.
- Acceptance: the cause is named (file-watch latency on Windows, a missed update, or the wait itself); the test passes in
  20 consecutive Windows runs, or waits on the update event instead of a fixed timeout; the identifiers checks wait for
  hydration before reading `dataset` values.
- Status: open.
