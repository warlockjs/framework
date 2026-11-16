# Open tasks

Open work for the framework repository. Finished entries move to `tasks.completed.md` (newest first).

## Owner decisions waiting

None.

## 5.55.0: Grimoire

Owner decision of 2026-11-16: Grimoire ships **complete in one release, 5.55.0**. Everything in this section is in
scope for that release. Out of scope: using the package outside Warlock.js (the standalone `grimoire` binary and the
generic book), other frameworks, and features that span several repositories.

**What it is.** `@warlock.js/grimoire` is a project map for AI agents and developers. Warlock writes a generated
**book** of what is in the code; AI agents write what the product does (**features**, **flows**), where users meet it
(**apps**), and the work (**tasks**, **releases**), all under a visible `grimoire/` folder in the app. The written
files point into the book by name, and a read-only check reports any name that no longer exists. Agents ask through
`warlock scry` and MCP tools; developers browse a devtools tab.

**Rules that apply to every task below.**

- Warlock writes only the book and collected files (`index.json`, `*.bookmap.json`); they are ignored by git and
  rebuilt when sources change. It reads the agent-written files and never edits them.
- The book is a projection of the existing inspect report (`inspectApp()` in `@warlock.js/core/tooling`): never a
  second parser.
- One package, `packages/grimoire`: the root entry must not import `@warlock.js/core` or `@warlock.js/web`; everything
  Warlock-specific lives behind the adapter contract in the `@warlock.js/grimoire/warlock` entry.
- Registered through `cli.commands` in `warlock.config.ts`; on by default in new apps.
- The agreed layout, file templates and wording rules are in the local working files on the build server (not in
  git): `findings/6.0/PLAN-GRIMOIRE.md` (plan and workstreams), `findings/6.0/GRIMOIRE-DESIGN.md` (agreed design) and
  `findings/6.0/skills/` (six draft skills whose templates are the fixed structure of the written files). Read them
  before starting.

**Order.** T-121 to T-126 first and in parallel; then T-127 to T-129; then T-130 to T-135; then T-136, one
verification pass, one review, and the release.

### T-121 [feature] Inspect report: line counts, header sentence, export comments, more file roles, controller on routes

- Source: owner request and design sessions of 2026-11-16.
- What and why: the book is built from the inspect report, which today lacks what an agent reads first. Add to each
  file: its line count, the sentence in the comment at the top of the file, and the first sentence of the comment above
  each export. Add the file roles `use-case`, `seed`, `request`, `mail`, `job`, `event` and `client`. For a route
  registered as a controller tuple, keep the controller class and action name on the route record (today the handler
  is a bound function and the class is lost). Fix the conventions skill, which says `.usecase.ts` while the generator
  writes `.use-case.ts`.
- Evidence (as of 5.54.0): `packages/core/src/tooling/inspect/collect-files.ts:33` (`fileRole`), `:87`
  (`collectFiles`); `packages/core/src/tooling/inspect/inspect-report.types.ts:300` (`InspectFile`), `:81`
  (`InspectRoute`); `packages/core/src/router/router.ts:454` (`add`), `packages/core/src/router/types.ts:480` (`Route`);
  `packages/core/skills/warlock-conventions/SKILL.md:98-113`.
- Acceptance: new fields in the report and its JSON schema (schema version bumped), specs, docs, skill, changelog;
  existing consumers of the report unchanged.
- Status: open.

### T-122 [feature] MCP server: let packages and the app register tools

- Source: owner decision of 2026-11-16 (accepted as public API).
- What and why: the tool list of `warlock mcp` is fixed, so a package cannot add its tools. Add a registration point:
  a `tools` option on the server start function and a list the `mcp` command and `warlock dev --mcp` read (from the
  Warlock config or from registered commands' packages). The first user is Grimoire (T-130).
- Evidence: `packages/core/src/tooling/mcp/mcp-tools.ts:358` (`createWarlockMcpTools`, fixed list), `:66`
  (`WarlockMcpTool`); `packages/core/src/tooling/mcp/start-mcp-server.ts:160` (`startWarlockMcpServer`, no tools
  option); `packages/core/src/cli/commands/mcp.command.ts`; `packages/core/src/dev-server/dev-agent-tooling.ts:159`.
- Acceptance: a spec registers an extra tool and calls it over the server; a tool that writes still respects
  `--allow-writes`; docs, skill, changelog.
- Status: open.

### T-123 [feature] Devtools: registered panels instead of hard-coded tabs

- Source: owner decision of 2026-11-16 (accepted as public API).
- What and why: devtools tabs, data routes and views are hard-coded, so a package cannot add one. Add a panel
  registration (a data route under the guarded scope, a tab, a view module) and move the Processes panel onto it as
  the first user. The Grimoire tab (T-134) is the second.
- Evidence: `packages/devtools/src/devtools-connector.ts:66`, `:97-107` (sources wired by hand);
  `packages/devtools/src/server/index.ts` (`mountDevtoolsRoutes`), `src/server/types.ts`; `packages/devtools/ui/index.html`
  and `ui/app.js` (`render()`); `packages/devtools/src/process-panel.ts` (the closest precedent).
- Acceptance: the Processes panel works unchanged through the new registration; a spec registers a test panel; the
  devtools guard (loopback host, origin, no proxy headers) covers registered routes; docs, skill, changelog.
- Status: open.

### T-124 [feature] Pages report: setup file, site and full layout chain

- Source: owner request and design sessions of 2026-11-16.
- What and why: the inspect report's pages have no setup file and no site, and compute the layout chain with a rule
  that differs from the web build's. Export page-graph discovery from `@warlock.js/web/build` and build the report's
  pages from it, so both agree.
- Evidence: `packages/web/src/build/discover-pages.ts:989` (`discoverPageGraph`), `:89` (`DiscoveredRoutablePage`),
  `:648` (`layoutChainFor`); `packages/web/src/build/index.ts` (not exported today);
  `packages/core/src/tooling/inspect/collect-pages.ts:54` (`layoutChainOf`), `:130`.
- Acceptance: a multi-site fixture reports each page with its setup file, site and outermost-first layout chain,
  equal to what the build uses; specs, docs, changelog.
- Status: open.

### T-125 [feature] Grimoire package: skeleton, family wiring, adapter contract

- Source: owner request and design sessions of 2026-11-16.
- What and why: create `packages/grimoire` with a framework-neutral root entry and a `warlock` subpath entry, and add
  it to the family: `pnpm-workspace.yaml`; `tools/release/pkgist.config.ts` (family entry with the subpath in
  `entries`); `tools/release/scripts/warlock-family.ts` (`WARLOCK_FAMILY_SIZE` 33 to 34) and the `FAMILY_NAMES` list
  in its spec; `tools/release/scripts/local-registry-gate.ts`; the three allowance files at 0; the docs sidebar
  (`docs/astro.config.mjs`), `docs/scripts/generate-site-llms.mjs`, `docs/src/content/docs/packages.mdx`; the Windows
  workflow matrix (the package handles paths). Define the adapter contract: files, routes, pages, and the named things
  a flow step may point at (mail, job, event, notification).
- Evidence: the last new package is the model: commit `81fae4dcb` (`@warlock.js/process`) and the files it touched.
- Acceptance: a spec fails if the root entry imports `@warlock.js/core` or `@warlock.js/web`; the release-tool specs and
  the feature-parity check pass with 34 packages; typecheck, strictness, skill-coverage and snippet gates green.
- Status: open.

### T-126 [feature] Grimoire: the written files and their parser

- Source: owner request and design sessions of 2026-11-16; the templates in the draft skills are the fixed structure.
- What and why: define and parse every agent-written file. Feature `README.md` (front matter: `id`, `title`,
  `status`, `version`, `updated`, `apps`, `folders`, optional `origin`), `CHANGELOG.md` (entries with version, word
  `added|changed|fixed|removed`, release and date once stamped), `flows/<flow>.md` (front matter `id`, `since`,
  `status`, `who`; sections Steps, Differs by app, Cases, Acceptance criteria), `versions/<v>.md` (brief); app
  `README.md` (conditions), `layouts/*.md`, `pages/<page>/README.md` (blocks table), `blocks/*.md`; task files
  (front matter `id`, `type`, `feature`, `flow`, `apps`, `status`, `shipped`); release files (front matter `release`,
  `date`, the agent's brief, then the collected list). Step kinds: `page`, `route`, `mail`, `notification`, `job`,
  `event`, `outside service`, `affects`. Criteria are `AC-n`, optionally scoped `[app-id]`. A flow is referred to as
  `<feature>/<flow>`.
- Acceptance: a published structure page in the docs; every malformed case gives a located message with a stable
  code; golden-file specs over a fixture project.
- Depends on: T-125.
- Status: open.

### T-127 [feature] Grimoire book: builder, freshness, per-file mirror

- Source: owner request and design sessions of 2026-11-16.
- What and why: write `grimoire/book/` from the adapter's facts: one JSON entry per source file at the same path as
  the source (`src/app/auth/controllers/login.controller.ts` → `grimoire/book/app/auth/controllers/login.controller.json`)
  with type, lines, about, feature, flows, exports, packages, imports, imported-by and routes; an `index.md` summary
  per module; `book/app/routes.json` (per module, method and path); a page list per site. Keep a fingerprint of source
  hashes; rebuild only changed entries; cache route facts and refresh them only when a routes file or something it
  imports changes (route registration loads the app). Every command checks the book exists and is fresh first.
- Acceptance: golden files on the fixture; a no-change run does no work; file-only questions never boot the app;
  paths compared with both separators (Windows job).
- Depends on: T-121, T-124, T-125.
- Status: open.

### T-128 [feature] Grimoire: ownership, book maps and collected indexes

- Source: owner request and design sessions of 2026-11-16.
- What and why: work out which files a feature owns (its `folders`, plus a `@feature` tag in a file header for a file
  that lives elsewhere; one owner per file) and which it borrows (imports from another feature). Write
  `features/<feature>/bookmap.json` (own, borrowed, routes, pages per app, files no flow reaches),
  `flows/<flow>.bookmap.json` (files behind each step, tests per criterion, blocks that show the flow),
  `features/index.json` (id, version, updated, status, apps) and `tasks/index.json` (open, done, waiting for the
  owner). Dates come from changelog entries.
- Acceptance: golden files on the fixture; a file with two owners or none is reported; indexes rebuilt incrementally.
- Depends on: T-126, T-127.
- Status: open.

### T-129 [feature] Grimoire check: the read-only report

- Source: owner request and design sessions of 2026-11-16.
- What and why: `warlock grimoire check` reads everything and edits nothing. It reports, each with a stable code that
  `warlock explain` describes: a step naming a route, page, mail, job, event or notification that does not exist; a
  flow or feature naming an app with no folder; a block pointing to a missing flow; a condition not declared in the
  app; a criterion with no test and a test pointing at a missing criterion (tests are tied by a comment line
  `// @proves <feature>/<flow> AC-n`); a file with no header sentence or no feature; a file inside a feature's folders
  that no flow reaches; a README `updated` older than its newest changelog entry; a structure error from T-126.
  Findings for a feature or flow whose status is `proposed` are shown as expected, not as problems.
- Acceptance: one spec per rule, failing and passing; exit code 1 only on problems; `--json`; docs page listing every
  code.
- Depends on: T-126, T-127, T-128.
- Status: open.

### T-130 [feature] Grimoire commands, Warlock adapter and MCP tools

- Source: owner request and design sessions of 2026-11-16.
- What and why: the Warlock adapter (facts from `inspectApp()`; named mails, jobs, events and notifications from
  their registries or folders) and `registerGrimoireCommands()` for `warlock.config.ts`. Commands:
  `warlock grimoire build`, `warlock grimoire check`, `warlock grimoire release <version>`, and `warlock scry` with
  `<file>`, `--impact <file>`, `--route "<METHOD path>"`, `--feature <id>`, `--flow <feature>/<flow>` and
  `--search "<text>"` (fuzzy over paths, export names, header sentences, routes, flows, blocks, tasks). Output is
  compact text by default and `--json` on request. The same questions as MCP tools (uses T-122).
- Acceptance: specs per command on the fixture; `--impact` lists routes, pages, flows and features including
  borrowers; commands that need only files do not boot the app; docs, skill, changelog.
- Depends on: T-122, T-127, T-128, T-129.
- Status: open.

### T-131 [feature] Grimoire tasks and releases

- Source: owner request and design sessions of 2026-11-16.
- What and why: `grimoire/tasks/open/` and `grimoire/tasks/done/<yyyy-mm>/`, one file per task, and
  `grimoire/releases/<version>.md`. `warlock grimoire release <version>` collects the unreleased changelog entries of
  every feature into the release file under the agent's brief (committed, since it is history). Document how an app
  that keeps a single tasks file moves to the folder.
- Acceptance: specs for collection and for re-running a release (no duplicates); the command never edits a feature
  changelog (the agent writes the release and date there, see T-137).
- Depends on: T-126, T-130.
- Status: open.

### T-132 [feature] Grimoire apps: sites, mobile apps, pages and blocks

- Source: owner request and design sessions of 2026-11-16.
- What and why: `grimoire/apps/<app>/` for each site and each mobile app in the repository: the app's named
  conditions (guest, roles, membership, preferences), layouts written once, pages with a blocks table (flow, who sees
  it, changes with), block files only for page-specific detail. A feature lists the apps it touches; a flow may have
  a "Differs by app" section. The book lists how a page is reached and what it requires. For a mobile app in the same
  repository the book mirrors its folder (file facts) and lists screens from file-based routing; otherwise screens are
  declared (see T-137).
- Acceptance: fixture with two sites and a mobile folder; every app rule of T-129 has a spec.
- Depends on: T-126, T-127.
- Status: open.

### T-133 [feature] Grimoire: test results per criterion

- Source: owner request of 2026-11-16 (the whole package in one release).
- What and why: knowing a test exists is not knowing it passes. Add a test reporter that records, per
  `// @proves` line, the last result, and show pass, fail or not run per criterion in `scry --flow`, the flow book
  map and the devtools tab.
- Evidence: the framework's test command and its Vitest setup (`packages/core/src/tests`).
- Acceptance: a failing proven test shows its criterion as failing; results older than the test file are shown as
  stale; specs, docs.
- Depends on: T-128, T-130.
- Status: open.

### T-134 [feature] Devtools: the Grimoire tab

- Source: owner request and design sessions of 2026-11-16.
- What and why: a tab registered through T-123. One search box across flows, blocks, routes, files and tasks; views
  for a book entry, a feature, a flow (steps, criteria with results, where it is shown, book map, history), an app
  page (blocks), tasks, releases and the check report. Small graphs only: a file's neighbours, a feature and its
  neighbours, a page and its blocks, module coupling. A static export for people without the app running.
- Acceptance: UI specs in the devtools style; works with no features written (book only); the devtools guard applies.
- Depends on: T-123, T-128, T-129.
- Status: open.

### T-135 [feature] Scaffold, skills and docs for Grimoire

- Source: owner decision of 2026-11-16 (on by default in new apps).
- What and why: `warlock add grimoire` (core feature map and create-warlock feature list, kept in parity), a helper
  that inserts a command into `cli.commands` of an existing `warlock.config.ts`, the registration in the template
  config, ignore rules for the generated files, a line in the template's agent guide, and the six skills in
  `packages/grimoire/skills` (`use-the-grimoire`, `document-a-file`, `write-a-feature`, `record-a-change`,
  `describe-an-app`, `backfill-a-grimoire`). A docs section for the package. Reword the scaffolder's spinner text that
  already says "Initializing grimoire (git)".
- Evidence: `packages/core/src/generations/features/index.ts:50` (`featuresMap`),
  `packages/core/src/generations/features/shared/insert-connector-entry.ts:34` (the only config-editing helper),
  `packages/create-warlock/src/features/features-map.ts`, `packages/create-warlock/templates/warlock/warlock.config.ts`,
  `packages/create-warlock/src/ui/spinners.ts:13-14`, `tools/release/scripts/check-feature-parity.ts`.
- Acceptance: a fresh scaffold builds a book and passes `warlock grimoire check` with no written files; the scaffold
  workflow's variants stay green; skill-coverage and snippet gates green.
- Depends on: T-125, T-130.
- Status: open.

### T-136 [chore] Pilot and measurement before publishing 5.55.0

- Source: owner decision of 2026-11-16 (pilot on the owner's chosen application).
- What and why: install the packed 5.55.0 into a copy of the pilot application, build its book, backfill its
  features with the `backfill-a-grimoire` skill (features marked inferred), and fix what the pilot shows in the
  package and the skills. Then run ten real tasks twice with the same model, with and without Grimoire, recording
  tokens in and out, tool calls, wall time, tests passing and reviewer findings.
- Acceptance: the pilot's `warlock grimoire check` is clean or its remaining findings are real; the measured numbers
  are in the release summary as measured, whatever they are.
- Depends on: T-121 to T-135.
- Status: open.

### T-137 [decision] Grimoire: label, changelog stamping, mobile screens (decided)

- Source: design sessions of 2026-11-16; decided by the owner the same day.
- Decisions:
  1. **Label:** Grimoire is **experimental** in 5.55.0 (docs, changelog, release notes and the package README say so),
     so the written-file structure can still change after the pilot. Stable in 6.0.
  2. **Release number and date in feature changelogs:** written by the **agent**. Warlock never edits an
     agent-written file; `warlock grimoire release` only writes the collected list in the release file, and
     `warlock grimoire check` reports a changelog entry that a release lists without a matching release and date.
  3. **Mobile screens when navigation is defined in code:** **declared by the agent** in the app's folder. Screens
     are listed from the file structure only when the mobile app uses file-based routing.
- Applies to: T-125 and T-135 (label), T-129 and T-131 (changelog), T-132 (screens).
- Status: decided 2026-11-16. Moves to the completed file with 5.55.0.

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
- Acceptance: the cause is named (file-watch latency on Windows, a missed update, or the wait itself); the test passes in
  20 consecutive Windows runs, or waits on the update event instead of a fixed timeout.
- Status: open.
