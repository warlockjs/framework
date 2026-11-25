# Open tasks

Open work for the framework repository. Finished entries move to `tasks.completed.md` (newest first).

## Owner decisions waiting

- Next release scope: T-215..T-230 (findings check 2026-11-26; T-230 decided, five features to build).
- Next-major items (T-007, T-009, T-033, and the 6.0 halves of T-042 and T-047) wait for 6.0.
- Parked until an app asks: T-171, T-196, the streaming half of T-183. Windows-only items (T-100, T-180, T-120) need a
  Windows machine or Windows CI runs.

## Next release

- 5.64.0 shipped T-207, T-208, T-201 (API routes), T-209, T-210, T-182, T-181, T-168, T-172, T-147, T-138, T-139,
  T-140 and T-036 (see `tasks.completed.md`); T-144 was measured after the release. T-206's re-run did not
  meet its acceptance (see the entry).
- 5.63.1 shipped T-204 (PostgreSQL `date` columns). 5.63.0 shipped T-188..T-195, T-197 (closed), T-198..T-200, T-202, T-203 (closed).
- 5.62.0 shipped T-185, T-186 and T-187 (see `tasks.completed.md`).
- 5.61.0 shipped T-142, T-143, T-146, T-149, T-151, T-169 and T-178 (see `tasks.completed.md`).

## From the 2026-11-26 findings check (5.64.0)

Source for every entry below: two app findings pages (Forma AI "Grimoire Panel Boot Stall", Mentor Me v2 findings),
verified against 5.64.0 (`abaf604b4`) on 2026-11-26. Verdicts, repro outputs and line numbers:
https://claude.ai/artifact/8qWT2nzB4UNkZGM2TGuRCH (private). Every fix ships a regression spec built from the repro below.

### T-215 [bug] Grimoire devtools panel rebuilds the book on the main thread at boot

- What: `packages/grimoire/src/devtools/index.ts:135` calls `source.warm()` at panel creation in production, and in
  development whenever no custom adapter is set. `warm()` → `openGrimoire` → `buildBook` → core `collectFiles`
  (sync `readdirSync` + `parseSync`). The panel never uses `openStoredGrimoire` (`workspace/stored.ts:32`) and has no
  `warm` option. Forma measured ~6 s with no responses after every restart (11.6k files).
- Repro: create `grimoireDevtoolsPanel({ root, mode: "production" })` over a generated project and sample a 50 ms
  interval: 3k files → longest gap 818 ms, 9k files → 2,406 ms (development: 881 / 2,458 ms); with a current stored
  book 68 ms.
- Acceptance: panel creation never blocks the event loop for more than ~50 ms (spec over a generated fixture);
  production builds lazily on the first tab view (or `warm: false`), any warm is deferred past boot, and rebuilds run
  off the main thread or yield. Profile Forma's stored-book case (3.8–5.9 s reported) on a real book.
- Status: open.

### T-216 [bug] create-warlock: pnpm 11+ scaffold with `queue` fails on `msgpackr-extract`

- What: `packages/create-warlock/src/helpers/pnpm-build-approvals.ts:99-101` approves only `image → sharp`; bullmq's
  `msgpackr-extract` has an install script, so `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS` and no feature is
  installed.
- Repro: package with `bullmq` + `allowBuilds: { esbuild: true }`, `pnpm install` on pnpm 12.15.0 → exit 1
  "Ignored build scripts: msgpackr-extract@3.0.7"; adding `msgpackr-extract: true` installs.
- Acceptance: `queue: ["msgpackr-extract"]` in both the pnpm 11+ `allowBuilds` and pnpm 10 layouts; a spec that every
  feature's native build deps are approved.
- Status: open.

### T-217 [bug] create-warlock: shadcn templates fail the scaffold's own `logical-css` rule

- What: `runCodeRules(…, ["logical-css"])` over the templates finds 9 GR3007 hits:
  `templates/design-system/src/web/components/ui/calendar.tsx:74,96,98`, `command.tsx:145`, `dialog.tsx:56,65,80`,
  `radio-group.tsx:38`.
- Acceptance: convert to logical classes (`ms-auto`, `pe-1 ps-2`, `rounded-s-md`/`rounded-e-md`, `end-4`,
  `sm:text-start`); the two centering lines (`dialog.tsx:56`, `radio-group.tsx:38`) get `grimoire-allow logical-css`;
  a create-warlock spec runs the rule over all templates and expects zero findings.
- Status: open.

### T-218 [feature] auth: tell a wrong password from an account `canAuthenticate` refuses

- What: `attemptLogin()` returns `null` for both (`packages/auth/src/services/auth.service.ts:780-824`, refusal at
  :809-813); apps that must reveal a suspension only after a correct password re-implement the login.
- Repro: suspended user, `canAuthenticate: u => u.get("status") === "active"` → `{ right: null, wrong: null }`.
- Acceptance: a public `verifyCredentials()` with a discriminated result (`ok` / `invalid` / `refused`), keeping the
  equal-timing dummy hash; docs + auth skill.
- Status: open.

### T-219 [bug] web: chunk-cycle members can get the same output file

- What: `packages/web/src/vite/finalize-chunk-names.ts:278-302` hashes cycle members from canonical code only and
  never checks for a taken name; the writer (:318-328) overwrites. Mentor Me's two theme entries shared one file, so
  one theme hydrated with the other's code.
- Repro: four chunks in one cycle (`x-A`→`p`, `x-B`→`q`, `p`↔`q`, equal `x` code) → 4 chunks in, 3 files out.
- Acceptance: member identity in the hash (`${cycleDigest}:${oldBase}:${code}`) and a writer assertion that no two
  chunks share a target; the repro as a spec.
- Status: open.

### T-220 [bug] auth: `AccessToken.deleteAllForUser()` ignores `user_type`

- What: `packages/auth/src/models/access-token/access-token.model.ts:146-148` deletes by `user_id` only. Reached by
  `revokeAllTokens`, `logout()` without a refresh token (default `revoke-all`), password reset
  (`services/password-reset.ts:135`) and `Auth.removeAllAccessTokens()`; signs out another identity with the same id.
- Repro: access tokens for `{ id, student }` and `{ id, staff }`; `deleteAllForUser({ id, userType: "student" })`
  leaves `[]` (staff row deleted).
- Acceptance: filter by `user_type`; spec asserts the staff row remains.
- Status: open.

### T-221 [bug] cascade: unique violations name only the first column, with quotes, no constraint, no cause

- What: `packages/cascade/src/writer/database-writer.ts:~656-700` (`mapUniqueViolation`) keeps `.split(",")[0]` of
  `Key (...)`, quotes included, and drops `err.constraint` and the driver error.
- Repro: composite unique index `("tenantId","receiptFileId")`, same row twice →
  `[{"type":"unique","error":"The \"tenantId\" must be unique","input":"\"tenantId\""}]`, `cause` undefined.
- Acceptance: all columns unquoted, the constraint name and `cause` on the error (PostgreSQL and MongoDB
  `keyPattern`); docs.
- Status: open.

### T-222 [bug] queue: `jobId` with `:` fails only on BullMQ; docs show `invoice:43`

- What: `packages/queue/src/job-options.ts:56` passes `jobId` through; BullMQ rejects `:` (unless exactly three
  parts) and integer-like ids, fake/local accept them. Example at `packages/queue/README.md:89` and
  `skills/define-jobs/SKILL.md:36`.
- Repro (bullmq 6.3.6): `invoice:43` → "Custom Id cannot contain :", `43` → "Custom Id cannot be integers",
  `invoice-43` OK.
- Acceptance: one validation in `job-options.ts` for every driver with a clear error; docs and skill use
  `invoice-43`.
- Status: open.

### T-223 [bug] web: build accepts route locales that boot refuses; `warlock start` keeps running after a failed boot

- What: build-side `parseRouteLocaleFile` calls omit `localeCodes` (`packages/web/src/build/translation-manifest.ts:94`,
  `serialize-route-locales.ts:33`, `list-route-locale-keys.ts:21`), so WL1007 ("cannot mix locale codes with nested
  entries", `packages/core/src/localization/parse-locale-dictionary.ts:~237`) fires only at boot. The boot rejection is
  not fatal for persistent commands (`packages/core/src/cli/cli-commands.manager.ts:727`), so the process serves nothing.
- Repro: `parseRouteLocaleFile` on `{"legal":{"languages":{"ar":{"en":"Arabic","ar":"…"},"en":{…}}}}` passes without
  `localeCodes`, throws WL1007 with `["en","ar"]`.
- Acceptance: `warlock build` fails on such a file (pass `app.localeCodes`); a failed connector boot under `start`
  exits non-zero.
- Status: open.

### T-224 [bug] create-warlock: `pnpm format <file>` formats all of `./src`

- What: `packages/create-warlock/templates/warlock/package.json:23` and `src/helpers/app.ts:242` hard-code
  `--write ./src`, so an extra path formats everything (agents overwrite each other's work).
- Repro: `oxfmt --write ./src src/target.ts` → "Finished … on 2 files", `other.ts` rewritten.
- Acceptance: a single-file format script (or `format` defaulting to `./src` only without arguments), named in the
  scaffold's AGENTS.md.
- Status: open.

### T-225 [bug] cascade: `query().limit(n).update()` ignores the limit

- What: `packages/cascade/src/drivers/postgres/postgres-query-builder.ts:1462-1491` never reads limit/order;
  MongoDB `mongodb-query-builder.ts:2483-2489` uses `updateMany` (same result).
- Repro: 3 matching rows, `limit(1).update(...)` → 3 rows changed.
- Acceptance: honour the limit (ctid subquery as in `deleteOne()`, :1449) or throw a clear error on both drivers;
  spec on PostgreSQL.
- Status: open.

### T-226 [bug] auth: model `accessTokenPayload()` is never called; custom claims lost on refresh and renewal

- What: `issueAccessToken` (`packages/auth/src/services/auth.service.ts:174-186`) uses the service's
  `buildAccessTokenPayload`, never the model override (`models/auth.model.ts:30`), although
  `docs/src/content/docs/v/latest/auth/guides/customize-user-type.md:147-165` documents the override.
  `refreshTokens` and `renewAutomaticSession` drop `deviceInfo.payload` (middleware renewal at
  `services/resolve-request-user.ts:112` passes none).
- Repro: override adding `tenantId: 7` → token has none; login with `payload: { tenantId: 9 }` → refreshed and renewed
  tokens have none.
- Acceptance: issue paths call `user.accessTokenPayload()` (forced `id`/`userType`/`jti` kept), so refresh and renewal
  recompute claims; specs for both.
- Status: open.

### T-227 [bug] core: `useHashedPassword()` re-hashes an existing hash

- What: `packages/core/src/database/utils.ts:14-20` hashes every new/changed value; seeding a known bcrypt hash makes
  the account unusable.
- Repro: transformer on a bcrypt hash with `isNew: true` → stored value no longer verifies the original password.
- Acceptance: explicit opt-in (e.g. `useHashedPassword({ keepHashes: true })`) using the hash patterns in
  `core/src/encryption/password.ts`; docs.
- Status: open.

### T-228 [bug] core: migrations under nested `models` folders are silently skipped

- What: `packages/core/src/database/migrate-action.ts:313-318` globs `*/models/*/migrations/*`, so
  `src/app/ai/capabilities/models/x/migrations/*` never runs; nothing warns.
- Repro: fast-glob with the pattern finds only `ai/models/x/...`; `**/models/*/migrations/*` finds both.
- Acceptance: discover nested folders (keep `*/migrations/*`), and a check/doctor finding for a `*.migration.ts`
  outside the patterns.
- Status: open.

### T-229 [chore] Docs and skills that contradict the code

- What, from the findings check:
  - `packages/create-warlock/templates/warlock/src/web/root.tsx:8` and `packages/web/skills/measure-web-vitals/SKILL.md:28-29`
    say the root is not hydrated; it is (`packages/web/src/entry/index.ts:85`, `documentRoot: true`).
  - `packages/cascade/skills/manage-transactions/SKILL.md:236-238`: an un-awaited async call started inside
    `transaction()` shares the transaction client (repro: it saw the uncommitted row); recommend `afterCommit()`.
  - Test runtime: app `main.ts` files load only on the first request-helper call
    (`packages/core/src/tests/worker-test-server.ts:53-66`); say so in `test-http`/testing docs, or load eagerly in
    `setupTest()`.
  - Dotted query keys become nested objects (`packages/core/src/http/request.ts:1105`); undocumented.
  - The scaffold AGENTS.md names `src/web/dev/components.page.tsx`, which multi-site mode refuses
    (`packages/web/src/build/discover-pages.ts:946-952`); add the multi-site path.
  - Only first-level module `main.ts` files load (`dev-server/special-file-patterns.ts:16-17`); document it.
- Acceptance: each text corrected (or the eager test load implemented with a spec).
- Status: open.

### T-230 [feature] Capability requests from the Mentor Me findings (decided 2026-11-26)

- Source: Mentor Me v2 findings page, verified 2026-11-26 (see the section header). Owner decision 2026-11-26: build
  the five items with a verified need in the next release; park the two that already have a working route (T-171).
- Build (each with spec, docs page, skill update and CHANGELOG entry):
  1. `http.errorResponse` context gets `request` and the thrown error (`packages/core/src/http/error-response.ts:15-20`;
     the `onSend` hook at :34-42 already has the request). Need: the app stitched `errorMapper`, `Response.on("error")`
     and a middleware together to capture 5xx with route, user and the client's reference id.
  2. Route option `rawBody: true` exposing `request.rawBody` (string/Buffer) for webhook signatures, in dev
     (`router/router.ts:1452-1459` wildcard path) and production. Need: HMAC checks; the app hand-wrote a `preParsing`
     hook.
  3. Navigation blocker: `routerEvents.onBeforeNavigate(listener)` whose listener may return `false` (or a promise of
     it) to cancel, applied to `<Link>`, `navigateTo()` and popstate (restore the URL), plus a `useBlocker(when)` hook
     (`packages/web/src/routing/router-events.ts:131-137`, `client/navigation/verbs.ts:45-50`,
     `client/navigation/navigation-root.tsx:~286-321`). Need: unsaved-changes guards; Back/Forward cannot be guarded today.
  4. `canAuthenticate(user, context)` with the request (and login method) where available
     (`packages/auth/src/services/auth.service.ts:164`, `assertCanAuthenticate` in `completeLogin` :870). Need:
     tenant-membership checks before tokens are issued.
  5. Per-site `locales` and `defaultLocale` in `web.sites.<key>.localeRouting` (validated as a subset of
     `app.localeCodes`), honoured by locale resolution, `changeLocaleCode`, `?locale=`/cookie switching and the
     route-locale build (`packages/web/src/sites/site-config.types.ts:31`, `routing/locale-routing.ts:~24-32`).
     Need: an Arabic-only site still switches to English via `?locale=en`.
- Parked (moved to T-171): per-site/theme font preload by family name (manual route: `metadata.links` +
  `fontPreload: false`); passkey `origin`/`rpID` as functions of the request (a config getter works, read per call in
  `packages/auth/src/auth-config.ts:390-410`).
- Status: open, decided.

## From the 5.64.0 release

### T-211 [feature] Serve web pages from the per-worker test server

- Source: 5.64.0 scaffold check (T-201), 2026-11-23.
- What and why: the per-worker test server (`packages/core/src/tests/worker-test-server.ts` →
  `createTestHttpServer({ loadAppModules: true })`) never calls `registerConfiguredConnectors()`, so the web connector is
  not started and every page answers 404 there (`start-http-development-server.ts:242-248` is the shared server's
  path, which does). 5.64.0 therefore keeps `src/test-global-setup.ts` for apps with `@warlock.js/web`
  (`generations/features/test.feature.ts`), and in those apps API tests still read worker 1's database.
- Evidence: on a fresh web scaffold without a global setup, `src/app/shared/tests/infrastructure.test.ts:20` gets
  `{"error":{"code":"notFound",...}}` for `GET /`; with the global setup it passes (2 of 2).
- 2026-11-26 findings check (Mentor Me F-4): the generated config still sets `maxWorkers: recommendedTestWorkers()`
  next to the global setup, so with `WARLOCK_TEST_DATABASES=2` 12 of 44 API tests failed. Interim guard: `maxWorkers: 1`
  (or a throwing setup) while the global setup exists.
- Acceptance: the worker server can start the web connector (one Vite per worker, or a shared Vite with per-worker
  HTTP), the starter's page test passes with two workers and no global setup, and the web scaffold drops the file.
- Status: open.

### T-212 [bug] MongoDB relations integration suite: inferred foreign keys load nothing

- Source: 5.64.0 live run (T-014), 2026-11-23.
- What: `packages/cascade/tests/integration/mongodb/relations.test.ts` fails 7 of 20 tests on a real MongoDB 7
  (single-node replica set, `LOCAL_MONGO_URI`): `hasOne` "loads a single child by the inferred foreign key"
  (`expected null to be an instance of RelProfile`), `hasMany` (`expected [] to have a length of 2`), the inferred
  pivot, nested loading and `with()`. The same 7 fail on the 5.63.1 code (72debdc0a) with a fresh database, so it is not
  a 5.64.0 regression; the suite never ran on this server before (testcontainers, T-181).
- Acceptance: find whether the suite or the relation loader is wrong (compare the stored foreign key type with the
  parent id), fix it with the suite green on a live MongoDB.
- Status: open.

### T-213 [bug] `warlock e2e` on a fresh scaffold: env, cache driver and the components page

- Source: 5.64.0 scaffold check, 2026-11-23 (`findings/5.64/reports/scaffold-live.md`, git-ignored).
- What:
  - The e2e copy of the app gets no `.env`, so the starter dies with "no PostgreSQL user name specified"; then
    `src/config/cache.ts:44` (`env("CACHE_DRIVER") || "redis"` in production) stops it with `CacheConfigurationError`.
    The check passed only after adding `app.env` with the database and cache variables to both e2e files.
  - Chrome needs `--no-sandbox` when the server runs as root (the harness reads `WARLOCK_E2E_BROWSER`).
  - The design-system flows name `/dev/components` as their page, but that page answers 404 outside development and
    the scenes drive `/`: the components page is never captured.
  - Fresh-scaffold check warnings worth a template pass: `GR3001` x83 and `GR3002` x49 (mostly `src/app/auth`),
    `GR4001` x8, `GR3006` x2 (`src/web/dev/components.*`); the contact form UI lives in `src/web/home/components/`,
    outside the contact feature's `folders:`, so a contact task gets `GR7006` for editing it.
- 2026-11-26 findings check (Mentor Me U-3): the fixture's `env` option already overrides `NODE_ENV`
  (`packages/core/src/e2e/fixture.ts:218-221`); the scaffold's e2e files and design-system scenes just don't use it.
- Acceptance: `warlock e2e` runs the starter's scenes on a fresh scaffold with the documented env only; the
  design-system scenes capture the components page; a fresh scaffold's check has no template warnings.
- Status: open.

### T-214 [chore] Flaky spec under load: covered-click deadline in `core/src/e2e/page.spec.ts`

- Source: 5.64.0 verify, 2026-11-23.
- What: "keeps the covered reason when a later probe runs out of the deadline" fails with `expected 1 to be greater than
  1` in two of four full core runs on a loaded server (100 ms deadline, only one probe fits); it passes 3 of 3 alone.
- Acceptance: the spec controls time (fake clock or a probe counter that does not depend on wall time); 10 full runs
  green.
- Status: open.

## From the 2026-11-22 app findings page (5.62.0)

Source for T-198..T-203: an app findings page, https://claude.ai/artifact/FJ9uNFjxfnijeXb6fYo97J (app on 5.62.0 with
PostgreSQL 18.7), 2026-11-22. F1-F3 re-read on `main` at `aaf458c9c`; the reporter ran their repros on 5.62.0.

### T-206 [decision] scry: put "changes together" files in `--search` output and make agents use it

- Source: T-205 agent test, 2026-11-22 (`findings/agent-test/REPORT.md`, git-ignored). Owner go-ahead needed.
- Evidence: with scry, Sonnet used fewer grep calls (5.5 -> 4.5) and file reads (4 -> 1), cost $0.178 -> $0.119 and
  precision 0.29 -> 0.40, but recall barely moved (0.44 -> 0.50, CI spans zero): agents stop at the top hits and never
  ran `--impact` (0 of 18 scry calls). Haiku called scry in 3 of 10 runs (ignored the `CLAUDE.md` note). Time was equal,
  so a warm daemon or vector search would not help.
- Proposal (grimoire, minor):
  - `--search` lists the files that change with the top hits (from the impact graph).
  - It prints a "weak match, use grep" note when the top score is low.
  - It ranks spec, locale and type files below code.
  - The skill and the generated agent guidance open with "`scry --search` first, then `--impact` on the top hit".
  - Re-run the T-205 test (about $8, 1 hour), adding an arm with the Grimoire MCP tools in place of the CLI.
- Acceptance: re-run shows recall up with no loss in precision or cost.
- Status: 5.64.0 shipped the proposal (`changes with the top hits:` block, `next:` impact line, weak-match note, spec/locale/type files ranked x0.6, agent guidance in the skill, scaffold `AGENTS.md` and MCP descriptions). Acceptance re-run on 5.64.0, 2026-11-23 (`findings/5.64/reports/M-measure.md`, git-ignored; Sonnet 10 tasks x 4
  arms x 2, Haiku x 1, $13.80): NOT met. CLI arm recall 0.455 vs 0.444 without (+0.011, CI -0.083 to +0.112),
  precision 0.304, median cost $0.158 (bars: 0.50, 0.40, $0.119). Agents searched first (18 of 20 runs) but 0 of 60
  Sonnet runs in the guidance arms called `--impact`. The MCP arm did best: recall +0.093 vs without (CI -0.0001 to
  +0.19), 2.7 fewer tool calls and +0.073 precision vs CLI. About 7 of 20 runs per arm listed a correct file that
  came from a `changes with` list.
- Next (coordinator recommendation): `--search` folds the top hit's impact list into its own answer (guidance alone
  never produced an impact call), and the agent guidance prefers the MCP tools where a client supports them; re-run
  the same harness (`findings/agent-test-564/`) after the change.

## From the 2026-11-21 scry field report

Source for T-189..T-194: an app's `warlock scry` benchmark and release QA on 5.62.0 (9,882 files, 277 routes, three
sites plus a mobile app; 56 fixed-wording queries), 2026-11-21. Single-finding pages:
https://claude.ai/artifact/UvoeeFqtvJFbMGcPuPcDRm (`--search` needs every word) and
https://claude.ai/artifact/SC6Mxrw5sNn465fWr2snCf (page URLs in `--route`). Every cited line was re-read on `main` at
`9998a5e30` (grimoire 5.62.0); the repros were run by the reporter, not in this repository.

### T-196 [feature] `scry --search` cannot find on-screen text (index locale text under the files that use it)

- Source: second held-out scry eval on the same app, 2026-11-21 (owner asked for more query kinds before building).
- What and why: an agent fixing a UI bug often has only the text on screen ("No watch workouts yet"). The app keeps
  every user-facing string in locale files and the code names only a key, and the book indexes no file contents. On
  80 seeded locale values: today 1/80 at hit@20, BM25F 19/80, BM25F plus source string literals 26/80 (adds about
  0.6 MB of text and 60 ms to the index build). Indexing each locale value under the files that name its key reached
  75/80, but that number is circular (the ground truth came from the same key-to-file link), so it is an upper bound.
- Fix idea: at build time read the translation files (every language, so Arabic text works) through the framework's
  localization, map each key to the files that reference it, and add the text as a BM25F field of those files. An
  exact match of the query to a translation value is a first-tier hit (people copy screen text word for word), above
  BM25F. Apps whose mobile app uses another i18n library plug it in through an adapter hook.
- Offline test before building (same harness, `findings/scry-eval/round2/`): queries = the app's bug reports that
  quote on-screen text, expected = the files their fix changed (not derived from the key link, so not circular).
- Acceptance: that test shows a clear gain over T-189's BM25F; specs; docs.
- Measured 2026-11-22 (round 3): 51 non-circular queries mined from commits that quote a locale value (expected = the
  code files the fix changed). Whole quote: today's BM25F 13/51 at hit@20; exact-value tier alone 17/51 (+0.061 RR, CI
  0.008 to 0.128, 4 gained, 0 lost); locale field 17/51 but full-title commit queries drop 72 → 69 (CI -0.046 to
  -0.005). The gain is in exact quotes only (n=26: 8 → 12); the whole bug-report line gains nothing.
- Status: waiting. Owner decision (2026-11-22): keep it for now; build when an app asks (start with the exact-value tier).

## From the 5.62.0 release

## From the 5.61.0 release

### T-183 [feature] Grimoire dev tab: stream partial answers on the first open, refresh live facts after route edits

- Source: 5.61.0 build (T-169, T-178), 2026-11-20.
- What and why: an open that comes before the dev-start warm-up ends still waits for the whole build (about 6.7 s on a
  10,400-file app); the panel routes return whole JSON, so partial answers need a streaming panel contract. Live
  route facts are read on the first open only; after a route edit the tab needs `warlock grimoire build` or a restart.
- Evidence: `findings/5.61/reports/live-checks.md` (timings), `packages/grimoire/src/devtools/snapshot-source.ts`
  (`liveFacts`), `packages/grimoire/src/devtools/index.ts` (warm-up).
- Acceptance: the first open shows the summary before the full book is built; a route edit in dev shows up in the tab
  without a manual build; specs.
- Status: the route-refresh half shipped in 5.63.0 (the dev tab reads routes again after a routes-file change).
  Open: streaming partial answers on the first open; do only if an app asks (vet first).

## From the 5.60.0 release

### T-180 [bug] `warlock dev` exits with 0xC0000409 on Windows while many files change

- Source: app findings page (T-179), seen on an old 4.5 version, not re-tested since.
- What: the dev server sometimes exits with code 3221226505 (0xC0000409, a native fast-fail) during rapid edits.
- Checked 2026-11-19 (5.60.0): file batches are serialised (`batchQueue`), file work is bounded, dev bootstrap logs
  uncaught errors instead of exiting. Only gap seen: the chokidar `error` listener is commented out in
  `packages/core/src/dev-server/files-watcher.ts`; not shown to kill the process.
- Acceptance: a repro on a Windows machine (many files saved at once, e.g. a formatter over the project) before any fix.
- Status: 5.64.0 re-enabled the chokidar `error` listener (logged through `devLogError`, passed to `onFileError` subscribers, never throws). The crash itself is still not reproduced; needs a Windows repro.

## From the 2026-11-19 app reviews

### T-171 [feature] Parked: requests only one app has made

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0, one app). Vetting rule: build only requests with a verified need; wait for a second app to ask.
- Items:
  1. Link flows to analytics events and funnels (an `analytics <name>` step or a pluggable fact source). The `event` step resolves only app event listeners (`packages/grimoire/src/warlock/adapter.ts`, named facts). See T-158.
  2. Product health from the app's own errors and feedback, and a configurable error window (today one hour: `packages/grimoire/src/devtools/product-map.ts:57`, matched by route and fed only by the monitor's error groups). See T-158.
  3. Plan gating and locales as structured data: `who` is free text and audience has many free-text values; ask is a declared audience and plan vocabulary and per-flow locale coverage.
  4. A screenshot workflow (`warlock grimoire shoot`: capture per page and story step plus a staleness check).
  5. A plain-words journey diagram of how flows connect, per feature and across features.
  6. `scry --impact <package-name>` ("which files import this package") for dependency upgrades. Asked by one agent
     after `scry --impact package.json` answered GR9001, which is by design (`bookFile`,
     `packages/grimoire/src/scry/query.ts:49-65`: code files only). Source: the 2026-11-21 scry field report (T-189).
  7. Per-site or per-theme font preload by family name (`fontPreload: string[]` or a request-scoped helper). Today one
     app-wide list (`packages/web/src/fonts/prepare-fonts.ts:47`); manual route: `metadata.links` preload tags +
     `fontPreload: false`. Source: Mentor Me findings U-4 (T-230).
  8. Passkey `origin`/`rpID` as functions of the request. A config getter already works (read per call,
     `packages/auth/src/auth-config.ts:390-410`). Source: Mentor Me findings U-19 (T-230).
- Status: parked, one app asked. Revisit when a second app asks for the same item.

## 5.58.0: Grimoire flow pages, type-only reach and product map

Design: `findings/5.58/ARCHITECTURE.md` (decisions D1–D28); work-package briefs in `findings/5.58/briefs/`.

## After 5.56.0: production monitor follow-ups

## After 5.55.0: Grimoire follow-ups

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
- Status: open. 5.64.0 ran on this server (containers on the host network, `LOCAL_PG_*` / `LOCAL_MONGO_*` from T-181): cascade PostgreSQL integration 13 files, 143 tests pass; cascade MongoDB 104 of 112 pass, the 7 failures are T-212 (also on 5.63 code); core database cache driver live spec passes on both (its PostgreSQL run found the bug fixed in 5.64.0). Not run yet: RabbitMQ, the PostgreSQL checkpoint upsert, the Redis checkpoint layout, the rebinding resolver, the auth token model suites.

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
- Status: 5.64.0: the test waits for React hydration (`__reactProps$`) before clicking and reading `dataset`, polls the server for the new revision before the browser wait, and `windows.yml` uploads `.warlock/e2e` on failure. Not yet checked on Windows: watch the next Windows runs (20 green runs closes it).
