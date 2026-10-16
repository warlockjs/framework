# Next release backlog (after 5.30.0)

Work to pick up after 5.30.0. Ordered by priority inside each section. Every item says where to start.
Keep internal report ids and the names of the apps that found an issue out of changelogs, docs, skills,
comments and test names: describe the change itself.

## 1. Must fix

- **Minimum Node is 22.15.** `packages/core/bin/warlock.js` calls `module.registerHooks` (Node ≥ 22.15),
  but `engines` still allow 22.13. Raise `engines.node` to `>=22.15` in the root `package.json`, every
  `packages/*/package.json` that declares one, the create-warlock template's `package.json`, docs and
  skills that state the minimum, and the comment in `.github/workflows/create-warlock.yml` about
  Node 22.13. Then check whether the published CLI reaches `registerHooks` on any path, and make it fail
  with a clear "requires Node 22.15" message instead of `registerHooks is not a function`.
  (If this file is read after the bump already landed, verify and tick it off.)
- **create-warlock "project is ready" box breaks with many features.** With custom mode and every
  feature selected, the `Features:` line is wider than the box, wraps, and the double border renders
  as two misaligned frames. Wrap the feature list inside the box at the terminal width (`process.stdout.columns`),
  size the box from its content, and fall back to a plain list on narrow terminals. Look at the
  success screen in `packages/create-warlock/src` (`showSuccessScreen`). Add a spec that renders it at
  widths 60/80/120 and asserts every line fits.
- **Release confirm gives up too early.** In the 5.30.0 run npm took more than ~10 minutes to expose
  one package (`@warlock.js/ai-mistral`), so `confirm` failed after publishing and skipped the tag push
  and the registry blog check (both were done by hand). Widen the window and retry interval in
  `tools/release/scripts/release-family.ts`, and on final failure print the exact recovery steps.
- **The 5.30.0 npm tarballs ship CHANGELOGs that cite internal ids.** The repository is clean now; the
  next release replaces them. Add a release-gate check that fails on `\b(WR|FW)-[0-9]{2,3}\b` and on
  private app names in `packages/**` and `docs/src/**`.

## 2. Unfinished from 5.30.0

- **Typed `.refine()`** (seal): custom rules run before an object or array validates its children and
  after a failed type rule when `firstErrorOnly: false`, so the callback cannot be typed honestly. Move
  refine to run after children and type rules, then type it from the validator's output parameter.
  Measure with `pnpm bench:types --check`.
- **Seal compile cost**: the benchmark exists (`packages/seal/scripts/bench-types.mjs`, baseline in
  `bench/types-baseline.json`). Run `--check` in CI, then reduce instantiations for large composed
  schemas (about 100k per entity today; 48 entities ≈ 4 GB for `tsc`).
- **`v.union` / `v.record` Standard Schema types** use the input shape, not `Infer.Output`.
- **`@fastify/static` still loads at boot** when the app has a `public/` folder (~0.4 s of `os.cpus()`).
  Defer it to the first static request.
- **Image variant cache has no size or age cap**; only purge-on-delete/move/rewrite. Add a cap, and
  variants for non-local disks.
- **Redis increment without a default TTL** still has a narrow "key expires, INCRBY recreates it"
  race. Pass the TTL per call from the throttle and rate limiter.
- **Locale context after dev edits** (`useLocale()` outside `LocaleProvider`): fixed by sharing contexts
  through a `globalThis` registry, but never reproduced. Add a dev-server reproduction test.
- **Directory move without a race window**: Node has no `renameat2(RENAME_NOREPLACE)`. Consider an
  optional native helper on Linux, or document the two remaining windows more prominently.
- **Generated notifications module**: add signed-in specs once there is a standard login test helper.
- **`effort: "none"` on Opus 5, Sonnet 5 and Haiku 5.5** still leaves thinking on; decide per model
  (the claude-api skill warns about disabling it on Opus 5).

## 3. Code quality and tooling

- **Gates that fail today but are not in CI**: `check:skill-snippets` (no allowance for `devtools`),
  `check:no-pnpm-in-shipped-docs` (core `run-app` skill: pnpm notes, now including the pnpm version
  table), `scripts/check-spec-coverage.mjs` (Node 22.13 `globSync` exclude). Fix and wire into CI, or retire.
- **Formatting**: about half the touched files were not prettier-clean at HEAD, and create-warlock has
  its own `.prettierrc.json` that its `test` script enforces. Run one repository-wide format pass,
  add `format:check` to CI, and make the root config and create-warlock's agree.
- **Strictness allowances with slack**: scheduler 7/23, web 167/178, auth 16/22, cache 15/16. Lower them
  to the measured counts; work down `ai` (463).
- **Local test environment**: queue and notifications tests need Redis on 6390 with no skip path; one
  core test needs port 3000 free. Skip with a clear message or start Redis in setup; use an ephemeral port.
- **llms files**: regenerate them in the release gate instead of by hand.
- **Image-variant and rate-limit tests across real drivers**: add a Redis-backed run in CI for the
  cache rate-limit store and throttles.

## 4. Skills and AI reference

- **Coverage audit**: every 5.30 API needs a skill entry with a working example — `request.signal`,
  `response.sse()`/`stream()` backpressure and retention, `http.errorMapper`, `http.rateLimit.store:
  "cache"`, route `logging`, `@warlock.js/core/errors`, `<Form independent>` and `query`,
  `metadata.viewport`, `isRouteName`/`LinkPropsWithout`, `log.flush({ timeout })` / `onChannelError` /
  `maskEmail`, `moveDirectoryNoReplaceAsync`, `maxConcurrentTools`, `toolDispatch`, `providerOptions`,
  `countTokens()`, workspace `read.maxBytes` and cancellation.
- **Run the skill-snippet gate** against 5.30 once it works again, so every example compiles.
- **One upgrade skill, 5.29 → 5.30**: synchronous logger, concurrent tool calls, request-log snapshot
  shape, reset throttle/rate-limit counters (new key hashing), image cache layout, `<Head />` viewport.

## 5. Features and enhancements

- **AI**: `providerOptions` and `countTokens()` for the other adapters (OpenAI, Google, Bedrock, …);
  optional automatic compaction in the agent loop.
- **Core**: HTTP/2-safe graceful drain (setting `Connection` throws under HTTP/2).
- **create-warlock**: a clearer custom-mode picker (grouped sections, select-all per group) on top of
  the paging fix; a compact summary of chosen features.
- **Docs**: end-to-end examples for variants on a non-default disk and shared rate limits across servers.

## 6. Housekeeping

- `findings/` was emptied after 5.30.0; this file is the only entry. Decide whether earlier reports
  should also be removed from git history (that is a public history rewrite).
- The release skill asks for `releases/<version>-summary.md`; the monorepo has no `releases/` folder.
  Create it or drop the requirement.
- The release token is blocked by the org's fine-grained-token lifetime policy; fix it so releases can
  be dispatched by automation.
