# Completed tasks

Newest first. Each entry records the release that shipped it and how it was verified.

## 5.60.0 (2026-11-19)

### T-177 [feature] AI section in devtools: every Panoptic view plus reports and charts (5.60.0)

- Source: owner, 2026-11-19, in session. Decision: all Panoptic views move into devtools; AI stays split into separate
  sidebar pages (no merge), and gains reports and charts: cost, token usage and error rates by model, agent and date range.
- Today: Panoptic serves its own dashboard (`packages/ai-panoptic/src/dashboard/serve.ts`, port 4319: traces, aggregate,
  evaluate). Devtools has an AI tab (`packages/devtools/src/server/ai-routes.ts`: run list and span tree only) and an
  Agents tab (agent traces from `@warlock.js/ai`). Traces live in an in-memory store (capacity 1000) unless Panoptic's
  `cache` option is set, so date-range reports have no durable data today.
- Pages under "AI" in the sidebar: Reports (KPIs: estimated cost, tokens in/out/cached, runs, error rate, p95 latency;
  date range 24h/7d/30d/custom with the previous period for comparison; cost over time by model, tokens over time,
  error rate over time, top agents and top models tables), Runs (Panoptic traces, span tree), Agents, Models (usage
  per model, pricing set or missing, fallback rate), Errors (failed runs grouped by provider error, rate limit,
  timeout, refusal), Evaluate.
- Data: durable rollups per hour (agent, model, provider, status: runs, tokens, estimated cost, error types, latency
  buckets) stored through the devtools store in the app database, so reports survive restarts and work in the
  production monitor; raw traces keep their current retention. Worker processes contribute through the same store.
  Cost is labelled "estimated from model pricing"; unpriced models are flagged, not counted as zero.
- Panoptic's standalone dashboard stays for processes outside a Warlock app (supported use:
  `docs/src/content/docs/v/latest/ai/getting-started/02-installation.mdx:3,72`); inside a Warlock app
  `panoptic.dashboard` stays off and enabling it logs a notice pointing at `/__warlock`. Removal only in a major release.
- Plan: its own release (5.60.0) after 5.59.0 ships, started in a fresh session with an architect pass (storage schema,
  rollup writer, report API, chart components; follow the `dataviz` skill for charts).
- Shipped: 5.60.0 (2026-11-19). Six AI pages under "AI" in devtools (Reports, Runs, Agents, Models, Errors,
  Evaluate), hourly rollups (`devtools_ai_rollups` in production, daily JSON files in development), report API
  `/api/ai/*`, `devtools.ai` options, Panoptic dashboard off inside a Warlock app (`dashboard.standalone`), fallback
  counts in `@warlock.js/ai`. Design: `findings/5.60/ARCHITECTURE.md`.
- Verified: family typecheck and full test suites green; review pass (26 findings, 25 fixed, one kept and documented);
  rollup store 21/21 on live PostgreSQL 16 and MongoDB 7.

### T-179 [bug] App findings re-checked on 5.59.0 (20 items in @warlock.js packages)

- Source: owner, 2026-11-19, framework issue page https://claude.ai/artifact/Ag3fU7zpT786MDZJGzFrhU (an app's
  register of library issues, re-checked after its 5.48 -> 5.59 upgrade). Extracted claims:
  `findings/5.60/APP-FINDINGS.md` (F-00..F-20; private folder).
- What: verify each `@warlock.js/*` item against `packages/*/src`, fix every confirmed one with specs, docs, skill and
  changelog. Items: repository cache hit returns jsonb objects/arrays as JSON text (cascade + core, broke production
  list pages); transcribe usage drops the audio/text token split (ai-openai); global mail BEFORE_SENDING cannot cancel;
  idempotency middleware guarantees; `useCurrentUser()` typing; `warlock check --changed` rewrites AGENTS.md;
  `warlock dev` vs `warlock agents-md` generated blocks differ; no exported way to load module dictionaries in unit
  tests; decorator lowering drops the JSX runtime in `.tsx`; dev server crash on Windows during many changes;
  notifications `.send()` drops transport failures; nested transactions without savepoints; `afterCommit` docs; model
  events in the vitest worker; migration ordering by SQL kind; `json()` string array insert; `findOneAndUpdate` as a
  row lock; list cache after hot reload; access permission cache sliding expiry; `v.boolean()` and `?flag=1`.
- Out of scope here: the page's items in other libraries (`@mongez/*`, React Email, expo-router, NativeWind,
  modern-screenshot, react-native-view-shot); they live outside this repository.
- Acceptance: each item has a verdict with evidence; confirmed ones fixed with specs; changelog per package.
- Verdicts (5.60.0):
  - Fixed: repository cache hit jsonb/arrays (snapshots keep plain values, old ones still load; `isCacheable` typed);
    transcribe usage split (`audioInputTokens`/`textInputTokens`); global BEFORE_SENDING cancel; idempotency `store`
    and `scope` options plus documented guarantees; `loadTestLocales` exported and unit `setupTest` loads
    dictionaries; decorator lowering keeps the JSX runtime and skips `@` in strings; `warlock dev` and
    `warlock agents-md` write identical blocks; notifications `send()`/`queue()` resolve with per-channel results and
    `throwOnFailure`; access cache uses a fixed expiry; opt-in nested savepoints; `migrate:export-sql` in migration
    order; `lockForUpdate()` documented.
  - Docs only: `useCurrentUser()` off-request (signature change moved to T-009, next major); `afterCommit`; model
    events in the vitest worker.
  - Not reproduced: `warlock check --changed` rewriting AGENTS.md (check never writes it; a concurrent `warlock dev`
    with the old output explains it); `json()` string array insert and `findOneAndUpdate` (both pass on live
    PostgreSQL); list cache after hot reload; Windows dev crash (T-180).
  - Not a bug: `v.boolean()` is strict by design; `.coerce()` accepts "1"/"0".
- Found on the way: concurrent MongoDB `atomic()` upserts of one new key failed with E11000 (fixed, retry outside
  transactions).
- Verified: unit specs per item; live PostgreSQL run for the cascade items; full verification green.

## 5.59.0 (2026-11-19)

### T-141 [feature] `warlock scry` takes about 2.7 s per call on a large app

- Source: 5.55.0 build and pilot, 2026-11-16.
- What and why: each `warlock scry` call reopens the whole grimoire. On the pilot application (11,087 book files) a call
  takes about 2.7 s. Cache the parsed snapshot between calls, keyed by the manifest and the hash of the written files.
- Evidence: pilot timings of 2026-11-16 (see T-136); `packages/grimoire/src/workspace/index.ts`.
- Acceptance: a second call on an unchanged book does not reopen the grimoire (a spec counts the reads); a change to a
  written file or to the manifest reopens it.
- Update 2026-11-19 (app gate-speed write-up https://claude.ai/artifact/J1f3aS1k6PKvy4gM8AEY7w, same ask): on an 11,223-file
  book each `scry` took about 7 s, `grimoire check` 4.9 s, `grimoire build` 35.6 s, and `build --site` 70.6 s even with a
  fresh book. Checked: `warlock mcp` does not keep the book loaded; each tool call runs `openGrimoire(...)` again
  (`packages/grimoire/src/warlock/mcp-tools.ts:167`, `:239`), so the MCP server, `scry` and `check` all pay the open per call. Extend the
  acceptance: the MCP tools and the dev server reuse one opened book until the manifest or a written file changes, and
  `build --site` skips the rebuild when the book is fresh. First-open time of the tab is T-169.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-159 [feature] Warlock logo, versions and logo colours in devtools and Grimoire; new flows and "What changed" views

- Source: owner, 2026-11-19, in session (two screenshots: the Product map "What changed" list and the developer feature
  page's Flows table).
- What and why: (1) when Grimoire runs inside a Warlock.js app, show the Warlock logo and the installed Warlock
  version, and show the app's own name and version at the bottom; (2) recolour the devtools dashboard from the logo
  (gold on near-black, `docs/public/logo.png`) and tidy spacing; (3) replace the plain Flows table on the developer
  feature page (`packages/grimoire/ui/grimoire-view.js:1082`) with a more visual layout; (4) redesign the Product map
  "What changed" list (`packages/grimoire/ui/product-map.js:579`): versions as a timeline, entries grouped by
  type, AC/T references as quiet chips.
- Files: `packages/devtools/ui-src/src/styles.css` (`--brand` is indigo today), `packages/devtools/ui-src/src/app/`
  (Header, Sidebar, Shell: no logo or version today), `packages/grimoire/ui/*`, `packages/grimoire/src/warlock/adapter.ts`
  (already reads installed package versions).
- Acceptance: logo + Warlock version in the devtools header and the Grimoire tab; app name + version at the bottom;
  text tokens keep 4.5:1 contrast in both themes; Grimoire stays framework-neutral (logo only through the Warlock
  adapter); specs, docs, skills and CHANGELOG entries; owner reviews a preview on a large real app before the final
  verify and the release.
- Status: in progress (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-160 [bug] GR3006 "owned file no flow reaches" fires on route middleware, migrations, seeds, commands, layouts and spec-only helpers

- Source: app write-up https://claude.ai/artifact/RHPjc4m77HEC3gCQf1Vdon (measured on `@warlock.js/grimoire` 5.58.0; 429 of 430 warnings left in a large app were GR3006: 161 migrations, 10 seeds, 12 command files, route middleware, `main.ts` boot work, layout/root components, spec-only helpers). Confirmed against the source 2026-11-19.
- What and why: GR3002 makes every file under `src/app/<module>` belong to a feature, and GR3006 then warns when no flow step reaches it. Files that no step type can reach, yet are real used code, can never be cleared honestly, so the warning stops being a signal for real dead code.
- Evidence: `packages/grimoire/src/bookmap/steps.ts:70-100` (`reach()` follows imports from the entry files only; `extra` files are added without their imports); `:102-120` (`routeStep`: the routes file is `extra`, and the comment says its imports are deliberately not part of the step); `packages/grimoire/src/bookmap/build.ts:289` (`unreached: own.filter(file => !reached.has(file))`); `packages/grimoire/src/check/rules/source-files.ts:14` (`NO_FEATURE_TYPES`) and `:153` (`checkUnreached`); `packages/grimoire/src/ownership/index.ts:47` (`countsForFeature` only leaves out specs).
- Repro: the write-up's `run.mjs` feeds a hand-written adapter (one feature, one flow `route GET /api/orders`, a routes file importing a controller and a middleware, a migration, a seed, a command, a component) to `openGrimoire` + `checkGrimoire`; observed output on 5.58.0 is five GR3006 warnings (middleware, migration, seed, command, component). Turn it into the regression spec in `packages/grimoire/src/`.
- Suggested fix (verified; two of the write-up's suggestions are changed):
  1. Route middleware: resolve the matched route's `middleware` names (the route fact carries them) to files and reach those in `routeStep`. Do NOT follow the routes file's imports: a routes file imports every controller of the module, so one route step would reach all handlers and hide real gaps.
  2. Exempt by role, as `countsForFeature` does for specs: migration, seed, command, main, layout/root. The book must classify commands and layouts first (command files are `type: "source"` today), so the classification is part of this task.
  3. Helpers imported only by specs count as reached (specs are already excluded from ownership).
  4. Reject the free-form `plumbing: [globs]` opt-out: it lets any file hide from the check.
- Unconfirmed: the layout/root component case was simulated with an unimported file; a fixture with a real layout mounting the component is the missing step. The 429 total came from the real CLI in the app, not from the script.
- Acceptance: the regression spec passes (middleware reached; migration, seed, command, main, layout exempt by role; spec-only helper reached); a file of no such role still warns; docs, `use-the-grimoire` / `describe-an-app` skill text and CHANGELOG entry updated.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-161 [bug] Grimoire tab in dev reports false GR5008 errors and a red health light because route facts are missing; Overview and Check word the route-facts state differently

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0, `warlock dev`, no book on disk): `/__warlock/api/grimoire/summary` answered `routes: "missing"` with 2 GR5008 errors; the feature card read "Has problems" and a flow read "Steps resolved 3/4" next to "Findings 0". After `warlock grimoire build` the same app showed `fresh`, 0 errors, all steps resolved. Separately, Overview said route facts were "fresh / up to date" while Check said "routes cached" at the same moment. Both share one root: the panel's idea of the route facts state.
- What and why: the dev panel never collects route facts when none are cached, yet still checks mail and notification entries against them. A false red health light on first open misleads every user of the tab.
- Evidence: `packages/grimoire/src/apps/check-apps.ts:226-275` (`checkReached`; `:240` checks mail/notification against `facts.named` with no routes-missing guard); the guard the step rules already have: `packages/grimoire/src/check/rules/links.ts:38` (`skipBootTypes = snapshot.routes === "missing"`). The wording of the route-facts state comes from the Overview and Check views in `packages/grimoire/ui/` (find where each prints `routes` and make them share one label).
- Repro: git worktree with no `grimoire/book`, `warlock dev`, `curl <dev>/__warlock/api/grimoire/summary` shows `routes: "missing"` and 2 errors; `npx warlock grimoire build`, curl again shows `fresh` and 0 errors. Turn it into a spec: a snapshot with `routes: "missing"` and a page whose `Also reached from` names a mail gives no GR5008, and the unchecked step is not counted as resolved or failed.
- Suggested fix: skip GR5008 when `routes === "missing"`, count only steps really checked, keep unchecked facts out of the health light; collect route facts from the live app in dev (or once on first open) so the state is `fresh` without a manual build; one shared wording for the state in Overview and Check.
- Acceptance: the spec passes; Overview and Check never disagree on the state in a spec over the same snapshot; docs and CHANGELOG entry.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review. Dev self-collection of route facts was removed for safety; follow-up T-178.

### T-162 [bug] Grimoire search indexes only a flow's ref and heading, so flows by title, summary, case or criterion words never show

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0): "trial" ranks the two trial flows 26th and 27th, past the default limit of 20; "cancel" (limit 50) misses a flow titled "Cancel, resume or switch"; "payment failed", "double charge" and "AC-5" find no flow or criterion.
- What and why: written content (flows, criteria) is not searchable by its own text and loses on score to files whose paths contain the word. Business readers cannot find flows.
- Evidence: `packages/grimoire/src/scry/query.ts:524` (`candidates()`; flow candidates carry only ref and heading text); scoring and the 20-result cut are in the same file (find `limit`/score weights near the candidate scoring).
- Repro: `npx warlock scry --search "trial" --json` in an app with a flow titled with "trial" and many files containing the word. Spec: a snapshot with one flow titled "Start a trial" and 30 files with "trial" in their path ranks the flow within the limit.
- Suggested fix: index summary, story, case text and criteria; rank written content above file paths; group results by type so one type cannot crowd out the rest; a business mode on the Product map that hides files and exports.
- Acceptance: the spec passes; criteria ids (AC-n) are findable; docs and CHANGELOG entry.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-163 [bug] CLI progress lines print the command signature ("grimoire <action> [release] completed", "Running scry [file]...")

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0). Core bug, not Grimoire: it affects every command that declares arguments in its `name`.
- What and why: the progress helpers print the command's `name`, which for argument-taking commands includes the signature, so users see placeholders.
- Evidence: `packages/core/src/cli/cli-commands.utils.ts:138` ("Running ...") and `:197` ("completed successfully"); the names come from `packages/grimoire/src/warlock/commands.ts:105` (`"grimoire <action> [release]"`) and `:176` (`"scry [file]"`).
- Repro: `warlock grimoire build` and `warlock scry --search x` show the signature in the progress lines. Spec: `displayExecutingCommand("scry [file]")` output contains `scry` and not `[file]`.
- Suggested fix: strip `<...>` and `[...]` argument tokens from the name in the display helpers (not from the registered name).
- Acceptance: the spec passes for `<x>` and `[x]` forms; CHANGELOG entry.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-164 [feature] Business-only static export of the Product map (small and share-safe), plus PDF or Docs export

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0): `build --site` took 70.6 s with a fresh book and produced one 25 MB `index.html`, with file paths and test names included and per-file answers kept for only 3,000 of 11,223 files.
- What and why: the export always carries developer detail, so it cannot be handed to business readers, and it opens on the developer Overview.
- Evidence: `packages/grimoire/src/devtools/site.ts:47` (`productOptions = { shared: false, errors: null }`); `:28` (`SITE_FILE_LIMIT = 3000`); `:144` (the per-file cut).
- Acceptance: a `--product` option exports the share-safe product view only (no file paths or test names, opens on the Product map, no per-file answers) and is much smaller than the full export; a spec checks the output carries no file path; PDF or Docs export is a follow-up decision. Docs, skill and CHANGELOG entry.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-165 [feature] Product map: show a missing test-results file as neutral grey "not measured", not "Needs attention"

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0): all 20 features read "Needs attention: No test results recorded" because no results file existed.
- What and why: missing proof hygiene is not a product problem; business readers see a wall of yellow.
- Evidence: `packages/grimoire/src/devtools/product-map.ts:171` (`healthOf`) and `:205` (the "No test results recorded" reason); `packages/grimoire/src/devtools/view.spec.ts:412` pins the text.
- Acceptance: with no results file the product view shows a grey "not measured" state; the developer view keeps the yellow warning; specs for both; docs and CHANGELOG entry.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-166 [feature] Product map: sort features and flows, and filter "changed since"

- Source: app review https://claude.ai/artifact/VBTrUkTUGtkYXMp7xox8Pk (5.58.0): cards sort by id (admin first); "recently updated" is useless after a backfill (all 20 dated the same day).
- What and why: business readers want the important features first and a way to see what changed since a date or release.
- Evidence: the feature list and its order are built in `packages/grimoire/src/devtools/product-map.ts` and rendered in `packages/grimoire/ui/product-map.js`.
- Acceptance: sort by id, name, last updated and health (default stays stable); a "changed since" filter (date or release) in the product view; specs for the ordering and the filter; docs and CHANGELOG entry. Ranking by traffic needs a source the framework lacks (see T-158); not part of this task.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-167 [feature] Devtools production auth: optional two-factor and a configurable common-password check

- Source: owner, 2026-11-19, in session.
- What and why: two-factor is mandatory today (`"admins"` or `"everyone"`), and the common-password list check cannot be turned off or tuned. Add `twoFactor: "off" | "admins" | "everyone"` and `passwords: { minLength, rejectCommon }`. Passkeys stay one of the two optional second factors. When `twoFactor` is `"off"`, boot logs a warning that the monitor has no second factor.
- Evidence: `packages/devtools/src/production/options.ts:34` (type), `:66` (default `"admins"`), `:188-191` (validation); `packages/devtools/src/production/auth/service.ts:177-178` (`twoFactorRequired`), `:1595` (admin without a factor); `packages/devtools/src/production/auth/helpers.ts:31` (the hard-coded `COMMON_PASSWORDS` check; list in `auth/common-passwords.ts`).
- Acceptance: `"off"` skips enrolment and the second step for every role, with the boot warning; `passwords.rejectCommon: false` accepts a common password, `minLength` is enforced; specs for each, docs (`devtools/security.mdx`, options reference), `packages/devtools/skills/SKILL.md` and CHANGELOG entry.
- Status: in progress for 5.59.0, alongside T-159.
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-173 [feature] `warlock check` reuses a fresh Vitest result for the same tree and sizes its test timeout

- Source: gate speed write-up https://claude.ai/artifact/J1f3aS1k6PKvy4gM8AEY7w (5.58.0; a 2,616-file, 15,335-test suite ran 1,403 s; the first `warlock check` stopped at the 600 s limit with WL8007, and the rerun with a raised timeout added about 23 minutes for a result already known).
- What and why: without `--changed`/`--base`, the tests step runs the whole suite again even when the same commit just passed `vitest run`. The 600 s default is too small for large apps and the error does not say how long the run took.
- Evidence: `packages/core/src/cli/commands/check.command.ts:51` (`--test-timeout`, default 600, `WARLOCK_CHECK_TEST_TIMEOUT`); the tests step is `packages/core/src/tooling/check/` (see `tests-step.spec.ts`); WL8007 is in `packages/core/src/errors/error-codes.ts`.
- Acceptance: accept a recorded result for the same tree (a Vitest JSON report or the Grimoire reporter's results file, with a content hash of the tree) and skip the run when it matches; derive the default timeout from the last run's duration or print the measured duration in the WL8007 message; specs; docs, `warlock-check` skill and CHANGELOG entry. Estimated size: M.
- Workaround in the app: run `warlock check --skip tests` right after `vitest run`.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-174 [feature] Shorter per-file app boot in integration tests

- Source: gate speed write-up https://claude.ai/artifact/J1f3aS1k6PKvy4gM8AEY7w. App boot is 54-55% of every full-suite run (about 10 minutes per run, 20-30 minutes per gate on the measured app). Worker lifetime needs `isolate: false` (`packages/core/skills/test-service/SKILL.md:500-504`), which shares module state between files; the app judged that unsafe (595 non-unit specs use `vi.mock`, many on app modules; process-wide caches in app modules).
- What and why: a way to boot less per file without sharing module state. Large (L).
- Options: (a) worker lifetime that boots connectors once per worker but gives each file a fresh module graph (cached database, cache and config connections handed to each file's import of the app), with a reset hook for app caches; (b) a lighter boot profile for HTTP specs that skips work they do not use (web/Vite setup, sitemap, route registration of other sites), with per-phase costs reported by the existing setup recommendation.
- Owner decision (2026-11-19, in session): build (a).
- Plan: spike first on a framework-owned app (the create-warlock template or the release gate's blog app). Measure the
  boot phases, then prove that connectors kept on the worker survive a per-file module reset and that `vi.mock`,
  `vi.spyOn`, stubbed env and fake timers do not leak between files (a spec per leak type). If the spike shows Vitest
  cannot give each file a fresh module graph without leaks, stop and report to the owner before falling back to (b).
- Acceptance: integration specs keep per-file module isolation; connectors (database, cache) open once per worker;
  a documented reset hook for app caches; measured boot share before/after on the spike app; specs, docs,
  `test-service` skill and CHANGELOG entry.
- Status: in progress for 5.59.0 (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review. Shipped as experimental `tests.lifetime: "worker-isolated"`; real-app check 148.8 s to 129.7 s, setup 27% to 3%.

### T-175 [feature] Grimoire feature and flow pages: architecture-first layout with three new visual views

- Source: owner, 2026-11-19, in session, after reviewing the T-159 preview at wjs-devtools.mentoor.io. Agents get
  file-level answers from scry/CLI/MCP JSON, so the pages should explain the feature to humans and show files only on demand.
- What: (1) feature map grid: flows (rows) × places they run (columns: each site, each mobile app, API, background
  jobs/mail/notifications), cells hold chips for the pages, screens, routes and named steps the flow touches;
  (2) flow journey: written steps drawn left to right as typed nodes (page, route, service, mail, job, event,
  notification, affects), click a node to see its files; "What if…" cases as their own lane (not attached to a step
  unless the data ties them); (3) health strip on Product map feature cards (written, proven by tests, screenshots,
  open findings). Feature page becomes tabs (Overview default: summary, feature map, flow cards, neighbours; Flows;
  Files grouped by module and collapsed; Findings grouped by code and collapsed; Tests). Flow page becomes tabs
  (Journey default; Proof; Files per step, collapsed; Findings). Each tab has its own hash route.
- Files: `packages/grimoire/ui/grimoire-view.js`, `ui/product-map.js`, `ui/*.css`, feature/flow answers in
  `packages/grimoire/src/devtools/` and `src/scry/query.ts`.
- Acceptance: hand-drawn SVG/plain JS only (no new libraries), works in the static export and at 390 px, both themes,
  dashboard tokens only; old hash links still open the right page; specs for the new answer fields and views; docs and
  skill updates. Covers T-172 item 2 (findings wall).
- Status: in progress on the preview (2026-11-19).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

### T-176 [bug] Devtools AI tab: one generic install paragraph for every reason the tab is empty

- Source: owner, 2026-11-19, in session (screenshot of the AI tab on the preview app). The app uses `@warlock.js/ai`
  (46 source files) but never installed `@warlock.js/ai-panoptic` (its `src/config/ai.ts` has the `panoptic` line
  commented out), so the empty tab is correct, but the message does not say which of the reasons applies.
- Evidence: `packages/devtools/src/sources/ai-source.ts:5-6` (`AI_INSTALL_GUIDANCE`, one fixed string covering "not
  installed", "installed but cannot load" and "observation off"), shown as a long bold paragraph by the AI page in
  `packages/devtools/ui-src`.
- Fix: detect the case and say it: (1) `@warlock.js/ai` missing; (2) ai present, Panoptic missing → "Your app uses
  @warlock.js/ai. Add Panoptic to see its runs: `warlock add ai-panoptic`"; (3) Panoptic present but failed to load →
  show the load error and the two versions; (4) loaded but `observeAll` off and nothing registered → how to turn it
  on. Render as a short title, one line of explanation and a copyable command, not a bold paragraph.
- Acceptance: a spec per case for the source's message; the UI empty state uses title + body + code; docs line on the
  AI tab; CHANGELOG entry.
- Status: open, after T-175 (shares the preview rebuild).
- Shipped: 5.59.0 (commit 147078d6e), verified by the 5.59.0 verify pass + Forma preview review.

## 5.58.0 (2026-11-18)

### T-152 [bug] Flows have no summary

- Source: owner, 2026-11-18, write-up https://claude.ai/artifact/CVZWgVr2qL8jEufUrQSXnx (measured on `@warlock.js/grimoire` 5.57.0 in a large app: 82 flows, 11,272 files).
- What and why: the paragraph under a flow's `# Title` is dropped, so the flow page, `scry --flow` and every reader
  have no one-line description of the flow; the feature README already has one.
- Evidence: `packages/grimoire/src/written/features.ts:510-526` (5.57.0, `parseFlow` builds no summary; the README
  reads one at `:158`); `packages/grimoire/src/contracts/written.ts:178-201` (`WrittenFlow` has no `summary`);
  `packages/grimoire/src/devtools/data.ts:195-205`; the flow template in `packages/grimoire/skills/write-a-feature/SKILL.md`.
- Decision: D1 (`summary` via `paragraphAfterTitle`, warning GR1030 when missing). Contract field added 2026-11-18.
- Acceptance: parser, devtools flow answer, flow page and skill template carry the summary; GR1030 in the check and
  docs; specs.
- Status: shipped in 5.58.0, commit 33c436691.

### T-153 [bug] Flow page shows "does not apply: does not apply: …"

- Source: owner, 2026-11-18, write-up https://claude.ai/artifact/CVZWgVr2qL8jEufUrQSXnx (measured on `@warlock.js/grimoire` 5.57.0 in a large app: 82 flows, 11,272 files).
- What and why: a case answered "does not apply: …" is rendered with the prefix twice.
- Evidence: `packages/grimoire/src/written/features.ts:444-445` keeps the prefix in `answer`;
  `packages/grimoire/ui/grimoire-view.js:1028` adds it again.
- Decision: D2 (view-only fix; "Does not apply" cases collapsed in their own group).
- Acceptance: the prefix appears once; view spec.
- Status: shipped in 5.58.0, commit 33c436691.

### T-154 [bug] Flow steps list the whole import closure, through type-only imports; flow answers reach megabytes

- Source: owner, 2026-11-18, write-up https://claude.ai/artifact/CVZWgVr2qL8jEufUrQSXnx (measured on `@warlock.js/grimoire` 5.57.0 in a large app: 82 flows, 11,272 files).
- What and why: a page or route step lists every file its entry reaches, including through `import type` of barrels
  that re-export server code (step 1 of a sign-in flow listed 1,192 files; flow answers 0.5–2.7 MB).
- Evidence: core records every import with no type-only flag (`packages/core/src/tooling/inspect/collect-files.ts:234-251`,
  `inspect-report.types.ts:315`); grimoire walks every edge (`packages/grimoire/src/graph/index.ts:42-46`,
  `src/bookmap/steps.ts:56-145`); the flow route sends the whole book map (`src/devtools/index.ts:133-134`).
  Fixture `packages/grimoire/tests/type-only-imports.spec.ts` ran 2026-11-18 on the 5.57.0 code: the page's closure
  contains the barrel, the model and the database connection (1 passed, 1 expected fail for the fix). The app's exact
  numbers were not re-measured.
- Decision: D4–D8 (core marks `typeOnly`; steps store `entries`, `direct`, `files` without type-only edges and
  `typeOnlyFiles`; coverage keeps the full reach; devtools and MCP send counts first, file lists paged on request).
- Acceptance: the fixture's regression passes as `it`; flow answers on the shop fixture carry no full file lists;
  GR3006 counts unchanged by the type-only change; docs, specs, goldens.
- Status: shipped in 5.58.0, commit 33c436691.

### T-155 [feature] Grimoire tab UX: flow page, grouped Check tab, Overview ranking, phone layout, display bugs

- Source: owner, 2026-11-18, write-up https://claude.ai/artifact/CVZWgVr2qL8jEufUrQSXnx (measured on `@warlock.js/grimoire` 5.57.0 in a large app: 82 flows, 11,272 files).
- What and why: the flow page is swamped by files and has no summary or health; duplicate no-test pills; the Check tab
  is one flat list (2,347 findings, GR3006 1,881 one-per-file rows, "no unexpected errors" next to 2,347 warnings);
  Overview "Top problems" takes the first five findings in report order; data never shown (`differs`, origin, the
  linked flow of an `affects` step, case `fixed`, previous/next flow); literal backticks in criteria and task text;
  phone layout unusable (Files column ~30 px, Apps table 558 px wide, task ids wrap, sub-tabs hidden); overlapping
  Modules labels.
- Evidence: `packages/grimoire/ui/grimoire-view.js:915-1049` (flow page), `:972`/`:989`/`:1046` (duplicates),
  `:1451-1505` (Check tab, headline `:1461`), `:664` (Top problems); `ui/grimoire.css` (no phone rules for tables).
- Decision: D9, D10, D12, D13 (owner's proposed flow page and Check tab).
- Acceptance: the flow page and Check tab as designed; works at 390 px with no horizontal scroll; view specs; docs.
- Status: shipped in 5.58.0, commit 33c436691.

### T-156 [bug] Tagged tests read "not-run" in the devtools tab

- Source: owner, 2026-11-18, write-up https://claude.ai/artifact/CVZWgVr2qL8jEufUrQSXnx (measured on `@warlock.js/grimoire` 5.57.0 in a large app: 82 flows, 11,272 files).
- What and why: criteria with `@proves` tests show `not-run` even after test runs. Three causes in the framework:
  the production snapshot's change stamp ignores the results file, so new results never show until something else
  changes; `grimoire/book/` is git-ignored, so a deployed app has no results and there is no option to read them from
  elsewhere; nothing tells "never recorded" from "did not run".
- Evidence: `packages/grimoire/src/devtools/snapshot-source.ts:62-71` (stamped files) and `:105` (`keepUntilChanged`);
  `packages/grimoire/src/paths/index.ts:38`; `packages/grimoire/src/test-results/index.ts:23-35` (fixed path);
  `packages/grimoire/src/contracts/bookmap.ts:95-96`. Unconfirmed: which cause hit the app, and whether the reporter
  matched its tests (name fallback at `packages/grimoire/src/vitest/index.ts:203-208`).
- Decision: D11 (stamp the results file; `testResultsFile` panel/open option and `grimoireReporter({ file })`;
  `TestResultsInfo` in answers; GR4009 no results recorded; GR4010 unmatched proving test).
- Acceptance: a new results file shows in production without a restart (spec); the tab shows "No test results
  recorded yet" with the fix when none exist; docs show the CI → deploy path.
- Status: shipped in 5.58.0, commit 33c436691.

### T-157 [feature] Product map in the Grimoire tab, with read-only share links

- Source: owner, 2026-11-18, write-up https://claude.ai/artifact/CVZWgVr2qL8jEufUrQSXnx (measured on `@warlock.js/grimoire` 5.57.0 in a large app: 82 flows, 11,272 files).
- What and why: owner decision: a business-facing map so non-technical readers understand the product: feature map
  (cards with plain summary, audience, apps, health light), feature page (what, why, who, flows as short stories, where
  you see it per app with screenshots, release history in plain words, planned work), flow page (summary, steps in the
  user's words with screenshots, what proves it), code detail behind "For developers"; format additions (feature
  `audience` and `## Why`, flow summary, `## Story`, screenshot image lines, `(AC-n)` on a case line); a devtools
  setting that lets an admin create read-only share links, otherwise signed-in devtools users only.
- Evidence: no such view or data exists in 5.57.0 (`packages/grimoire/src/devtools/index.ts` routes; `ui/` files);
  devtools panels can serve only fixed assets and have no public route (`packages/devtools/src/types.ts`,
  `src/production/http/access.ts`).
- Decision: D14–D27 (map inside the Grimoire tab plus a share page from the same module; reports backed by real data
  only: release history, test health, planned work, captured error counts; share links in the production monitor with
  the token in the URL fragment, a scoped HMAC cookie, a `devtools_shares` table, revocation and audit; a shared view
  never shows file paths, code, tests or error messages).
- Acceptance: map, feature and flow pages render from the shop fixture at 390 px and desktop, light and dark; a share
  link opens in a private window, exposes no file path, and stops working after revoke; security specs per the WP-6
  checklist; docs pages (grimoire product map, devtools panels/production/security), skills, changelogs.
- Status: shipped in 5.58.0, commit 33c436691.
- Verified by: one typecheck + full tests + release gates, single review, real-browser screenshots at 1440/390 px light/dark; share-link store run on Postgres 16 and MongoDB 7.

## 5.57.0 (2026-11-18)

### T-150 [feature] Modern devtools UI, a readable Grimoire tab with a Features view, faster Grimoire loads

- Source: owner, 2026-11-18, with the write-up https://claude.ai/artifact/DBtF1QLyZvq3wb9yRbNJCX (checked against 5.56.0).
- What and why: the Grimoire tab is close to unreadable (its stylesheet uses `--text`, `--line`, `--surface`, `--good`,
  `--bad`, `--warn`, `--bar`, which the dashboard never defines; `--accent`/`--muted` are surface greys, so nav links
  render at 1.31:1 on dark), its lists are one flat column with no grouping, counts or filters, features are only a
  table on Home, and the first open after a few idle seconds reopens the whole book (`ttlMs` default 2000). The owner
  rates the whole dashboard's UI and UX as poor and wants a modern one, with Grimoire listings as the priority.
- Scope: (1) dashboard design system and shell (themes with a toggle, sidebar, documented panel tokens, contrast spec);
  (2) built-in tab listings; (3) Grimoire view rebuild with a Features tab, filterable lists and detail views;
  (4) snapshot kept until the book changes, warm-up in production, `[module, options]` panel entries.
- Evidence: `packages/grimoire/ui/grimoire.css`, `packages/grimoire/ui/grimoire-view.js`,
  `packages/grimoire/src/devtools/snapshot-source.ts:66`, `packages/devtools/src/panels.ts` (`panelsOf`,
  `loadDevtoolsPanels`), `packages/devtools/ui-src/src/styles.css`.
- Acceptance: every panel colour comes from a documented token defined in both themes, with a spec that fails on an
  undefined variable; Grimoire has Overview, Features, Apps, Tasks, Releases, Check and Modules views with search,
  filters and counts; a second open of an unchanged book in production does not reopen it; specs, docs, skills and
  changelogs ship with it.
- Shipped: 5.57.0 (2026-11-18 05:52 UTC), release commit 2d75c0dc9 (tag `v5.57.0`), publish run 44243517250.
- Verified: devtools typecheck, 957 server specs and 143 dashboard specs (new token and contrast spec, shell, palette,
  drawer and listing specs); grimoire typecheck and 491 specs (tokens, data routes, view, snapshot source); oxlint 0
  errors, format check, public-text check, docs build, dashboard bundle rebuilt (141 KB gzipped); screenshots of the
  built dashboard and the Grimoire tab in light and dark at 1440 px and 390 px with real Grimoire data over the shop
  fixture, no console errors; one review pass (three fixes).

## 5.56.0 (2026-11-17)

Built from an architecture document and nine work packages, then an integration pass, a dedicated security review
(seven fixes), an end-to-end run in a real app on MongoDB and PostgreSQL with headless Chromium (ten fixes), and one
full verify pass (format, lint, gates, typecheck and tests of every package, docs build). Private notes:
`findings/5.56/` (ARCHITECTURE.md, reports/, e2e/ screenshots).

### T-145 [feature] Devtools in production: a secured monitor at a custom path, with accounts, and a React dashboard

- Source: owner request of 2026-11-17 (design agreed in conversation the same day).
- What and why: the owner wants to see queries, their performance and plans, request states, bottlenecks, memory and
  CPU, health checks and the Grimoire of a production app from the browser (for example `https://<app>/__monitor__`)
  without logging in to the server. Today devtools is development-only (loopback guard, refuses proxy headers) and
  the dashboard is plain HTML and JavaScript.
- Agreed design:
  - Off in production by default. Enabling needs an explicit custom path and a first admin, both from env at deploy
    time (`DEVTOOLS_PATH`, `DEVTOOLS_ADMIN_EMAIL`, `DEVTOOLS_ADMIN_PASSWORD` or a one-time setup token); it refuses to
    start without them. The env password works only until the admin changes it at first login.
  - Its own accounts, separate from the app's users, stored through cascade (table or collection, migration). Roles:
    admin (manage users, disable switch, EXPLAIN) and viewer (read-only). The admin adds users from the dashboard with a
    one-time invite link (24 h); users set their own password.
  - Passwords: minimum 8 characters, a small built-in list of common passwords refused, hashed with the framework's
    password hashing. Rate limits per account, per IP and globally (lockout), with a trusted-proxy setting for the client
    IP. HttpOnly, Secure, SameSite=Strict session with a short TTL; CSRF on every action; audit log of logins, failed
    tries and actions. Two-factor sign-in (TOTP or passkey via `@warlock.js/auth`), on by default for admins.
  - A "Disable dashboard" button: a shared flag (cache or database) that turns it off on every instance and survives
    restarts; re-enabling only from config or `warlock devtools:enable`. `warlock devtools:reset-admin` for recovery.
    The path answers a uniform 404 while disabled or locked; `noindex`; no CORS.
  - Panels in production: requests (sampled by `sampleRate`, slow requests always kept, redacted headers and bodies,
    bounded memory, plus the persistent request log), query stats per normalized query shape (count, p50/p95, slowest
    example, N+1) and slowest routes and phases (tracing hooks), EXPLAIN on demand per query shape (never an executing
    plan such as PostgreSQL `ANALYZE` or MongoDB `executionStats` unless the project allows it), resources per process
    (RSS, heap, CPU, event-loop delay, GC, short history; each pm2 or cluster worker), health checks with history,
    errors, logs, jobs and schedules, and Grimoire. Mail previews and process controls stay off in production unless a
    project opts in per panel. Unsampled requests do no capture work; the mode costs nothing when off.
  - Dashboard rebuilt with React, Tailwind and shadcn in `packages/devtools/ui-src/` (own Vite dev server); a build
    step writes the bundle that devtools serves; the release gate rebuilds it and fails when the shipped bundle is
    stale; size budget about 300 KB gzipped. The 5.55.0 panel registration API stays: the React shell mounts package
    panel view modules (the Grimoire tab keeps working). SSR through `@warlock.js/web` was considered and rejected
    (devtools must work in API-only apps).
- Real-time: today the dashboard gets live `request`, `log`, `mail` and `ai` events over one SSE stream
  (`/api/stream`, `packages/devtools/src/server/stream-route.ts`, a ping every 15 s); other panels load on demand.
  In production the stream needs the session check, `X-Accel-Buffering: no` for nginx, a reconnect with backoff, and a
  per-instance view: each process has its own collector, so either show the instance the browser reached or fan
  events in from every instance through a shared bus (Redis pub/sub or `@warlock.js/herald`); decide in the design.
  Resource and query-stat panels refresh on an interval.
- Evidence: `packages/devtools/src/server/guard.ts` (development-only guard), `packages/devtools/ui/app.js` (plain DOM
  UI), `packages/core/skills/request-log/SKILL.md` (`http.logging.requests` production settings),
  `packages/core/skills/request-tracing/SKILL.md` (`http.tracing`), `packages/devtools/src/panels.ts` (panel API).
- Acceptance: specs for every access rule (disabled by default, missing path or admin refuses to start, rate limits and
  lockout, session and CSRF, roles, invite links, two-factor, disable switch across instances, uniform 404),
  redaction and sampling specs, an overhead benchmark at the default sampling rate, UI specs for the React dashboard,
  the bundle freshness and size gate, docs, skills, changelog and upgrade notes; a dedicated security review before
  release.
- Status: shipped in 5.56.0.

## 5.55.0 (2026-11-17)

Final gate and fixes after the pilot: `findings/5.55/reports/FIX-VERIFY.md` (typecheck, strictness, lint, format), `POST-REVIEW.md` (the `kind` to `type` rename), `PILOT-FIXES.md` and `PILOT-FIXES-2.md` (grimoire suite at 460 tests on the last run).

### T-136 [chore] Pilot and measurement before publishing 5.55.0

- Source: owner decision of 2026-11-16 (pilot on the owner's chosen application).
- What and why: install the packed 5.55.0 into a copy of the pilot application, build its book, backfill its
  features with the `backfill-a-grimoire` skill (features marked inferred), and fix what the pilot shows in the
  package and the skills. Then run ten real tasks twice with the same model, with and without Grimoire, recording
  tokens in and out, tool calls, wall time, tests passing and reviewer findings.
- Acceptance: the pilot's `warlock grimoire check` is clean or its remaining findings are real; the measured numbers
  are in the release summary as measured, whatever they are.
- Depends on: T-121 to T-135.
- Shipped: 5.55.0. Verified: a private copy of the pilot application upgraded to the packed 5.55.0 tarballs;
  `warlock add grimoire`, book built (11,087 files, 52 s cold, 3.7 s with no change), backfilled with the
  `backfill-a-grimoire` skill (23 features, 110 flows, 4 apps, 42 owner questions as tasks; check 0 errors,
  remaining warnings are real: files without header sentences, untested criteria). The pilot's setup and backfill
  findings were fixed in two rounds (bounded `check`/`scry` output, ranked search, code-only book, safer
  `add grimoire`, app-scoped page steps, file entries in `folders`, mail/job names from registries). Ten tasks run
  twice with the same model (20 headless runs, hidden acceptance specs calibrated and encrypted, blind diff review);
  the numbers are in the 5.55.0 release summary as measured: more tokens and tool calls with Grimoire (+39% tokens
  in, +24% tool calls, +20% cost), 7/8 hidden checks passed against 6/8. Private results: the pilot folder's
  `measure/RESULTS.md`.

### T-137 [decision] Grimoire: label, changelog stamping, mobile screens (decided)

- Source: design sessions of 2026-11-16; decided by the owner the same day.
- What and why: Three decisions. Grimoire is experimental in 5.55.0 (stable in 6.0). The agent writes the release number and date into each feature changelog; Warlock only collects the unreleased entries into the release file, and `warlock grimoire check` reports an entry a release lists without a matching release and date. Mobile screens are declared by the agent in the app's folder when navigation is defined in code, and are listed from the file structure only when the app uses file-based routing.
- Shipped: Decided 2026-11-16; applied in 5.55.0.
- Verified: the label, stamping and screen rules are in the written-file structure page and the skills; the checks are covered by the specs of T-125, T-129, T-131 and T-132 and reviewed in `findings/5.55/reports/REVIEW-written.md` and `REVIEW-book-check.md`.

### T-135 [feature] Scaffold, skills and docs for Grimoire

- Source: owner decision of 2026-11-16 (on by default in new apps).
- What and why: `warlock add grimoire` (core feature map and create-warlock feature list, kept in parity), a helper that inserts a command into `cli.commands` of an existing `warlock.config.ts`, the registration in the template config, ignore rules for the generated files, a line in the template's agent guide, the six skills in `packages/grimoire/skills`, a docs section, and the scaffolder spinner text. Grimoire is in the template and offered as a feature; selecting it on a fresh scaffold changes nothing.
- Shipped: 5.55.0 (experimental).
- Verified: core `src/generations` 25 files, 158 tests; create-warlock template-grimoire, features-map-contract, grouped-features, spinner and template-integrity specs, 77 pass; `check-feature-parity.ts` passes with no omission entry. Reviewed in `REVIEW-scaffold-skills.md`. The skill-snippet gate was not run (no skill snippet has an import or title, so none is compiled).

### T-134 [feature] Devtools: the Grimoire tab

- Source: owner request and design sessions of 2026-11-16.
- What and why: A Grimoire tab registered through the panel registration of T-123. One search box across flows, blocks, routes, files and tasks; views for a book entry, a feature, a flow, an app page, tasks, releases and the check report; small graphs only; a static export of the book's site for people without the app running. Every string is set as text, and the devtools guard applies to its routes.
- Shipped: 5.55.0 (experimental).
- Verified: `tests/devtools.spec.ts` (11) and `src/devtools/view.spec.ts` (9): 20 pass, including an offline render of the exported page and an `<img onerror>` hit shown as text. Reviewed in `REVIEW-devtools.md`. Not run inside a real `warlock dev` app; the route handlers were called directly.

### T-133 [feature] Grimoire: test results per criterion

- Source: owner request of 2026-11-16 (the whole package in one release).
- What and why: A Vitest reporter at `@warlock.js/grimoire/vitest` records the last result (pass, fail, skipped) of every test marked `// @proves <feature>/<flow> AC-n` in `grimoire/book/test-results.json`. Partial runs merge, and results older than their test file are shown as stale.
- Shipped: 5.55.0 (experimental).
- Verified: `src/test-results/test-results.spec.ts`, `src/vitest/reporter.spec.ts`, and `tests/vitest-reporter.spec.ts`, a real run through `startVitest` on a temp project. Reviewed in `REVIEW-written.md`.

### T-132 [feature] Grimoire apps: sites, mobile apps, pages and blocks

- Source: owner request and design sessions of 2026-11-16.
- What and why: `grimoire/apps/<app>/` for each site and mobile app: named conditions, layouts, pages with a blocks table (flow, who sees it, changes with), and block files for page-specific detail. Mobile apps are discovered from `app.json` or `app.config.*`, with file-based or code-based routing.
- Shipped: 5.55.0 (experimental).
- Verified: `src/apps/check-apps.spec.ts` (12) and `src/warlock/mobile-facts.spec.ts` (6), on the Expo and code-navigated fixtures (`tests/fixtures/apps-expo/`, `tests/fixtures/apps-code-nav/`). Reviewed in `REVIEW-written.md`.

### T-131 [feature] Grimoire tasks and releases

- Source: owner request and design sessions of 2026-11-16.
- What and why: `grimoire/tasks/open/` and `grimoire/tasks/done/<yyyy-mm>/`, one file per task, and `grimoire/releases/<version>.md`. `warlock grimoire release <version>` collects the unreleased changelog entries into the release file and never edits a feature changelog.
- Shipped: 5.55.0 (experimental).
- Verified: `src/releases/releases.spec.ts` and `src/tasks/tasks.spec.ts`: 25 pass, covering collection, re-running an older release without duplicates, a byte-identical second run, and unchanged feature changelog bytes. Reviewed in `REVIEW-book-check.md`.

### T-130 [feature] Grimoire commands, Warlock adapter and MCP tools

- Source: owner request and design sessions of 2026-11-16.
- What and why: The Warlock adapter (facts from `inspectApp()`, named mails, jobs, events and notifications), `registerGrimoireCommands()` for `warlock.config.ts`, the commands `grimoire build`, `grimoire check`, `grimoire release` and `scry` (file, impact, route, feature, flow and search), compact text by default and `--json`, and the matching MCP tools through the registration of T-122. Commands that need only files do not boot the app.
- Shipped: 5.55.0 (experimental).
- Verified: grimoire `tests/scry.spec.ts` with goldens, `tests/warlock-commands.spec.ts`, `tests/warlock-adapter.spec.ts`, `tests/warlock-entry-imports.spec.ts`; core `explain-command.spec.ts`, `cli-commands.manager.plugins.spec.ts`, `collect-files.spec.ts` and `mcp-tool-registry.spec.ts`. Reviewed in `REVIEW-core-web.md` and `REVIEW-book-check.md`.

### T-129 [feature] Grimoire check: the read-only report

- Source: owner request and design sessions of 2026-11-16.
- What and why: `warlock grimoire check` reads everything and edits nothing. Each finding has a stable GR code that `warlock explain` describes, covering broken links from steps, flows, blocks and conditions, criteria without tests, tests pointing at missing criteria (`// @proves`), files no flow reaches, stale README dates and structure errors. Findings for `proposed` work are shown as expected. Exit code 1 only on problems; `--json` is supported.
- Shipped: 5.55.0 (experimental).
- Verified: `src/proves`, `src/check` and `tests/check`: 9 files, 75 pass, one spec per rule (failing and passing), and a check that the docs page lists every code. Reviewed in `REVIEW-book-check.md` and `REVIEW-written.md`.

### T-128 [feature] Grimoire: ownership, book maps and collected indexes

- Source: owner request and design sessions of 2026-11-16.
- What and why: Feature ownership (its folders, `@feature` header tags, file entries; one owner per file) and borrowing, written as `features/<feature>/bookmap.json`, `flows/<flow>.bookmap.json`, `features/index.json` and `tasks/index.json`, rebuilt incrementally. Files with two owners or none are reported.
- Shipped: 5.55.0 (experimental).
- Verified: `src/ownership`, `src/bookmap`, `src/workspace` and `tests/bookmaps.golden.spec.ts`: 5 files, 39 pass, golden files over the shop fixture (`tests/golden/bookmaps/`). Reviewed in `REVIEW-book-check.md`.

### T-127 [feature] Grimoire book: builder, freshness, per-file mirror

- Source: owner request and design sessions of 2026-11-16.
- What and why: `grimoire/book/` written from the adapter's facts: one JSON entry per source file at the source's path, module summaries, `routes.json`, page and screen lists, a fingerprint of source hashes so only changed entries are rebuilt, and a route cache refreshed only when a routes file or its imports change. A no-change run does no work, and file-only questions never boot the app.
- Shipped: 5.55.0 (experimental).
- Verified: `src/book/render.spec.ts` (11) and `tests/book.spec.ts` (17): 28 pass, with 46 golden files (`tests/golden/book/`). Reviewed in `REVIEW-book-check.md`.

### T-126 [feature] Grimoire: the written files and their parser

- Source: owner request and design sessions of 2026-11-16; the templates in the draft skills are the fixed structure.
- What and why: The parser and structure rules for every agent-written file (feature README, CHANGELOG, flows, versions, app README, layouts, pages, blocks, tasks and releases), the step types, `AC-n` criteria and the `<feature>/<flow>` reference. Every malformed case gives a located message with a stable GR code.
- Shipped: 5.55.0 (experimental).
- Verified: 7 spec files, 114 pass (`src/written`, `tests/written`), golden files for the shop and messy fixtures, and one spec per structure code GR1001 to GR1028. Reviewed in `REVIEW-written.md` (203 tests across 17 files, with neighbouring specs).

### T-125 [feature] Grimoire package: skeleton, family wiring, adapter contract

- Source: owner request and design sessions of 2026-11-16.
- What and why: `packages/grimoire` with a framework-neutral root entry (no `@warlock.js/core` or `@warlock.js/web` import), the `./warlock`, `./vitest` and `./devtools` entries, the family wiring in the release tools (34 packages), the docs sidebar and the adapter contract. Typed stubs for the later tasks.
- Shipped: 5.55.0 (experimental).
- Verified: `packages/grimoire`: 8 spec files, 25 pass (`npx vitest run`), including the import-scan spec that guards the root entry; the release-tool family spec and the feature-parity and exports-parity checks. Reviewed in `REVIEW-scaffold-skills.md` (release-tool wiring).

### T-124 [feature] Pages report: setup file, site and full layout chain

- Source: owner request and design sessions of 2026-11-16.
- What and why: The inspect report's pages now carry their setup file, site and the outermost-first layout chain, taken from the web build's page-graph discovery (`discoverPageGraph`) so the report and the build agree.
- Shipped: 5.55.0 (experimental).
- Verified: core `collect-pages.spec.ts` (with a multi-site fixture compared against `discoverPageGraph`) and `inspect-app.spec.ts`: 20 pass; web `src/build`: 413 pass. Reviewed in `REVIEW-core-web.md`.

### T-123 [feature] Devtools: registered panels instead of hard-coded tabs

- Source: owner decision of 2026-11-16 (accepted as public API).
- What and why: A panel registration (a data route under the guarded scope, a tab and a view module), with the Processes panel moved onto it. Packages and the app can register panels through the devtools config.
- Shipped: 5.55.0 (experimental).
- Verified: `tests/panels.spec.ts` (27), `tests/panel-loading.spec.ts` (5), `tests/panels-ui.spec.ts` and a connector case; the guard covers registered routes. The post-review fix for import-only package resolution has its own spec (`POST-REVIEW.md`). Reviewed in `REVIEW-devtools.md`.

### T-122 [feature] MCP server: let packages and the app register tools

- Source: owner decision of 2026-11-16 (accepted as public API).
- What and why: A `tools` option on the MCP server start function and a registration list that `warlock mcp` and `warlock dev --mcp` read, from the Warlock config or from registered commands' packages. Grimoire's MCP tools are the first user.
- Shipped: 5.55.0 (experimental).
- Verified: `src/tooling/mcp/mcp-tool-registry.spec.ts` (10) and `src/dev-server/dev-agent-mcp-tools.spec.ts` (1): a registered tool is listed and called over the server. Reviewed in `REVIEW-core-web.md`.

### T-121 [feature] Inspect report: line counts, header sentence, export comments, more file roles, controller on routes

- Source: owner request and design sessions of 2026-11-16.
- What and why: The inspect report gains each file's line count, header sentence, `@tag` values and the first sentence above each export. New file roles `use-case`, `seed`, `request`, `mail`, `job`, `event` and `client`. A route registered as a controller tuple keeps its controller class and action. The conventions skill now names `.use-case.ts`.
- Shipped: 5.55.0 (experimental). `schemaVersion` stayed 1 (fields only added; the STABILITY rule in `inspect-report.types.ts`). The new fields are optional in the schema, and the JSON schema was regenerated.
- Verified: `collect-files.spec.ts` (14 role cases, plus header, tags, export docs and line counts), `inspect-app.spec.ts` (controller and action on routes; JSON Schema validation) and `router-controller-tuple.spec.ts`: 74 pass across `src/tooling/inspect` and `src/router`. Reviewed in `REVIEW-core-web.md` (a module named after a role word was fixed there).

## 5.54.0 (2026-11-16)

### T-119 [chore] Move to the 2026-11-16 @mongez releases

- Source: the @mongez release session, 2026-11-16. Everything below is published as `latest`. It closes T-115 once it lands.
- What and why: these versions ship the T-115 fixes, plus some changes the framework has to follow.
  - localization and react-localization 3.6.0 add `getTranslationsRevision()` and `localizationEvents.onChange("translations", cb)`; react-localization's `jsxConverter` gets the hyphen-key rule.
  - react-form 4.1.0 (a minor) changes default ids to `<formId>-<name>` and makes `FormInterface.id` optional. Forms now default to `method="post"`, and `validation.*` defaults fill only the missing keys. Length messages get both `:length` and `:maxLength`/`:minLength`.
  - dotenv 2.0.0 is a major with a stricter `.env` grammar. Also published: reinforcements 4.1.0, supportive-is 3.0.1, copper 2.1.4, pkgist 1.7.0, events 2.2.10, http 3.5.2, vite 2.2.3, agent-kit 1.4.0, cache 2.0.2, dom 1.2.7, query-string 1.2.6, react-router 2.8.2, and atom/react-atom/atomic-query 7.0.1.
- Work:
  - Raise the ranges in the package.json files that declare @mongez dependencies. The exact pins are create-warlock/templates/warlock localization 3.5.1, react-form 4.0.0 in create-warlock and the design-system templates, and tools/release pkgist 1.6.5.
  - Remove the T-115 workaround text from docs and skills, and drop core's `:length` mapping.
  - Build core's `bumpTranslationsRevision()` on the localization revision event.
  - Check every `.env` template against the dotenv 2.0 grammar.
  - Consider whether pkgist's `sourcemap: { excludeSources: true }` can replace `tools/release/scripts/strip-source-map-sources.ts`.
- Unconfirmed: React `useId` must match between server render and hydration on a real Web page, because default control ids now depend on it. Check one page after hydration.
- Acceptance: install and lock updated, typecheck and affected specs green, a CHANGELOG bullet in each package touched, and one hydrated page checked for an id mismatch.
- Shipped: 5.54.0 (2026-11-16). Every @mongez range and exact pin raised; the translations revision follows the library's change event; `:length` alias kept (the library's default texts still use it); `strip-source-map-sources.ts` kept (pkgist's `excludeSources` drops `sourcesContent`, which its gate requires).
- Verified: `packages/web/src/client/form-control-ids-hydration.spec.ts` (server render + `hydrateRoot`, no mismatch warnings, ids unchanged), `packages/core/src/localization/translations-revision.spec.ts`; typecheck, lint and the full test pass (22,053 tests) green.

### T-115 [chore] Three defects live in the libraries the web package depends on

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: three behaviours reported against the framework are in dependencies and are fixed in those libraries'
  own repositories, not here. Installed versions: `@mongez/localization` 3.5.1 and `@mongez/react-form` 4.0.0. Keep this
  entry until the fixed versions are released and the framework's ranges are raised.
  1. Placeholder names swallow a following hyphen (localization): the colon pattern is `/:([a-zA-Z0-9_-]+)/g`, so
     `:minutes-min` is one placeholder named `minutes-min`, no value is found, and the template is left unchanged (`_x`
     joins too). Workaround: avoid `-` or `_` right after a placeholder (`":minutes min"`), pass the joined name as the
     key (`{ "minutes-min": 5 }`), or set `setLocalizationConfigurations({ placeholderPattern: "doubleCurly" })`, which
     switches every colon message in the process (framework messages included), or a custom pattern such as
     `/:([a-zA-Z0-9_]+)/g` (loses hyphenated names). Files: `esm/placeholder-pattern-config.mjs:2-8`, `esm/converters.mjs:5-11`
     in the installed package.
  2. Plural fallback order (localization, global-registry path): for a count the library tries the current locale's
     specific variant, then the fallback locale's specific variant, then the current locale's `_other`. A locale that
     defines only `_other` shows the fallback locale's `_one` text for count 1. Route dictionaries (`transFromKeywords`,
     used by `useTrans` and the request route translations) have no fallback locale and are not affected.
     Workaround: define every variant the locale's rules can select in each locale (Arabic: `_zero`, `_one`, `_two`,
     `_few`, `_many`, `_other`), or use route dictionaries. File: `esm/translator.mjs:156-181`. Framework call sites:
     `packages/web/src/localization.tsx:105-117`, `:136-144`; `packages/web/src/server/request-route-translations.ts:19-30`.
  3. Form control ids collide across forms (react-form): the default id is `input-<name>` and the error id
     `input-<name>-error`, derived from the field name only, so two forms on one page with a field `email` duplicate the
     ids (broken `label for`, `aria-describedby`, anchors); a nameless control uses a random id that differs between
     server and client. Workaround: pass an explicit `id` per control (for example from a per-form `useId()`); the error
     id follows. Files: `esm/hooks/form-hooks.mjs:12-18`, `esm/hooks/useFormControl.mjs:43-47`.
- Evidence: the files above under `node_modules/.pnpm/@mongez+localization@3.5.1/node_modules/@mongez/localization/`
  and `node_modules/.pnpm/@mongez+react-form@4.0.0_react@19.2.8/node_modules/@mongez/react-form/`.
- Acceptance: once the libraries release fixes, raise the dependency ranges, remove the workarounds from the docs and
  skills that mention them, and add a changelog line; until then the docs for placeholders, plurals and form ids should
  name the workaround above.
- Shipped: fixed in @mongez/localization 3.6.0, @mongez/react-localization 3.6.0 and @mongez/react-form 4.1.0 (published 2026-11-16); the framework moved to them in 5.54.0 (2026-11-16).
- Verified: library specs `placeholders-and-plural-order.test.ts` (18) and `controlIds.test.tsx` (11); the framework's hydration spec above.

### T-075 [chore] Stable codes for the deployment warnings of `warlock doctor`

- Source: security and performance audit of 2026-11-11.
- What and why: the nine deployment checks name the setting to change but carry no `WL` code, unlike other doctor
  results.
- Evidence: `packages/core/src/cli/commands/doctor/checks/index.ts:1-62`; `packages/core/src/errors/error-codes.ts`.
- Acceptance: one code per check, listed on the error-codes docs page; specs updated.
- Shipped: 5.54.0 (2026-11-16). WL1011 to WL1018 for the eight warning checks, WL1020 for the compression check (on its line when compression is off).
- Verified: doctor check specs (core `src/cli` + `src/errors`, 306 pass); typecheck, lint and the full release gate green.

### T-118 [bug] `warlock check` reports the test step blocked with `vitest exited with 143`

- Source: application upgrade report of 2026-11-13. Under a memory-capped wrapper the check's "tests" step ended
  `blocked` (exit 143, SIGTERM) while a standalone `npx vitest run` passed; the command exited 2 with a green suite.
- What and why: 143 means the child was killed. Likely the check's own time limit for the test step, or the
  wrapper. Find which; if it is the check's limit, make it configurable and say "timed out after N s" instead of
  "blocked".
- Evidence: `packages/core/src/cli/commands/check/check-command.action.ts`, `check/child-typecheck.ts:60`.
- Acceptance: the cause is named; a killed or timed-out test child is reported as such with the limit and how to
  raise it; spec covers a child that is killed.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core tooling/check tests-step.spec.ts (including a real killed child); typecheck, lint and the full release gate green (verify and review passes).

### T-117 [bug] `warlock update` rewrites `package.json` before the install has succeeded

- Source: application upgrade report of 2026-11-13. Under npm 10.9.9 the install failed with
  `Cannot read properties of null (reading 'edgesOut')` after `package.json` had already been rewritten.
- What and why: the npm crash is npm's own bug, but a failed install leaves the app with new versions in
  `package.json` and an old lock. The command should restore `package.json` (or say exactly how to finish), and
  check the package manager version it needs before it starts.
- Evidence: `packages/core/src/cli/commands/update.command.ts:9-22` (`updateWarlockPackages`, `install-failed`).
- Acceptance: on a failed install `package.json` is restored (spec with a failing fake package manager) or the error
  names the recovery command; a too-old npm is refused up front with the required version.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core updater/update-warlock-packages.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-116 [bug] `v.file().mimeType()` leaves `:types` unfilled in its message

- Source: application upgrade report of 2026-11-13 (5.47.2 → 5.53.1), re-checked against the source on 2026-11-16.
- What and why: the rule's message is `"The :input must be a :types file"`, but the allowed list is stored as
  `options.mimeTypes`, so nothing fills `:types` and the 422 body reads `"The File must be a :types file"`. The same
  report says a translation key passed as `errorMessage` was returned literally (`admin.uploadUnrecognisedMedia`);
  check that too.
- Evidence: `packages/core/src/validation/file/file.ts:105-110`; `packages/core/src/validation/validators/file-validator.ts:85-88`.
- Acceptance: the message lists the allowed types (joined with ", "); a spec covers a string and an array; a
  translation key given as `errorMessage` is translated (or the docs say how to pass one); changelog notes the
  400 → 422 change for apps that relied on their own check.
- Shipped: 5.54.0 (2026-11-16).
- Verified: seal tests/unit/validators/error-message-key.test.ts and core validators file-mime-type-message.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-114 [decision] Unknown API routes answer a fixed English body with no error code

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: a request that matches no route and does not ask for HTML gets
  `{"error":"Route not found","path":"...","method":"GET"}` with status 404 (also in multi-site mode, where the status
  is the refusal status when there is one). The body is a literal in the catch-all: no error code, no translated
  message, no request id, and `web.errors` / `http.errorMapper` are not consulted. An API client that switches on error
  codes cannot tell it from other 404s, and an app with its own error shape gets a second shape for this one case. The
  response event cannot change the body.
- Evidence: `packages/web/src/server/not-found-page.ts:414-424` (and `classifyUnmatchedRequest` at `:201`);
  `packages/web/src/server/site-dispatch.ts:198-200`, `:217-219`; `packages/core/src/http/response.ts:622-624`;
  `packages/web/src/server/not-found-page.ts:85` (the catch-all is the last route, so an app `/api/*` catch-all route
  would win, not tested).
- Options: (a) keep the shape for compatibility and document the workaround; (b) send the shape the rest of the API
  uses (a code such as `route_not_found`, a message through `request.t`, the request id) from one shared helper used by
  all three sites, keeping `path` and `method`; (c) route it through `http.errorMapper` so the app owns the shape.
- Recommendation: (b), and (c) later if apps need to replace it entirely. Keep `error` as the human message so existing
  clients that read it keep working; add `code` and `requestId` as new fields.
- Acceptance: the chosen body from one helper at all three sites; specs in single-site and multi-site mode, with a
  translated message per locale; docs and changelog (upgrade note if `error` text changes).
- Owner decision (2026-11-16): option (b); unknown API routes answer the app's error shape.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web route-not-found-response.spec.ts, not-found-page.spec.ts, site-dispatch.spec.ts and install-page-routes-from-manifest.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-113 [decision] `web.robots` is one policy for every site

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: `web.robots` holds one set of groups and extra lines, served unchanged for every host. Only the
  `Sitemap:` line and the "dynamic site that is not indexable" answer vary per site. Two fixed sites that need different
  crawl rules (one with `Disallow: /admin`, the other open) cannot be expressed; a hand-written `public/robots.txt` is
  also one file for all hosts and makes web register no route.
- Evidence: `packages/web/src/configurations.ts:62` (`robots?: RobotsConfig`);
  `packages/web/src/sitemap/robots-config-types.ts:17-26` (`enabled`, `referenceSitemap`, `groups`, `extra`);
  `packages/web/src/sites/site-config.types.ts` (no `robots` key); `packages/web/src/sitemap/register-robots-route.ts:57-81`
  (config read once, same groups for every host; per-site only the sitemap URL and the non-indexable answer).
- Options: (a) keep one policy and document the app-route workaround; (b) accept `robots` under each site in `sites`
  (and in `resolveHost` results) and merge it over `web.robots` inside the `/robots.txt` handler; (c) accept a
  function `robots(site)` returning a `RobotsConfig`.
- Workaround today: leave `web.robots.enabled` false and register an app route `GET /robots.txt` that switches on the
  request host or `request.site` (not tested).
- Recommendation: (b): the site is already selected in that handler, and the merge is small.
- Acceptance: the chosen shape with specs (two sites, different groups; a site without `robots` gets the global one),
  docs on sites and sitemap/robots, the `generate-sitemap` skill and a changelog entry.
- Owner decision (2026-11-16): option (b); a per-site `robots` policy.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web register-robots-route.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-112 [decision] `request.validated()` returns `{}` on a route with no schema

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: `validated()` returns the validated data when validation ran, otherwise an empty object, with no log
  and no error. A webhook handler that calls `request.validated()` on a route without a schema sees `{}` for a real JSON
  body and gets no signal that the schema is missing. The behaviour is documented ("returns `{}`"), so this is a choice,
  not a defect.
- Evidence: `packages/core/src/http/request.ts:1308-1319`; `packages/core/src/validation/validateAll.ts:187-188` (the
  only place the data is set); `docs/src/content/docs/v/latest/core/the-basics/http-request.md:88`.
- Options: (a) keep, no change; (b) log one development warning per route when `validated()` is called on a route
  with no schema, and return `{}` as today; (c) throw in development and test, return `{}` in production; (d) add a
  strict variant (`request.validatedOrFail()`) and leave `validated()` alone.
- Recommendation: (b): it catches the mistake early without breaking handlers that rely on `{}` (for example optional
  validation). Document `input()` / `all()` as the reads for schema-less routes.
- Acceptance: the chosen behaviour with a spec (warning once per route, none when a schema exists), the docs line
  updated, changelog entry.
- Owner decision (2026-11-16): option (b); a development-only warning, once per route.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core http/request-validated-warning.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-111 [decision] Request locale order: a stale `locale` cookie wins over an explicit `locale` header

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the locale is resolved as query, preference cookie, `locale` cookie, `locale` header, default. A client
  that keeps a cookie jar and also sends a `locale` header (a native app on an HTTP client) gets the cookie's locale:
  `Cookie: locale=en` with `locale: ar` and `app.localeCodes: ["en","ar"]` gives `request.locale === "en"`. The cookie is
  server-persisted state; the header is an explicit per-request signal. No setting changes the order.
- Evidence: `packages/core/src/http/request.ts:508-529` (`resolveLocale`), `:534` (cached getter), `:543-552`
  (`setLocaleCode`); `packages/core/src/config/locale-configuration.ts:10` (cookie name);
  `packages/web/src/locale-preference.ts`; `packages/web/src/server/page-route-handler/persist-requested-locale.ts`
  (reads `request.locale`, no order of its own).
- Options: (a) move the `locale` header before the `locale` cookie (the preference cookie stays ahead of both, or goes
  after the header too, to decide); (b) keep the order and add `http.locale.sources`, an ordered list the app sets;
  (c) keep as is and only document it (T-109).
- Recommendation: (a) for the `locale` cookie vs `locale` header pair, with an upgrade note; it changes behaviour only
  for requests that send both with different values. Add (b) later only if an app needs another order.
- Acceptance: the chosen order ships with a spec pinning every pair, the corrected pages from T-109, a skill update and
  a changelog upgrade note.
- Owner decision (2026-11-16): option (a); the explicit `locale` header wins over the `locale` cookie, and the preference cookie stays ahead of both.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core http/request-locale-order.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-110 [bug] The `http.bodyLimit` type comment still says the default is 200 GB

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the doc comment editors show on hover for `http.bodyLimit` says `@default 200 * 1024 * 1024 * 1024`
  ("200GB, historical default") and points per-route limits at the `maxBodySize()` middleware. The server passes
  `bodyLimit` to Fastify only when configured, so an unconfigured app gets Fastify's own 1 MiB (the dev dispatcher uses
  the same fallback), and per-route limits belong to `serverOptions.bodyLimit` (`maxBodySize()` runs after parsing and
  does not bound chunked bodies). The docs pages and the scaffold are already right.
- Evidence: `packages/core/src/http/types.ts:415-425` (comment); `packages/core/src/http/server.ts:91`, `:116-119`
  (the real behaviour); `packages/core/src/router/router.ts:1314` (dev fallback);
  `docs/src/content/docs/v/latest/core/digging-deeper/security.md:378` (correct).
- Workaround: set `bodyLimit` explicitly in `src/config/http.ts` and ignore the hover text.
- Smallest fix: change the comment to "@default Fastify's own 1 MiB (1048576)" and point per-route limits at
  `serverOptions.bodyLimit`.
- Acceptance: the comment matches the runtime; `packages/core/CHANGELOG.md` entry; the docs-text gate passes.
- Shipped: 5.54.0 (2026-11-16).
- Verified: docs build (type comment only); typecheck, lint and the full release gate green (verify and review passes).

### T-109 [bug] Docs and skill describe a request-locale order the code does not use

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: several pages say the locale is read first from a `translation-locale-code` header, then the `locale`
  header, then `?locale=`, then the default, and show a getter that reads that header. No source file reads
  `translation-locale-code`. The real order in `Request.resolveLocale` is: `?locale=` query, the `warlock.locale-preference`
  cookie (only when it is in `app.localeCodes`), the `locale` cookie, the `locale` header, then `app.localeCode`
  (a value outside a declared `app.localeCodes` falls back to the default). Cookies are not mentioned in any of these
  pages. An app that follows the docs and sends the documented header gets no effect. (Whether the order itself should
  change is T-111.)
- Evidence: `packages/core/src/http/request.ts:508-529` (the real order); stale text in
  `docs/src/content/docs/v/latest/core/the-basics/http-request.md:346-350`,
  `docs/src/content/docs/v/latest/core/the-basics/localization.md:30-79`, `:283`, `:294`, `:336`,
  `docs/src/content/docs/v/latest/core/upgrade-to-v5.mdx:212`, `docs/src/content/docs/v/latest/core/recipes/localized-responses.md:51-54`
  (omits cookies and the preference cookie), `packages/core/skills/use-localization/SKILL.md:170-175`.
- Workaround: follow the order in `resolveLocale`, not the pages; to force a locale, send `?locale=<code>` or call
  `request.setLocaleCode(...)` early.
- Smallest fix: rewrite each passage to the five-step order above (or, if T-111 changes the order, to the new one),
  remove the `translation-locale-code` header and the getter listing, and state the `app.localeCodes` allow-list.
- Acceptance: the pages and the skill agree with `resolveLocale`; no remaining mention of `translation-locale-code`
  outside a changelog; a spec pins the order (query, preference cookie, locale cookie, header, default) so the docs
  cannot drift again; core changelog entry under documentation.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core http/request-locale-order.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-108 [bug] A noindex 404 page still emits `hreflang` alternates

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the not-found page is rendered with `robots: noindex`, and `enrichMetadata` already skips canonical,
  `og:url` and `og:locale` for a noindex page. The locale alternates are computed separately, without looking at
  `robots`, so with prefix locale routing a request to `/en/missing` answers 404 with `<meta name="robots" content="noindex">`
  and `<link rel="alternate" hreflang="en|ar|x-default">` pointing at non-existent URLs. A page that sets `robots: "noindex"`
  itself does the same. Search engines are told a page is not to be indexed and also that it has translations.
- Evidence: `packages/web/src/server/render-page.ts:1301-1303` (noindex set), `:1313-1318` (alternates computed
  without the robots value), `:1343-1345` (an empty `metadata.alternates` does not suppress the generated set);
  `packages/web/src/metadata/enrich-metadata.ts:53-65` (`isNoindex`, not exported, gates only the metadata path);
  `packages/web/src/components/head.ts:98-105` (renders one link per alternate);
  `packages/web/src/server/resolve-locale-alternates.ts:95-125` (gates on strategy, origin and codes only).
- Workaround: none short of locale strategy `none`, which removes hreflang everywhere.
- Smallest fix: export `isNoindex` and pass no alternates when the resolved `robots` is noindex.
- Acceptance: a spec renders the not-found page and a page with `robots: "noindex"` under prefix routing and finds no
  `hreflang` link, while an indexable page keeps them (`render-page-metadata-alternates.spec.ts`); the metadata page and
  `set-page-metadata` skill state it; changelog entry.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web render-page-metadata-alternates.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-107 [bug] Refusal pages render without layout and root, without the URL locale, and without a request id

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: since 5.39.0 a refused browser request (403/400 from core, such as a traversal path) gets the site's
  `forbidden`/`error` page instead of raw JSON. That page is rendered through the failure renderer, outside the page
  pipeline: it is wrapped in the default app only, so the app's root and the nearest layouts (header, footer) are
  missing; the locale comes from core's lazy resolution (query, cookies, header, default) and ignores the URL prefix, so
  `/ar/...` is answered in the default locale (the not-found path pins the prefix locale, the refusal branch returns
  before that); and the request id reaches the visitor only on the last-resort boundary, not on a site error page
  (a refusal is a visitor-safe 4xx, so no id is carried in the props).
- Evidence: `packages/web/src/server/core-refusal-page.ts:44-75`; `packages/web/src/server/render-page.ts:1770` (`renderPageFailure`),
  `:1840-1856` and `:1870-1877` (default app only; the id only on the framework boundary); `packages/web/src/server/not-found-page.ts:350-397`
  (refusal branch) and `:426-432` (prefix locale pinned only afterwards); `packages/web/src/server/error-page.ts:131-138`
  (id carried only for non-visitor-safe errors).
- Workaround: make the site's `forbidden.page.tsx` / `error.page.tsx` render its own shell and read the locale with
  `useLocale()`. There is no public way to put the request id into that page for a 4xx.
- Smallest fix: pin the URL-prefix locale in the refusal branch (reuse the not-found code), carry `request.id` in the
  serialized props for 4xx failures, and render the failure through the root and the nearest layouts when they load.
- Acceptance: specs for a refusal on a prefixed URL (locale from the prefix), a site with a layout (layout markup
  present around the forbidden page) and a site error page (request id available to the page); docs for
  special pages and the `localize-pages`/special-pages skill say what a refusal page receives; changelog entry.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web core-refusal-page.spec.ts and install-page-routes-from-manifest.spec.ts (loadShell); typecheck, lint and the full release gate green (verify and review passes).

### T-106 [bug] The error-response hook and the refusal dispatcher have no guard for a reply already sent

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: with `http.errorResponse` set, a refused browser request on a page host (for example a path-traversal
  `GET` with `Accept: text/html`) was reported to end in `ERR_HTTP_HEADERS_SENT`. The mechanism could not be
  reproduced: the HTML refusal reply is not JSON, so the formatter returns it untouched, and returning `reply` from
  the route error handler is safe. What the code does show is a missing guard in two places: the `onSend` formatter
  never checks `reply.sent`, `reply.raw.headersSent` or `writableEnded`, and `Router.dispatchRefusal` decides "nothing
  was sent" from `reply.sent` alone, which stays `false` while an async `onSend` hook is pending. A throw after
  `response.html()` has been called is then treated as unsent, and the caller sends a second reply through the root
  error handler. No spec combines `http.errorResponse` with a refusal; the specs for each side use a bare Fastify.
- Evidence: `packages/core/src/http/error-response.ts:39-48` (hook, no sent check);
  `packages/core/src/router/router.ts:1481-1510` (`dispatchRefusal`, the `catch` at `:1499-1504`);
  `packages/core/src/http/lazy-static.ts:244-260` (the error handler that calls it);
  `packages/web/src/server/core-refusal-page.ts:48-71` (writes the page); `packages/core/src/http/error-response.integration.spec.ts`,
  `packages/core/src/router/refusal-route.spec.ts`, `packages/core/src/http/refusal-dispatch.spec.ts` (each one side only).
- Workaround: none needed if it does not reproduce; if it does, serve the JSON refusal (the formatter then formats it)
  by not registering a page that handles refusals.
- Smallest fix: return the payload at the top of the hook when `reply.sent || reply.raw.headersSent || reply.raw.writableEnded`;
  in `dispatchRefusal`'s catch test `fastifyReply.sent || fastifyReply.raw.headersSent`.
- Acceptance: an integration spec over a real socket (a bare `inject` normalises dot segments away) with
  `Accept: text/html`, `http.errorResponse` set and a refusal-handling route registered, answering 403 once with the
  page body; a spec for each guard; changelog entry. If the reported error still occurs on 5.53.1, capture the first
  stack frame and update this entry before fixing.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core router/refusal-route-error-response.spec.ts (real socket), http/error-response.spec.ts and web not-found-page.spec.ts. The reported mechanism was not reproduced, so the guards are defensive; typecheck, lint and the full release gate green (verify and review passes).

### T-105 [bug] Development and test servers drop a route's `serverOptions.config` without a warning

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the production scan merges `route.serverOptions.config` into each route's Fastify config. The
  development scan registers one wildcard route per verb with `config: { rateLimit: false }` only, so the route's
  config never reaches Fastify plugins that read it, for example `multipartOptions` (a per-route file-size limit).
  Under `warlock dev` and the HTTP test server started by the test global setup (both use the development scan), a
  route that raises its per-file limit this way gets 413 from the global `http.fileUploadLimit` while the production
  build accepts the file. The dev refusal list of unsupported options does not include `config`, so no boot warning
  appears, and the `serverOptions` doc comment does not list it among the options not applied in dev.
  The in-process helpers (`createTestHttpServer`, the integration harness) use the production scan and are not affected.
  The route-level `uploads: { maxTotalSize }` option works in dev; it covers only the total size, not per-file, file
  count or field limits.
- Evidence: `packages/core/src/router/router.ts:1213-1224` (production merge), `:1249` (`scanDevServer`), `:1431`
  (dev config); `packages/core/src/router/dev-body-limit.ts:148-162` (`UNSUPPORTED_DEV_SERVER_OPTIONS`, no `config`);
  `packages/core/src/router/types.ts:232-264` (doc comment); `packages/core/src/connectors/http-connector.ts:195-199`
  (dev scan chosen for the development runtime); `packages/core/src/tests/start-http-development-server.ts`;
  `docs/src/content/docs/v/latest/core/testing/integration-tests.md:332`; `packages/core/src/http/multipart.ts:82-97`
  (plugin limits set once from `http.fileUploadLimit` and `http.multipart.*`).
- Workaround: raise `http.fileUploadLimit` globally for development and enforce the stricter per-route size in the
  schema (`v.file().size(...)`); use `uploads: { maxTotalSize }` for the total.
- Smallest fix: add `config` to `UNSUPPORTED_DEV_SERVER_OPTIONS` (one warning per route) and name it in the doc comment;
  better, extend `uploads` with per-file size and count limits and apply them in the dev dispatcher too.
- Acceptance: a spec in `dev-body-limit.spec.ts` shows the warning for a route with `serverOptions.config`; the
  `serverOptions` doc comment, the routing page and the integration-test page list it (or, if the option is
  implemented, a spec shows a per-route per-file limit working under the dev dispatcher); changelog entry.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core multipart.spec.ts and dev-body-limit.spec.ts; web page-action-uploads-declared.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-104 [bug] `config.translations` is rejected by the page-module key list

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the `translations` declaration is typed (`PageConfig`, `LayoutConfig`, `RootConfig`), documented in
  the localization page and the `localize-pages` skill, and read by the translation analyzer, but the module-config
  reader's allow-list has no `translations` key for a page, layout or root. A page file or its `*.setup.ts` with
  `export const config = { route: "/x", translations: ["a.*"] }` fails discovery with
  ``config key `translations` is not allowed in a page module``. The only spec that uses a setup-file declaration
  calls the analyzer directly, so nothing caught the mismatch.
- Evidence: `packages/web/src/module-config-schema.ts:14-37` (`MODULE_CONFIG_KEYS`, no `translations`);
  `packages/web/src/build/read-module-config.ts:54-58`, `:236-239` (the thrown message);
  `packages/web/src/build/discover-pages.ts:773`, `:800-810` (page file and setup companion both checked);
  `packages/web/src/page-config.ts:94`, `:121`, `:144` (the type accepts it);
  `packages/core/src/localization/translation-usage-graph.ts:65-74`, `:118-130` and
  `packages/web/src/build/translation-manifest.ts:143-148` (the analyzer accepts it);
  `packages/web/skills/localize-pages/SKILL.md:59-70`; `docs/src/content/docs/v/latest/web/essentials/09-localization.mdx:309`,
  `:324`.
- Workaround: list dynamically read keys as key-shaped string literals in a constant inside a component the page
  imports (a literal ending in a dot is a prefix); or set `build.translations.prune: false` to ship every group.
- Smallest fix: add `"translations"` to the page, layout and root lists in `MODULE_CONFIG_KEYS`.
- Acceptance: `read-module-config.spec.ts` reads a page, a layout and a root setup file with the array form and the
  `{ keys, exhaustive }` form; a discovery-level spec shows the declared keys reach the manifest; `packages/web/CHANGELOG.md`
  entry.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web read-module-config.spec.ts, normalize-page-module.spec.ts and discover-pages.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-103 [bug] OpenAI quota exhaustion on a 429 is mapped to a retryable rate limit

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: the OpenAI error mapper treats only `code === "insufficient_quota"` as spent credit. A 429 whose body
  has `type: "insufficient_quota"` but another `code` (for example `credit_balance_exhausted`) falls through to the
  status-429 branch and becomes `ProviderRateLimitError`, which is retryable. `retryModel` and workflow retry then
  repeat a call that cannot succeed, and the error no longer says the account is out of credit. `billing_hard_limit_reached`
  is never `QuotaExceededError` (a 400 gives `InvalidRequestError`, a 429 gives the rate-limit error). `type` is read
  and stored in `error.context.type` but never used for the decision. The Anthropic mapper already decides on
  `type === "billing_error"` before the 429 branch.
- Evidence: `packages/ai-openai/src/utils/wrap-openai-error.ts:71-73` (quota branch on `code` only), `:75-81` (429
  branch); `packages/ai-anthropic/src/utils/wrap-anthropic-error.ts:78-80` (the type-based check, before the 429
  branch); `packages/ai-openai/src/utils/wrap-openai-error.spec.ts:101-112` (only `status: 429, code: "insufficient_quota"`
  is covered); `packages/ai/src/errors/quota-exceeded-error.ts:8` (documented as not retryable).
- Workaround: read `error.context.type` / `error.context.code` in the app's own `retryOn` predicate and treat
  `insufficient_quota` as fatal. The class and the `retryable` flag stay wrong for framework-level retry.
- Smallest fix: before the 429 branch, map to `QuotaExceededError` when `shape.code === "insufficient_quota"`,
  `shape.type === "insufficient_quota"` or the code is one of `credit_balance_exhausted`, `billing_hard_limit_reached`,
  `billing_not_active`.
- Acceptance: specs for a 429 with `type: "insufficient_quota"` and another code, and for `billing_hard_limit_reached`
  on 400 and 429, all giving `QuotaExceededError`; the existing rate-limit cases still give `ProviderRateLimitError`;
  `packages/ai-openai/CHANGELOG.md` entry. Whether the default fallback chain should advance on exhausted credit stays
  as today (`PROVIDER_QUOTA_EXCEEDED` is not in the default set); note it in the changelog.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai-openai wrap-openai-error specs (spent credit, plain 429); typecheck, lint and the full release gate green (verify and review passes).

### T-102 [bug] A caller's own abort starts the fallback chain

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: when the caller aborts a call, the OpenAI and Anthropic adapters reject with a plain `ProviderError`
  (`PROVIDER_ERROR`, which is in the default failover set) because neither mapper recognises the SDK's user-abort
  error. `fallbackModel` records it in `lastAttempts` and calls the next model with the same already-aborted signal.
  Adapters that honour the signal contract then fail at once, so the visible damage is a spurious attempt and a final
  error that comes from the backup model instead of the abort; an adapter or mock that ignores the signal makes a real
  wasted call. `retryModel` already stops on a cancel (`isAbortError` or `category === "cancelled"`); `fallbackModel`
  has no equivalent and the adapters never mark the abort as cancelled.
- Evidence: `packages/ai/src/model/fallback-model.ts:207` and `:263` (no look at `options.signal`);
  `packages/ai/src/model/retry-model.ts:141` (the cancel check `fallbackModel` lacks);
  `packages/ai-openai/src/utils/wrap-openai-error.ts:111` and `packages/ai-anthropic/src/utils/wrap-anthropic-error.ts:108`
  (the abort falls through to `new ProviderError`); `packages/ai-openai/src/model.ts:175`, `:268`;
  `packages/ai-anthropic/src/model.ts:1349`; `packages/ai-openai/src/responses-model.spec.ts:1474-1507` (pins the
  `ProviderError` result for an aborted stream, `cause` an `APIUserAbortError`).
- Workaround: build the `fallbackModel` per request and close over that request's signal in `retryOn` (re-adding the
  default codes, see T-101): `retryOn: (e) => !signal.aborted && isDefaultFailover(e)`. A shared long-lived chain
  cannot do this because the predicate does not receive the call options.
- Smallest fix: in `FallbackRun.complete` and `FallbackRun.stream`, rethrow when `options?.signal?.aborted` before
  consulting `shouldRetry`; in both adapter mappers, detect the SDK's user-abort error and return an error with
  `category: "cancelled"` carrying the `AbortError` name.
- Acceptance: a spec aborts the first model mid-call and shows one attempt, no second call, and the abort error
  surfacing; adapter specs map the SDK abort to the cancelled category; the spec at `responses-model.spec.ts:1474-1507`
  is updated; `retryModel` and workflow retry still stop on it; changelog entries in `@warlock.js/ai`,
  `@warlock.js/ai-openai`, `@warlock.js/ai-anthropic`.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai fallback-model.spec.ts, responses-model.spec.ts (aborted stream) and the ai-openai, ai-anthropic, ai-google, ai-ollama and ai-bedrock error-wrap specs; typecheck, lint and the full release gate green (verify and review passes).

### T-101 [bug] `fallbackModel({ retryOn })` replaces the default failover codes; docs call it additive

- Source: application upgrade and integration report of 2026-11-12, re-checked against 5.53.1 on 2026-11-13.
- What and why: both forms of `retryOn` (a code list and a predicate) replace the built-in set instead of adding to
  it. `ai.fallbackModel([a, b], { retryOn: (error) => error instanceof MyError })` stops failing over on rate limits,
  overloaded, timeout and 5xx provider errors, so `b` is never tried when `a` is down. The type comment and the recipe
  page say both forms are "additive over the default", and the default set is not exported, so an app cannot compose
  with it and has to copy the list (it already grew once, with `PROVIDER_OVERLOADED` in 5.53.0). The type comment also
  lists the default without `PROVIDER_OVERLOADED`, and the resilience page contradicts itself ("widening `retryOn`").
- Evidence: `packages/ai/src/model/fallback-model.ts:95-104` (`resolveShouldRetry`: a function is returned as is, a
  list replaces `DEFAULT_RETRYABLE_CODES`); `:29-34` (the default, module-private, not exported from
  `packages/ai/src/model/index.ts`); `:207` and `:263` (the gate `isLast || !this.shouldRetry(error)`);
  `packages/ai/src/contracts/fallback-model.contract.ts:19-23` ("additive") and `:29` (default list without
  `PROVIDER_OVERLOADED`); `docs/src/content/docs/v/latest/ai/recipes/cost-provider-fallback.md:96` ("additive over
  the default"); `docs/src/content/docs/v/latest/ai/best-practices/resilience.md:165` and `:359`;
  `packages/ai/skills/ai-dx-helpers/SKILL.md:106-107` (both forms shown, replacement never stated).
- Workaround: write the default set in the app and combine it with the extra reason:
  `retryOn: (e) => (e instanceof AIError && ["PROVIDER_RATE_LIMIT", "PROVIDER_OVERLOADED", "PROVIDER_TIMEOUT", "PROVIDER_ERROR"].includes(e.code)) || isMyReason(e)`.
  The list must be kept in step by hand.
- Smallest fix: export the default set (or a `defaultFallbackRetryOn(error)` predicate) from the model barrel; say
  "replaces" in the contract comment, the recipe and the skill, and add `PROVIDER_OVERLOADED` to the comment's list.
  Optionally accept an additive form (`retryOn: { also: fn }`).
- Acceptance: the default is importable from `@warlock.js/ai`; a spec shows a predicate and a list each replace the
  default and that composing with the exported default keeps the standard failover; the contract comment, recipe,
  resilience page and `ai-dx-helpers` skill say "replaces" and name the export; `packages/ai/CHANGELOG.md` entry
  (skill-coverage gate passes for the new export).
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai fallback-model specs (predicate, list replace, alsoRetryOn); typecheck, lint and the full release gate green (verify and review passes).

### T-077 [chore] Dev server host refusal points at the wrong setting

- Source: security and performance audit of 2026-11-11.
- What and why: a host refused by the dev server gets the bundler's own message telling the user to edit
  `server.allowedHosts` in a bundler config file; in a Warlock app the setting is `web.devAllowedHosts`.
- Evidence: `packages/web/src/vite/dev-server-config.ts:550-576`.
- Acceptance: the refusal names `web.devAllowedHosts` (a pre-middleware with the same host check, or a rewritten
  403 body); spec.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web vite/host-refusal-plugin.spec.ts (real Vite middleware server); typecheck, lint and the full release gate green (verify and review passes).

### T-076 [chore] Failure-path `Vary` header misses the new tokens

- Source: security and performance audit of 2026-11-11.
- What and why: page failures still send the older `Vary` (no `Cookie, locale` or `cache.varyHeaders`). Harmless
  while those responses are `no-store`, but inconsistent.
- Evidence: `packages/web/src/server/page-route-handler/write-page-failure-response.ts:87-91`.
- Acceptance: the failure path passes the same inputs as the normal path; spec.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web write-page-failure-response.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-074 [chore] Export the `ContextStorage` type

- Source: security and performance audit of 2026-11-11.
- What and why: a context's protected `storage` is now typed `ContextStorage`, which the package does not export, so
  subclasses cannot name it.
- Evidence: `packages/context/src/shared-storage.ts:25`; `packages/context/src/base-context.ts:81`.
- Acceptance: type exported from the barrel and named in the context skill (skill-coverage gate passes).
- Shipped: 5.54.0 (2026-11-16).
- Verified: docs build and the context type export; typecheck, lint and the full release gate green (verify and review passes).

### T-073 [chore] Stale documentation text

- Source: security and performance audit of 2026-11-11.
- What and why: (1) the dirty-tracking page says writing an equal value makes the field dirty; the tracker reports it
  clean; (2) the `ai.guardrail` doc comment lists the detector factories without `links`.
- Evidence: `docs/src/content/docs/v/latest/cascade/architecture-concepts/dirty-tracking.md:166-170`;
  `packages/ai/src/ai.ts:232-233`.
- Acceptance: both texts match the code.
- Shipped: 5.54.0 (2026-11-16).
- Verified: docs build and the public-text gate; typecheck, lint and the full release gate green (verify and review passes).

### T-072 [feature] App-wide date output default for resources

- Source: security and performance audit of 2026-11-11.
- What and why: each resource date field builds the full date object (several formats) unless the field calls
  `dateOptions()`; apps that only need ISO strings must repeat it per field.
- Evidence: `packages/core/src/resource/resource-field-builder.ts:60`, `:167`, `:246`.
- Acceptance: `resource.dateOutput` config default (for example `"iso"`), per-field options still win; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: resource/resource-output-values.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-071 [chore] `Restful.list` answers 5xx outside the request funnel

- Source: security and performance audit of 2026-11-11.
- What and why: apart from refused filters, `Restful.list` catches every error and answers `response.serverError`,
  so the failure is not recorded once by the request funnel like other 5xx responses.
- Evidence: `packages/core/src/restful/restful.ts:99-106`.
- Acceptance: other errors are rethrown; the funnel answers and records them; existing restful specs updated.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core tests/unit/restful/restful-lifecycle.test.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-070 [bug] Workspace `grep`: case-insensitive classes miss some letters

- Source: security and performance audit of 2026-11-11.
- What and why: the linear matcher tries a code unit, its canonical form and its lower case, so an ignore-case class
  misses letters that share a canonical form through a third code unit (for example `µ` and `μ`).
- Evidence: `packages/ai-workspace/src/search/linear-regex.ts:137`, `:317`.
- Acceptance: case folding matches the built-in `RegExp` with the `i` flag; differential spec over such letters.
- Shipped: 5.54.0 (2026-11-16).
- Verified: linear-regex.spec.ts (differential spec); typecheck, lint and the full release gate green (verify and review passes).

### T-069 [bug] Scheduler: a throwing `job:*` listener leaves an unhandled rejection

- Source: security and performance audit of 2026-11-11.
- What and why: the run loop chains `void run.finally(...)`; when an event listener throws inside a run, the rejection
  is unhandled (same exposure as before 5.53.0).
- Evidence: `packages/scheduler/src/scheduler.ts:513-540`.
- Acceptance: listener errors are caught and logged; spec with a throwing listener and an `unhandledRejection` spy.
- Shipped: 5.54.0 (2026-11-16).
- Verified: scheduler scheduler.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-068 [bug] Docs: the pgvector store example cannot work

- Source: security and performance audit of 2026-11-11.
- What and why: the docs pass `ai.rag.pgVectorStore(...)` as `ai.rag({ store })`, but `store` must be a cache driver:
  `rag()` wraps it in `cacheVectorStore(driver)`, which calls `driver.set`/`driver.similar`, so the first `index()`
  fails.
- Evidence: `docs/src/content/docs/v/latest/ai/rag/rag-loaders-and-stores.md:159-166`;
  `packages/ai/src/rag/rag.ts:64-72`.
- Acceptance: `RagConfig.store` accepts a `VectorStore` (preferred), or the docs show the working setup; spec.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai rag.spec.ts (RagConfig.store accepts a VectorStore) and the docs build; typecheck, lint and the full release gate green (verify and review passes).

### T-067 [bug] Template: the users list filters on a column the model does not have

- Source: security and performance audit of 2026-11-11.
- What and why: the template's repository config sets `isActiveColumn: "status"` / `isActiveValue: "active"`, the
  users services call `listActiveCached` / `firstActiveCached`, and the `User` model has no `status` field, so the list
  and lookup filter on a column no row has.
- Evidence: `packages/create-warlock/templates/warlock/src/config/repository.ts:4-5`;
  `packages/create-warlock/templates/warlock/src/app/users/services/list-users.service.ts:6`, `:10`;
  `packages/create-warlock/templates/warlock/src/app/users/models/user/user.model.ts`.
- Acceptance: either the setting goes and the services use the plain helpers, or the model and migration gain
  `status`; a template spec lists a created user.
- Shipped: 5.54.0 (2026-11-16).
- Verified: create-warlock static spec (no live database spec); typecheck, lint and the full release gate green (verify and review passes).

### T-066 [feature] Query `cursor()` / `stream()` iterator

- Source: security and performance audit of 2026-11-11.
- What and why: `chunk()` now pages by key, but there is no async iterator; MongoDB `cursor()` throws.
- Evidence: `packages/cascade/src/drivers/mongodb/mongodb-query-builder.ts:1571-1575`;
  `packages/cascade/src/query-builder/keyset-chunk.ts`.
- Acceptance: `for await (const model of query.stream())` on both drivers, hydrating per batch; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade query-builder/keyset-stream.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-065 [feature] MongoDB `has()` / `whereHas()` family

- Source: security and performance audit of 2026-11-11.
- What and why: since 5.53.0 these throw on MongoDB instead of being dropped. Implementing them needs `$lookup` from
  the relation definitions, a decision for write paths (resolve ids first or keep refusing), and `orWhereHas` inside
  `$or`.
- Evidence: `packages/cascade/src/drivers/mongodb/mongodb-query-parser.ts:1239-1244`;
  `packages/cascade/src/drivers/postgres/postgres-query-builder.ts:1727` (`buildHasSubquery`, the reference).
- Acceptance: hasMany/hasOne/belongsTo/belongsToMany supported in reads and counts; writes resolve ids or refuse
  clearly; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade mongodb-relation-lookup.spec.ts and the live relation-existence test (MongoDB); typecheck, lint and the full release gate green (verify and review passes).

### T-064 [bug] `findAndUpdate(..., { upsert: true })` updates only the first match

- Source: security and performance audit of 2026-11-11.
- What and why: with `upsert` the update goes through the upsert scoping, which pins the filter to one visible id, so
  several matching rows get only the first updated.
- Evidence: `packages/cascade/src/model/methods/query-methods.ts:485-489`, `:383-389`.
- Acceptance: all matching rows are updated; an insert happens only when none match; spec.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade findAndUpdate upsert spec; typecheck, lint and the full release gate green (verify and review passes).

### T-063 [bug] `cursorPaginate()` reads cursor values as model properties

- Source: security and performance audit of 2026-11-11.
- What and why: both drivers read the cursor column with `row[column]` from hydrated models. Model columns are not
  properties (only members such as `id` are), so any cursor column other than a model member yields `undefined`
  cursors.
- Evidence: `packages/cascade/src/drivers/mongodb/mongodb-query-builder.ts:2575`, `:2607-2608`;
  `packages/cascade/src/drivers/postgres/postgres-query-builder.ts:1345-1346`;
  `packages/cascade/src/model/methods/column-read-guard.ts:50-60`.
- Acceptance: cursors read through `model.get(column)` (or the raw row); spec paginating by `createdAt` on both
  drivers.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade mongodb-relation-lookup.spec.ts and postgres-cursor-paginate.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-062 [bug] MongoDB `withCount()` and `joinWith()` are silently ignored

- Source: security and performance audit of 2026-11-11.
- What and why: on MongoDB, `withCount()` records relations that the builder never reads (no count fields appear), and
  `joinWith()` records relations without adding any `$lookup`. Both succeed silently.
- Evidence: `packages/cascade/src/query-builder/query-builder.ts:140`, `:1163` (`withCount` records
  `countRelations`); `packages/cascade/src/drivers/mongodb/mongodb-query-builder.ts:2853-2885` (`joinWith` fills
  `joinRelations`, read nowhere else in the MongoDB driver).
- Acceptance: both implemented with `$lookup` (+ `$size` for counts) from the relation definitions, or both throw a
  clear "not supported on MongoDB" error; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade mongodb-relation-lookup.spec.ts and the live relation-existence test (MongoDB); typecheck, lint and the full release gate green (verify and review passes).

### T-061 [feature] Multi-site resolver: shorter memory for unknown hosts

- Source: security and performance audit of 2026-11-11.
- What and why: `resolveHost` results, including `null`, are remembered for the full `ttl`, so a host added at runtime
  starts resolving only after that.
- Evidence: `packages/web/src/sites/site-selector.ts:29`, `:107`.
- Acceptance: optional `resolveCache.negativeTtl`; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web site-selector.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-060 [feature] Trace dashboard: conditional poll

- Source: security and performance audit of 2026-11-11.
- What and why: the dashboard polls `GET api/traces` and receives the full summary list each time.
- Evidence: `packages/ai-panoptic/src/dashboard/serve.ts:116-119`.
- Acceptance: `ETag` on the list and 304 on `If-None-Match`; the UI sends it; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai-panoptic serve.spec.ts and ui.html.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-059 [chore] Core request-path leftovers

- Source: security and performance audit of 2026-11-11.
- What and why: (1) the refusal route is found by a scan per refusal; (2) middleware names are coloured before the
  logger decides whether the line is kept; (3) the rate limiter keeps one bucket set per limiter id in a module map that
  is never pruned (grows when middleware is built per request or across hot reloads).
- Evidence: `packages/core/src/router/router.ts:1492`; `packages/core/src/http/request.ts:1378`, `:1407`;
  `packages/core/src/http/middleware/rate-limit.middleware.ts:80`, `:192-196`.
- Acceptance: cached refusal route; lazy message building; limiter state held by the middleware closure (spec counter
  via a weak reference); specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core log-gating and rate-limit WeakRef specs; typecheck, lint and the full release gate green (verify and review passes).

### T-058 [chore] Workspace search: shorter synchronous slices

- Source: security and performance audit of 2026-11-11.
- What and why: one 2,000-character line against a pattern near the 4,000-state cap costs about half a second before
  the per-line budget check; a long wildcard glob over a directory of long names is seconds of synchronous work.
- Evidence: `packages/ai-workspace/src/ops.ts:117-120`, `:1162`; `packages/ai-workspace/src/policy/jail.ts:85`.
- Acceptance: a lower state cap or a step check inside a line; glob matching yields between entries; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai-workspace ops.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-057 [feature] Scope and namespace filtering inside the vector store

- Source: security and performance audit of 2026-11-11.
- What and why: memory tiers, the semantic cache and RAG now widen similarity queries until enough in-scope hits pass
  (up to five queries on a crowded store). Filtering in the store needs a cache-driver capability that does not go
  through the per-write tag index and supports AND with caller tags.
- Evidence: `packages/ai/src/utils/similar-within.ts`; `packages/cache/src/tagged-cache.ts:79`;
  `packages/cache/src/drivers/pg-cache-driver.ts:197-225` (tag index as one JSON row rewritten per tagged write).
- Acceptance: drivers accept a scope/namespace filter on `similar()`; one query per recall; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cache similar.spec.ts, ai similar-within.spec.ts, memory.spec.ts and cache-vector-store.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-056 [feature] `ai.session`: avoid the second full-record write per turn

- Source: security and performance audit of 2026-11-11.
- What and why: each turn saves the whole session record once to mark it pending and again to settle it.
- Evidence: `packages/ai/src/session/conversation-session.ts:183-202`.
- Acceptance: a store-level pending marker (snapshot store contract addition) so a turn writes the record once;
  crash recovery specs unchanged.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai conversation-session.spec.ts and the memory, PostgreSQL and SQLite snapshot store specs; typecheck, lint and the full release gate green (verify and review passes).

### T-055 [feature] Queue local drivers: indexes for large retention

- Source: security and performance audit of 2026-11-11.
- What and why: SQLite pruning sorts a state's rows by `json_extract(body, '$.finishedAt')` without an index; the
  memory store's polling is copy-free but still compares every kept job.
- Evidence: `packages/queue/src/drivers/sqlite-store.ts:143-144`; `packages/queue/src/drivers/memory-store.ts:56`.
- Acceptance: an expression index on `finishedAt`; a per-queue ready index in the memory store; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: queue tests/local-store-index.spec.ts (memory store); typecheck, lint and the full release gate green (verify and review passes).

### T-054 [feature] Auth: bulk family work on "sign out everywhere"

- Source: security and performance audit of 2026-11-11.
- What and why: `revokeAllTokens` now ensures each family once, but still runs one transaction per family for ensure
  and revoke.
- Evidence: `packages/auth/src/services/auth.service.ts:971-990`.
- Acceptance: one upsert for missing families and one bulk update for revocation; events unchanged; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: auth auth.service.spec.ts, auth-token-family.model.spec.ts, refresh-token.model.spec.ts, and the live MongoDB and PostgreSQL hardening suites (18 pass); typecheck, lint and the full release gate green (verify and review passes).

### T-053 [feature] 103 Early Hints for the hydration entry and stylesheets

- Source: comparison with common practice, 2026-11-11.
- What and why: `modulepreload` and stylesheet links reach the browser only with the shell, after loaders ran.
- Evidence: `packages/web/src/components/head.ts:72-79`.
- Acceptance: opt-in `web.earlyHints` sends `Link` preloads with a 103 before loaders run; specs; docs on proxy support.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web early-hints.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-052 [feature] Page cache and sitemap: store compressed, answer 304, serialise once

- Source: security and performance audit of 2026-11-11.
- What and why: page-cache HITs are compressed again on every response; HITs carry no `ETag`, so revalidation always
  sends the body; the JSON variant of a stored entry checks and serialises the payload twice; sitemaps are not gzipped
  unless configured.
- Evidence: `packages/web/src/server/page-route-handler/store-page-cache-after-render.ts:114`, `:231`;
  `packages/web/src/server/page-route-handler/serve-page-cache-hit.ts`; `packages/web/src/sitemap/resolve-sitemap-config.ts:215`.
- Acceptance: entries stored with their encoded bodies (per accepted encoding) and a body hash `ETag` with 304 on
  `If-None-Match`; the JSON variant uses `serializeHydrationPayload`; sitemap gzip default reviewed; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web page-cache-revalidation.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-051 [feature] Drop the remaining duplicated document slots from the inline payload

- Source: security and performance audit of 2026-11-11.
- What and why: the inline payload repeats stylesheet/preload URLs, font preloads, alternates, entry URL and site key
  that the document head already carries (the nonce must stay).
- Evidence: `packages/web/src/components/scripts.ts:26`; `packages/web/src/client/hydrate-page.tsx`.
- Acceptance: the client rebuilds those slots from the DOM before hydrating; parity specs; smaller payload measured.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web read-document-slots.spec.ts and scripts.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-050 [feature] Load error and forbidden pages lazily on the client

- Source: security and performance audit of 2026-11-11.
- What and why: the generated client registry imports the error and forbidden pages eagerly, so every route's bundle
  carries them.
- Evidence: `packages/web/src/build/generate-client-registry.ts:192-200`.
- Acceptance: lazy chunks; hydration awaits them only when the payload carries `errorPage`; a Suspense-wrapped lazy
  error page in the client boundary; browser hydration specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web generate-client-registry-forbidden.spec.ts, build-hydrated-tree-lazy-error-pages.spec.ts and manifest.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-049 [feature] Memoise translation delivery per route and locale

- Source: security and performance audit of 2026-11-11.
- What and why: pruned translations are rebuilt per request. Memoising needs a registry revision, because the
  localization registry is written in place by `extend()`/`groupedTranslations()` and pages register on first request.
- Evidence: `packages/web/src/translations/delivery.ts:240-264`; `packages/web/src/server/global-translations.ts:107`,
  `:154`; `packages/core/src/localization/register-locale-dictionary.ts:72`.
- Acceptance: core wraps the registration functions and bumps a revision; web memoises `deliver(route, locale)` per
  revision; specs show a registration invalidates the memo.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core translations-revision.spec.ts and web global-translations.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-048 [feature] Data requests skip the server render

- Source: security and performance audit of 2026-11-11.
- What and why: a client navigation (data request) still renders the page on the server only to decide the error page
  and status, then discards the stream. Skipping it moves render-time error reporting to the client boundary.
- Evidence: `packages/web/src/server/render-page.ts:1674` (`attempt.discard()`).
- Acceptance: data requests return the payload without rendering; the client boundary reports render errors; status
  rules documented; specs.
- Owner decision (2026-11-16): accepted; render-time errors of data requests are reported by the client.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web render-page-single-pass.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-046 [feature] Validation: stop re-walking nested output at every level

- Source: security and performance audit of 2026-11-11.
- What and why: the output of an object nested `d` levels is cleaned of `undefined` values by every ancestor. Walking
  once needs a choice: may nested transformers see uncleaned JavaScript `undefined` values, or may the framework
  assume its outputs are not mutated in place by user callbacks?
- Evidence: `packages/seal/src/validators/object-validator.ts:575`, `:724-739`.
- Acceptance: one walk per validation with the chosen rule pinned by specs; output unchanged for JSON input.
- Owner decision (2026-11-16): the entry's recommended rule.
- Shipped: 5.54.0 (2026-11-16).
- Verified: seal tests/unit/validators/nested-output-cleaning.test.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-045 [feature] Sync fan-out: per-document order, per-listener retry, skip when nobody listens

- Source: security and performance audit of 2026-11-11.
- What and why: embedded-copy sync jobs now run one at a time after commit. A retry re-runs every listener of the
  event (including app listeners), and a job is queued even when no listener exists.
- Evidence: `packages/cascade/src/sync/model-events.ts:115-133`.
- Acceptance: configurable concurrency keyed by source document (order kept per document), retry per listener, no job
  for an event without listeners; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade sync/sync-fanout.test.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-044 [feature] MongoDB upserts generate an id only when they insert

- Source: security and performance audit of 2026-11-11.
- What and why: every upsert reserves an id before the write, so updates burn ids (and a round trip without
  `idReservationBlockSize`).
- Evidence: `packages/cascade/src/model/methods/query-methods.ts:237` (`withAutoGeneratedUpsertId`), `:426`, `:517`.
- Acceptance: the id is written by a second write keyed on `_id` only when the upsert inserted; specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade query-methods.spec.ts and the live MongoDB atomic-update suite; typecheck, lint and the full release gate green (verify and review passes).

### T-043 [feature] Scoped atomic writes in one statement

- Source: security and performance audit of 2026-11-11.
- What and why: atomic writes on a model with global scopes first fetch the visible ids, then write to them: two round
  trips per write.
- Evidence: `packages/cascade/src/model/methods/query-methods.ts:347-400`.
- Acceptance: a builder-level `atomic()` that composes the scopes into the write filter; one driver call; specs on
  both drivers.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade query-methods.spec.ts and postgres-prepared-atomic.spec.ts, plus a live PostgreSQL run; typecheck, lint and the full release gate green (verify and review passes).

### T-041 [feature] PostgreSQL: default statement timeout and named prepared statements

- Source: comparison with common practice, 2026-11-11.
- What and why: no default `statement_timeout`, so one runaway query holds a pool connection indefinitely; queries are
  unnamed, so PostgreSQL plans each hot query again.
- Evidence: `packages/cascade/src/drivers/postgres/postgres-driver.ts:162-171`.
- Acceptance: the scaffold sets a statement timeout (for example 30 s) in the PostgreSQL config; optional
  `query.prepare(name)` passes a statement name; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade drivers/postgres/postgres-prepared-atomic.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-040 [feature] Compile declared response schemas into the response serializer

- Source: comparison with common practice, 2026-11-11.
- What and why: route `responseSchema` only feeds OpenAPI; responses go through plain `JSON.stringify`. Compiling it
  into Fastify's response serializer is faster and drops undeclared fields (a guard against leaking columns).
- Evidence: `packages/core/src/router/types.ts:179`; `packages/core/src/openapi/build-openapi-document.ts:141`.
- Acceptance: opt-in `http.compileResponseSchemas` (or per route) converts the seal output schema to JSON Schema and
  registers it for the declared statuses; specs for speed-neutral correctness and field stripping; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core router/compile-response-schemas.spec.ts and dev-body-limit.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-039 [feature] Batch relation loads issued in the same tick

- Source: comparison with common practice, 2026-11-11.
- What and why: `with()` batches, but `model.load()` loads for one model, so
  `Promise.all(posts.map((post) => post.load("author")))` runs N queries.
- Evidence: `packages/cascade/src/model/model.ts:735`.
- Acceptance: `load()` calls for the same (model class, relation) queued in one microtask run as one loader query;
  same for `Model.find(id)` → one `whereIn`; opt-out flag; specs count queries.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade model/batch-loads.spec.ts (including the context-scope and per-call error cases); typecheck, lint and the full release gate green (verify and review passes).

### T-038 [feature] Cache TTL jitter and serve-stale-on-error

- Source: comparison with common practice, 2026-11-11.
- What and why: entries written together expire together (synchronised misses across keys and instances), and
  `swr()` has no documented fall-back to the stale value when the refresh throws.
- Evidence: `packages/cache/src/drivers/base-cache-driver.ts:530` (`remember`), `:588` (`swr`).
- Acceptance: `ttlJitter` (± percent per set) and `swr({ failSafe: true })` returning the stale entry within its
  stale window when the refresh throws; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cache-has-jitter-failsafe.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-037 [feature] A cheaper cache `has()`

- Source: security and performance audit of 2026-11-11.
- What and why: `has()` reads and parses the whole value on every driver, because it emits `hit`/`miss` events that
  carry the value.
- Evidence: `packages/cache/src/drivers/base-cache-driver.ts:446`.
- Acceptance: `has()` uses the drivers' `exists()` and emits an event without the value (documented change); specs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cache-has-jitter-failsafe.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-035 [feature] Constant-time repository cache invalidation

- Source: security and performance audit of 2026-11-11.
- What and why: every repository write clears its namespace with `removeNamespace`, which on Redis scans the keyspace.
  Write-heavy apps pay a scan per write.
- Evidence: `packages/core/src/repositories/adapters/cascade/cascade-adapter.ts:59`;
  `packages/cache/src/drivers/redis-cache-driver.ts:151-190`.
- Acceptance: a generation key per namespace (entries keyed under the generation, with a TTL so old generations
  cannot leak on TTL-less drivers) or a per-namespace key index; invalidation costs O(1) round trips; specs on memory
  and Redis fakes; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core repository.manager.generation-cache.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-034 [feature] Spool large multipart parts to temporary files

- Source: security and performance audit of 2026-11-11.
- What and why: multipart files are buffered in memory (bounded since 5.53.0 by a 25 MB total per request). Spooling
  parts above a threshold to disk cuts peak memory under concurrent uploads. Deleting temp files on response close
  would break `UploadedFile` instances kept for later (queued jobs), and every storage driver reads the whole buffer
  at save time.
- Evidence: `packages/core/src/http/multipart.ts:85` (`onFile: bufferFilePart`); `packages/core/src/http/uploaded-file.ts`.
- Acceptance: `http.multipart.memoryLimit` (for example 2 MB) streams larger parts to `os.tmpdir()`; `UploadedFile`
  gets a path-backed mode with lazy `buffer()` and streaming `save()` (`storage.putStream`); temp files deleted on
  response close unless `file.keep()`, plus an exit sweep; the whole public surface and its specs unchanged.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core http/multipart-spool.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-032 [chore] Document the multi-site cache risk of a CDN keyed on `Host`

- Source: security and performance audit of 2026-11-11.
- What and why: the page cache key now uses the selected site's host. A CDN that keys on `Host` but forwards a
  client's `X-Forwarded-Host` can still store site B's page under site A's URL; only the proxy/CDN configuration can
  close it.
- Evidence: `packages/web/src/server/page-route-handler/serve-page-cache-hit.ts:34`, `:54`;
  `docs/src/content/docs/v/latest/web/essentials/10-page-caching.mdx`.
- Acceptance: the page-caching and multi-site docs explain the risk and the CDN setting that closes it.
- Shipped: 5.54.0 (2026-11-16).
- Verified: docs build (935 pages); typecheck, lint and the full release gate green (verify and review passes).

### T-031 [chore] Release tooling and dependency hygiene

- Source: security and performance audit of 2026-11-11.
- What and why: (1) no gate check fails when a published package's declared range excludes the patched range of a
  known advisory; (2) the source-map stripping step before `npm pack` has its own spec but the call site in the pack
  loop has none; (3) `warlock add mail` still installs `@types/nodemailer` although the installed major ships its own
  types.
- Evidence: `tools/release/scripts/release-family.ts:33`, `:799`;
  `packages/core/src/generations/features/mail.feature.ts:9`.
- Acceptance: a release-gate check reads advisories for direct dependencies and fails on an excluded patched range; a
  spec pins the stripping call; the redundant types package is dropped with a spec update.
- Shipped: 5.54.0 (2026-11-16).
- Verified: tools/release advisory-gate.spec.ts (4 pass) and release test:scripts (370 pass); typecheck, lint and the full release gate green (verify and review passes).

### T-030 [feature] Injection detector: combining marks, look-alike letters, other separators

- Source: security and performance audit of 2026-11-11.
- What and why: phrases now match through spacing, zero-width and full-width tricks, but combining marks, look-alike
  letters from other scripts and separators other than whitespace, `_`, `-`, `.` still hide a phrase. The detector is
  documented as a heuristic.
- Evidence: `packages/ai/src/guard/detectors/injection.ts:113-117` (normalised matching).
- Acceptance: normalisation strips combining marks and folds a confusables table; specs for each case; matching stays
  linear.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai injection.spec.ts (including the linear-time check); typecheck, lint and the full release gate green (verify and review passes).

### T-029 [feature] Access resolvers may skip the shared cache

- Source: security and performance audit of 2026-11-11.
- What and why: roles and permissions come from the shared cache; a change made without `flush()` (or by another
  process) stays invisible until the entry expires. For `DefaultAccessResolver` the sets are a pure function of the
  loaded user, so caching them only delays role changes.
- Evidence: `packages/access/src/services/default-resolver.ts:26`; `packages/access/src/services/engine.ts:67-82`.
- Acceptance: a resolver-level `cacheable = false` (default resolver opts out) with an upgrade note; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: access engine.spec.ts and default-resolver.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-028 [feature] Bind local-disk temporary URL tokens to their disk

- Source: security and performance audit of 2026-11-11.
- What and why: temporary-URL tokens are now bound to the tenant prefix, but not to the disk. Two local disks sharing
  one `signatureKey` accept each other's tokens; the docs tell apps to use one key per disk.
- Evidence: `packages/core/src/storage/drivers/local-driver.ts:76-85`, `:404-430`.
- Acceptance: the driver learns its disk name and signs it into the token (version bump, old tokens rejected); spec
  with two disks and one key; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core local-driver-temporary-token.spec.ts (two disks, v2 refused); typecheck, lint and the full release gate green (verify and review passes).

### T-027 [feature] Stamp global-scope values into an upsert's insert

- Source: security and performance audit of 2026-11-11.
- What and why: upserts now honour global scopes when they match, but an upsert that inserts writes only the given
  data. On a tenant-scoped model a forgotten tenant column creates a row outside every tenant.
- Evidence: `packages/cascade/src/model/methods/write-methods.ts:338-339`;
  `packages/cascade/src/model/methods/query-methods.ts:383-400` (`scopeUpsertFilter`).
- Acceptance: a structured scope declaration (for example `addGlobalScope(name, cb, { stamp: { tenantId } })`) whose
  values are written into inserts made by `create()` and `upsert()`; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade model/scope-stamp.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-026 [feature] Rehash passwords on login and offer a second hashing algorithm

- Source: comparison with common practice, 2026-11-11.
- What and why: raising `encryption.password.salt` (bcrypt rounds) only affects new hashes; existing users keep the
  old cost forever. bcrypt also truncates at 72 bytes (now warned) and runs on the main thread in the pure-JS build.
- Evidence: `packages/core/src/encryption/password.ts:111-132`, `:154`, `:185`;
  `packages/auth/src/services/auth.service.ts:779-802` (`attemptLogin`).
- Acceptance: `needsRehash(hash)` in core; `attemptLogin` rehashes and saves after a successful check when the cost
  changed (option, default on); optional `encryption.password.driver: "scrypt"` on `node:crypto` (thread pool, no
  dependency) with verify of both formats; specs; docs and skill.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core password.spec.ts and auth auth.service.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-025 [feature] Password reset: remaining timing difference for known accounts

- Source: security and performance audit of 2026-11-11.
- What and why: delivery now runs after the response, but the token writes (invalidate + issue) still run inline only
  for a known account, so response time still differs slightly between known and unknown emails. The same applies to
  OTP requests.
- Evidence: `packages/auth/src/services/password-reset.ts:63-82`; `packages/auth/src/otp/otp.ts`.
- Acceptance: the lookup and writes for a known account run off the response path (or both branches do equal work);
  spec that holds the lookup pending and shows the call resolving; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: auth password-reset and OTP specs (background delivery, awaitDelivery); typecheck, lint and the full release gate green (verify and review passes).

### T-024 [feature] Login throttle: a success resets the shared IP bucket

- Source: security and performance audit of 2026-11-11.
- What and why: a successful login clears the counter and lock of every tracked bucket, including the IP bucket. An
  attacker with their own valid account behind one IP can reset that IP's budget between guesses. The per-email
  bucket still bounds guessing on any one account.
- Evidence: `packages/auth/src/middleware/login-throttle.middleware.ts:401-413`.
- Acceptance: a success clears only the buckets keyed by the signed-in identity (email, email+IP); the IP bucket
  expires on its window; spec; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: auth login-throttle.middleware.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-023 [feature] `http_request` tool sends static headers to any host when unrestricted

- Source: security and performance audit of 2026-11-11.
- What and why: with `baseUrl` the tool now keeps static headers (API keys) on the base origin. With neither
  `baseUrl` nor `allowHosts`, static `headers` still go to whatever host the model names.
- Evidence: `packages/ai-tools/src/http/http-request.ts:61-108`, `:222-232`.
- Acceptance: configuring static headers without `baseUrl`/`allowHosts` logs a construction-time warning (or throws,
  per review) and the docs say so; spec.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai-tools http-request.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-022 [bug] RAG `clear()` also deletes nested namespaces

- Source: security and performance audit of 2026-11-11.
- What and why: `kb.clear()` deletes by key prefix, so clearing `kb.acme` also deletes `kb.acme.private`. Retrieval is
  exact since 5.53.0; deletion is not. Documented as a caveat only.
- Evidence: `packages/ai/src/rag/rag.ts:199-200`.
- Acceptance: `clear()` removes only its own namespace's chunks (needs an exact-namespace delete or key enumeration in
  `@warlock.js/cache`); spec with sibling and nested namespaces; caveat removed from the docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cache list-keys.spec.ts (18 pass), ai rag.spec.ts (list and fallback paths), pg and redis driver specs; typecheck, lint and the full release gate green (verify and review passes).

### T-021 [feature] Outbound address pinning: keep app connect options, cover the skipped cases

- Source: security and performance audit of 2026-11-11.
- What and why: guarded fetches (AI tools, RAG loaders, storage `putFromUrl`) pin connections to checked addresses
  through a new dispatcher built with default connect options. An app that installed its own global dispatcher with a
  private CA or client certificate loses those options for guarded requests; with a proxy dispatcher, an injected
  `fetch`, or a runtime without Node's dispatcher, pinning is skipped and only the pre-check runs.
- Evidence: `packages/ai/src/security/outbound-policy.ts:39`, `:190`, `:250`;
  `packages/core/src/storage/utils/safe-fetch.ts:35`, `:163`, `:222`, `:362`.
- Acceptance: the pinned dispatcher inherits the installed dispatcher's connect options; a skipped pin logs one
  warning naming why; docs list the remaining limits; specs for each case.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai security/outbound-policy-dispatcher.spec.ts and core storage safe-fetch-pinning.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-020 [feature] Refuse non-string input inside the agent run

- Source: security and performance audit of 2026-11-11.
- What and why: `ai.serve` now refuses a non-string `input`, but callers that bypass it can still hand objects to
  the agent at runtime (the type says `string`, nothing checks it).
- Evidence: `packages/ai/src/agent/agent.ts:421-437` (`execute(input: string, ...)`, `stream(input: string, ...)`).
- Acceptance: a non-string input throws `InvalidRequestError` with a message naming what to pass; spec; changelog.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai agent.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-019 [feature] Guardrails for tool results (indirect prompt injection)

- Source: comparison with common practice, 2026-11-11.
- What and why: guard phases are `input`, `output` and `tool` (tool arguments). Text a tool returns (fetched pages,
  file contents) reaches the model unscanned, which is the usual path for injected instructions.
- Evidence: `packages/ai/src/guard/contracts/verdict.type.ts:8`; `packages/ai/src/guard/guard.ts`.
- Acceptance: a `toolResult` phase runs the configured detectors (for example `injection`) on tool output and can
  block, redact or wrap it as untrusted data; specs; docs and skill.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai guard.spec.ts (8 cases); typecheck, lint and the full release gate green (verify and review passes).

### T-018 [feature] Bound how long a document shell may wait

- Source: security and performance audit of 2026-11-11.
- What and why: since the single-pass render, a shell that suspends outside `<Suspense>` waits instead of failing.
  A disconnect stops it, but a connected client keeps the render alive for as long as the promise never settles.
- Evidence: `packages/web/src/server/render-page.ts:874-917`.
- Acceptance: `web.shellTimeout` (milliseconds; default generous, `0` off) aborts a shell that has not become ready
  and escalates to the error page; specs; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web render-page-single-pass.spec.ts and streaming-config.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-017 [feature] Nesting-depth cap for request input keys and JSON bodies

- Source: security and performance audit of 2026-11-11.
- What and why: array indexes in bracket/dotted keys are capped (`http.input.maxArrayIndex`), but nesting depth is not:
  `a[b][c]...` or a deeply nested JSON body builds a deep object that later walks (validation, logging, cloning)
  recurse into.
- Evidence: `packages/core/src/http/request.ts:818-830` (index cap), `:881-911` (`parseBody`).
- Acceptance: `http.input.maxDepth` (generous default, for example 32) drops or refuses deeper keys with a coded
  error; JSON bodies get the same bound; specs; docs and upgrade note.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core http/request-input-depth.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-016 [feature] Cloud storage: serve markup uploads as attachments

- Source: security and performance audit of 2026-11-11.
- What and why: uploads whose bytes are SVG/HTML/XML are now stored as `application/octet-stream`. On cloud disks
  the object is still served without `Content-Disposition: attachment` unless the caller passes it, so a bucket with a
  public URL can still be opened inline by some clients.
- Evidence: `packages/core/src/storage/drivers/cloud-driver.ts:436-450`, `:488-501`, `:566-568` (puts take
  `contentDisposition` only from options); `packages/core/src/http/uploaded-file.ts:887-904`.
- Acceptance: a markup upload stored on a cloud disk gets `ContentDisposition: attachment` by default (caller can
  override); spec with a mocked S3 client; docs and changelog.
- Shipped: 5.54.0 (2026-11-16).
- Verified: core cloud-driver.content-disposition.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-015 [chore] Template: the `trustProxy` comment still recommends `true`

- Source: security and performance audit of 2026-11-11.
- What and why: since 5.53.0, `trustProxy: true` no longer reads `X-Real-IP`, and a client can spoof the forwarded
  address behind an appending edge. The generated `http.ts` still tells users to "set this to `true`" behind a
  proxy.
- Evidence: `packages/create-warlock/templates/warlock/src/config/http.ts:48-54`.
- Acceptance: the comment recommends a list of the proxy's IPs/CIDRs and names `http.realIpHeader`; template format
  and typecheck specs pass.
- Shipped: 5.54.0 (2026-11-16).
- Verified: create-warlock specs/template-security-defaults.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-013 [feature] Coding-CLI adapters declare the extra variables they need

- Source: security and performance audit of 2026-11-11.
- What and why: `inheritEnv: "curated"` passes a minimal system set plus `apiKeyEnv`. Adapters that also need base-URL
  variables or several provider keys (for example a CLI that talks to more than one provider) then fail unless the
  app lists them. An adapter-declared `passEnv` list makes the curated mode work out of the box (prerequisite for
  T-007).
- Evidence: `packages/ai-cli/src/session/environment.ts:41-75`; adapter definitions declare only `apiKeyEnv`
  (`packages/ai-cli/src/adapters/codex.ts:52`, `copilot.ts:55`, `cursor.ts:52`).
- Acceptance: every built-in adapter declares its variables; `"curated"` passes them; spec per adapter shape; docs.
- Shipped: 5.54.0 (2026-11-16).
- Verified: ai-cli cli-agent.spec.ts (passEnv under curated) and adapters.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-012 [feature] Page-level `uploads` option for web page actions

- Source: security and performance audit of 2026-11-11.
- What and why: `http.multipart.routes: "declared"` parses multipart bodies only on routes marked `uploads: true`.
  Page action POST routes are registered with `{ isPage: true }` only and nothing in `@warlock.js/web` reads
  `uploads`, so a web app that switches to `"declared"` gets 415 on every page action that takes a file. The
  template therefore sets `routes: "all"`. This is the prerequisite for flipping the default (T-009 item 3).
- Evidence: `packages/web/src/server/install-page-routes.ts:1021`,
  `packages/web/src/server/install-page-routes-from-manifest.ts:788`; `packages/core/src/router/types.ts:338` (`uploads`
  route option); `packages/core/src/http/multipart.ts:42-66`.
- Acceptance: a page module (or its action) can declare uploads, which reaches the POST route's `uploads` option in
  dev and production; a spec posts a file to such an action under `"declared"` (200) and to an undeclared one (415);
  docs, skill, changelog; the template can then move to `"declared"`.
- Shipped: 5.54.0 (2026-11-16).
- Verified: web page-action-uploads-declared.spec.ts (real socket), read-module-config.spec.ts, normalize-page-module.spec.ts, site-dispatch.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-011 [decision] Model-level protected columns against mass assignment

- Source: comparison with common practice, 2026-11-11.
- What and why: `model.merge(request.all())` writes any declared column, including `role` or `isAdmin`. Validated
  input (`request.validated()`) is the documented path, but nothing stops the shortcut.
- Evidence: `packages/cascade/src/model/model.ts:1172-1174` (`merge`); the template's `role` column
  (`packages/create-warlock/templates/warlock/src/app/users/models/user/user.model.ts:32`).
- Options: (a) `static guarded = ["role", ...]` honoured by `merge()`/`create()` with an explicit `forceMerge()`;
  (b) `static fillable` allowlist; (c) a development warning only when `merge()` receives the request's raw input.
- Recommendation: (a) plus (c): a denylist keeps existing models working; the warning catches the pattern early.
- Acceptance: guarded columns are skipped (or refused, per decision) by `merge()`/`create()`, written by the
  explicit method; specs; docs, skill and changelog; the template guards `role`.
- Owner decision (2026-11-16): options (a) and (c): skip, not throw; denylist; a development warning; `markRawInput()` for raw objects.
- Shipped: 5.54.0 (2026-11-16).
- Verified: cascade model/guarded-columns.spec.ts; core http request-raw-input.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-010 [decision] Encryption-key and JWT-secret rotation

- Source: comparison with common practice, 2026-11-11.
- What and why: `encryption.key` and the JWT secrets are single values. Rotating a leaked key today makes every
  stored ciphertext unreadable and signs every user out at once, so in practice keys are not rotated.
- Evidence: `packages/core/src/encryption/encrypt.ts:21-30` (one key), `:115` (`decrypt`);
  `packages/auth/src/services/jwt.ts:6-13` (one access secret, refresh falls back to it).
- Options: (a) `encryption.previousKeys: string[]` tried on decrypt only, and `auth.accessToken.previousSecrets` /
  `auth.refreshToken.previousSecrets` tried on verify only; (b) a key id embedded in ciphertexts/tokens (`kid`) with
  a keyring; (c) leave as is and document a manual re-encrypt.
- Recommendation: (a): small, additive, no format change; add (b) later only if apps need more than one rotation in
  flight.
- Acceptance: after rotation, old ciphertexts and tokens still open, new ones use the new key; a spec per path;
  docs and a rotation recipe; `warlock doctor` notes previous keys left configured for long.
- Owner decision (2026-11-16): option (a).
- Shipped: 5.54.0 (2026-11-16).
- Verified: core encrypt.spec.ts; auth jwt-previous-secrets.spec.ts and auth-config.spec.ts; typecheck, lint and the full release gate green (verify and review passes).

### T-008 [decision] Release workflow: provenance, unprivileged gate job, write token out of the test step

- Source: security and performance audit of 2026-11-11.
- What and why: one `release` job holds `contents: write` and runs the whole gate (tests, builds, installs from a
  local registry) with that token in the step's git config, then publishes with `NPM_TOKEN`. Code executed by the
  tests can read the write token. Actions are now pinned by commit SHA; the rest changes how releases are authorised.
- Evidence: `.github/workflows/release.yml:38-45` (job and permissions), `:177-187` (gate step with
  `GIT_CONFIG_*` carrying `github.token`), `:213-219` (publish step); `tools/release/scripts/release-family.ts` (gate
  branch check runs `git ls-remote --symref origin HEAD`).
- Options: (a) split into a read-only gate job and a publish job that downloads the gate's tarballs and needs
  `contents: write` + `id-token: write`; (b) keep one job but have `release-family.ts` drop `GIT_CONFIG_*` from the
  environment of test children; (c) add npm trusted publishing / `--provenance` (needs `id-token: write` and an npm
  trusted-publisher entry per package).
- Recommendation: (a) + (c): the gate runs with `contents: read`, the publish job never runs app code, and every
  tarball carries provenance. (b) is a stop-gap if (a) is deferred.
- Acceptance: no step that runs tests or package scripts has a write-scoped token; published packages show
  provenance on npm; one dry-run release succeeds end to end.
- Owner decision (2026-11-16): the owner asked for every open task to be completed in 5.54.0; (a) + (c) shipped.
- Shipped: 5.54.0 (2026-11-16).
- Verified: release-family.spec.ts (97 pass) and the new provenance and gate-job checks; the 5.54.0 release ran on the new jobs (gate run 43885559928, publish run 43897306289): the tarball handoff worked and every package carries an SLSA provenance attestation on npm.

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
