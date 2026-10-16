---
name: release-the-warlock-family
description: Publish and independently verify the lockstep Warlock.js package family from GitHub Actions (warlockjs/framework release.yml and blog-check.yml), including test and publish runs, reading CI logs without gh, registry-origin confirmation, docs, and recovery from partial releases.
---

# Release the warlock family

How to publish the 31-package `@warlock.js` family (30 `@warlock.js/*` packages
plus `create-warlock`) without half-releasing it, pushing something you did not
intend, shipping stale docs, or believing a build that never happened.

**Since 5.25.0, releases run on GitHub Actions, not on a developer machine**
(owner ruling, canon `32884462`). Start with "Release from GitHub Actions"
below. Everything after it explains the machinery that workflow runs (the same
`tools/release/scripts/release-family.ts` gate, publish and confirm), and it
matters when a run fails.

**One repository.** Every member, the docs site and the release tooling live in
`warlockjs/framework`: members under `packages/<name>`, the site in `docs/`, the
runner in `tools/release/` (npm-managed, outside the pnpm workspace). The old
per-package repos and `warlockjs/release` are archived. A release is ONE commit
(`release: v<version>`) and ONE tag (`v<version>`) on this repository. Sections
below that describe per-repo pushes, per-repo tags or `builder/` paths are
history from the per-repo era (5.0–5.29); the mechanics carry over with
`builder/` read as `tools/release/` and "every member repo" read as "the
monorepo".

---

## Release from GitHub Actions (5.25+)

**Move the family first.** `pnpm release:version <version>` (from the repo
root) sets every member's `package.json` to the version, moves the exact family
pins (peer/optional `@warlock.js/*` specs at the old version, `^`/`~` kept),
moves any real pin in the create-warlock template (its framework deps are
normally the `0.0.0-set-by-scaffolder` placeholder, filled from create-warlock's
own version at scaffold time), and refreshes the lockfile. It refuses unless
every member shares one current version and the new one is newer. Then date the
`## <version>` CHANGELOG headings, commit, push, and dispatch.

The workflows live in **`warlockjs/framework`** under `.github/workflows/`.
Secrets live on its `release` environment: `NPM_TOKEN` (publish) and
`BLOG_TEST_DEPLOY_KEY` (a read-only deploy key on the private `warlockjs/blog-test`). The
release commit and tag are pushed with the job's own `GITHUB_TOKEN`
(`permissions: contents: write` on the release job). The environment has no
required reviewer, by owner choice: a green gate authorises the publish.

### The workflows

- **`release.yml`** (`workflow_dispatch`, inputs `version` and `publish`).
  One job, on purpose: the handoff records absolute tarball paths and the
  gate's release commit, so gate, publish and confirm must share one runner.
  1. Checks out this repository (full history and tags, no persisted
     credential), clones the private `warlockjs/blog-test` beside it with
     the `BLOG_TEST_DEPLOY_KEY` deploy key over SSH (key written to
     `RUNNER_TEMP` and removed after), sets `core.fileMode false`.
  2. Checks every member's `package.json` is at `version`, then runs
     `pnpm install --frozen-lockfile` at the root and `npm ci` in `tools/release`.
  3. Runs `astro sync` in `docs/` (the strictness ratchet needs its types).
  4. **Gate**: strictness ratchet, every member's own `test` and `typecheck`,
     a clean tree per member directory, pkgist build, ONE family release commit
     (a no-op when the manifests are already at `version`), pack, and the
     local-registry install of all tarballs. Redis runs on 6390 as a service.
  5. **Blog on the tarballs** (`tools/release/ci/blog-check.mjs`, Postgres
     service, fresh database): install with exactly one physical core,
     typings + `tsc`, migrate + seed, devtools in dev (the request with its
     phases and queries, plus EXPLAIN), production build + start + Playwright
     smoke (8 pages, 5 forms at 375px, zero errors), `/__warlock` 404 in
     production, then `--role=worker` and `--role=api`.
  6. With `publish: true` only: npm publish, then confirm at npm origin
     (install + import + `npm create warlock`), then tag `v<version>` once on
     the release commit and push the tag and the branch, then the blog again
     from npm.
- **`blog-check.yml`** (`version`, `mode` = `tarballs`|`registry`,
  `artifacts_run_id`): the blog check alone, in about 5 minutes. In tarballs
  mode it reuses a release run's uploaded tarballs. Use it to iterate on the
  blog or the check script without repeating the ~25-minute gate.
- **`generator-matrix.yml`**: the owner-gated zero-edit matrix; see the
  `zero-edit-generator-matrix` skill.

### The procedure

1. **Prepare in source** (one commit or PR on `main`): bump every member's
   `package.json` version and every literal `@warlock.js/*` pin, date each
   `CHANGELOG.md` heading, run the llms projections (see "Docs are part of the
   release"). `main` clean and pushed; check `git ls-remote origin
refs/heads/main` against local `HEAD`. If any dependency changed, the root
   `pnpm-lock.yaml` must be committed with it (CI installs `--frozen-lockfile`).
2. **Test run**: dispatch `release.yml` with `publish` off. It must be green
   through the blog step. Fix, push, repeat.
3. **Publish run**: dispatch with `publish` on, with **no pushes to `main`
   between the green test run and this dispatch** (the run must build exactly
   what passed; the confirm step refuses if origin moved past the release
   commit).
4. **Verify independently**: `npm view <pkg>@<version> version` for the family
   and `git ls-remote origin refs/tags/v<version>` (one tag). If the in-run
   registry blog step fails, re-run `blog-check.yml` in `registry` mode before
   calling it done.
5. **Docs** (after npm is confirmed): add the `releases.json` entry (its
   `publishedAt` is `npm view @warlock.js/core time --json` for the version),
   run `node docs/scripts/generate-changelog.mjs` and
   `node docs/scripts/check-changelog-freshness.mjs` from the repository root,
   commit and push. The docs workflow publishes it; check that
   `https://warlock.js.org/changelog/` shows the version.
6. Write the release summary, then post to the embassy rooms.

### Driving it without the `gh` CLI

- **Dispatch**: the Actions "Run workflow" dropdown often fails to load. Open
  `https://github.com/warlockjs/framework/actions/manual?workflow=.github%2Fworkflows%2Frelease.yml`
  and submit that form (set `inputs[version]`, set or clear `inputs[publish]`,
  and check `branch` is `main`).
- **Status**: `https://api.github.com/repos/warlockjs/framework/actions/runs`
  and `.../runs/<id>/jobs` (unauthenticated only while the repository is
  public; otherwise send a token). That's 60 unauthenticated requests an hour,
  so poll every 90 s or less often.
- **Raw log**: open `https://github.com/warlockjs/framework/commit/<FULL sha>/checks/<jobId>/logs`
  in a logged-in browser. It redirects to a signed log URL (valid ~10
  minutes) that `curl` can fetch. A short sha returns a server error.
- A failing member's output keeps its **last** 28k characters, where the test
  runner prints what failed.

### Linux traps already fixed (don't re-learn them)

- Tests that assert Windows paths, Windows file locking, or backslashes must
  be platform-aware.
- `linkWorkspacePackages` makes `"*"` specs compile sibling **source**. A
  package with an older `lib` then type-checks newer code (create-warlock was
  on `es2021`).
- Every package whose `typecheck` runs `tsc` must declare `typescript`.
- Timer assertions need one tick of slack (`Date.now()` rounding).
- The dev server answers `/health/live` before pages are installed: wait for
  the `➜ Web` ready line before requesting a page.

---

## Read this first: the five things that will catch you

### 0. The family pins itself EXACTLY, so a partial release CANNOT install

Family packages peer-depend on their siblings by **exact version**, not by
range: `@warlock.js/auth@5.1.0` declares `"@warlock.js/core": "5.1.0"`.

So publishing a subset is not "a smaller release" — it is an **uninstallable**
one. Ship core at 5.2.1 and auth@5.1.0 still demands core 5.1.0; npm refuses
the tree with `ERESOLVE`. It does not matter that 5.2.1 would satisfy a caret;
there is no caret.

**Lockstep is not a convention here. It is the only satisfiable configuration.**
Every release publishes the whole family, at one shared version. A package that
did not change still gets a no-op bump — that is intended, and it is what makes
the tree resolvable.

**Never "fix" this by loosening a family pin to a caret.** A caret in an
intra-family spec is the defect, not the repair. Carets are correct for
third-party dependencies only. Canon `85d63e52`.

### Bumping the version does NOT bump every family spec

Most intra-family specs are `*` or `workspace:*`, and pkgist rewrites those to
the exact version when it builds the tarball. **A handful are written as a
literal version instead, and nothing rewrites those.** As of 5.6.0:

| package          | field                  | dependency           |
| ---------------- | ---------------------- | -------------------- |
| `create-warlock` | `dependencies`         | `@warlock.js/fs`     |
| `notifications`  | `optionalDependencies` | `@warlock.js/herald` |
| `web`            | `peerDependencies`     | `@warlock.js/core`   |
| `web`            | `peerDependencies`     | `@warlock.js/seal`   |

Do not trust that table — **derive the list**, because a new literal pin added
between releases will not be in it:

```sh
node -e "for (const d of require('fs').readdirSync('.',{withFileTypes:true})) { if(!d.isDirectory())continue; const p='./'+d.name+'/package.json'; if(!require('fs').existsSync(p))continue; const j=require(p); if(j.private||!/^(@warlock\.js\/|create-warlock$)/.test(j.name||''))continue; for (const f of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) for (const [k,v] of Object.entries(j[f]||{})) if (/^@warlock\.js\//.test(k) && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) console.log(j.name,f,k,v); }"
```

Left behind, `web@<new>` peer-depends on `core@<old>` and npm refuses the tree
with `ERESOLVE` — an uninstallable release, from a green build. The release gate
does catch it (`assertBuiltManifest` requires every `@warlock.js/*` spec to
equal the release version), but it catches it at `web`, which is **last**, after
every other package has been built and packed.

### 1. A release PUSHES GIT BRANCHES by default

`esm/git/operations.mjs:176` is `git.push("origin", branch)` — a **branch**
push, not a commit push. **All unpushed history on that branch goes**, not just
the release commit. Tags are created and pushed too (`:233-234`).

`context` and `scheduler` have sat **141 and 138 commits ahead** of their public
remotes. A routine release would have published all of that as a side effect
nobody chose.

**`--commit` only supplies the MESSAGE. It does not gate the push.**
Per-package `commit: false` is **dead config** under a family build
(`family-builder.mjs:41`) — the only lever is `--no-git`, and that is
all-or-nothing.

**Before releasing: know every repo's ahead/behind state, and mean it.**

### 2. Git runs BEFORE publish, PER PACKAGE

This is what turns any mid-run failure into a **partial release**: some repos
pushed and tagged, others untouched, and nothing published.

Combined with #3, an unbatched release does not merely fail — it fails _after_
pushing. And per #0, a partial release is unusable even when every individual
package is well-formed.

### 3. pkgist LEAKS. A full-family release cannot complete in one process.

`build:family` exits **134** at the same **~4085MB ceiling at every
concurrency**:

| concurrency | compiled before OOM | time   |
| ----------- | ------------------- | ------ |
| 20          | **0** of 28         | ~4 min |
| 4           | 13                  | 270s   |
| 2           | 15                  | 145s   |
| 1           | 15                  | 136s   |

**Concurrency 1 still dies**, so parallelism is not the cause — the process
never releases what each `tsdown`/`rolldown` build retains. `cache` and
`cascade`, where it always dies, each compile in **~2s in a fresh process**.
They are not hogs; they are where the running total crosses the line.

**All 28 DO build when batched across fresh processes.**

### 4. A "dry run" is not source-safe, and compiles nothing

`writeSourceVersion()` rewrites the version field into **all SOURCE
`package.json` files**. And `--dry-run` is **not** an escape:
`compile/tsdown-compiler.mjs:63-64` returns immediately under `dryRun`, so a
dry-run build **touches source while proving nothing**.

There is no flag combination in 1.6.3 that both compiles and leaves source
untouched.

---

## The release set — assert the LIST, never the count

**31 published names: 30 `@warlock.js/*` packages plus `create-warlock`** (5.25; `@warlock.js/devtools` joined then). The authoritative list is `tools/release/pkgist.config.ts`, and `WARLOCK_FAMILY_SIZE` in `tools/release/scripts/warlock-family.ts` must match it. Members are the direct children of `packages/`.

- Everything under `@warlock.js/*` **except `docs`**.
- **`create-warlock` is unscoped** and is a full lockstep member. A list built
  by scanning for `@warlock.js/*` silently omits it — that omission is exactly
  how the v5.2 release broke.
- **`@warlock.js/docs` is `private: true` and is NEVER published to npm.** It
  is the warlock.js.org site and deploys to GitHub Pages through GH Actions
  (warlock.js.org is hosted under js.org). Excluded from the npm set — but
  **not** excluded from the release, see "Docs are part of the release" below.
- `tools/release/` (`warlock-release-runner`) is private and never published.

Derive the set from the filesystem and **assert the names**, not the number:

```sh
# publishable family members, from source
for f in */package.json; do
  node -e "const p=require('./$f'); if(!p.private && /^(@warlock\.js\/|create-warlock)/.test(p.name||'')) console.log(p.name)"
done | sort
```

Two independent methods agreeing on a _count_ is not agreement — v5.2 had two
different routes both land on "28" while meaning different sets.

### Why `create-warlock` cannot be left behind

`create-warlock/src/helpers/warlock-versions.ts` stamps family versions into
every scaffolded app, resolving in this order:

1. **the scaffolder's own version, if the registry has it published**
2. otherwise the registry's `latest`
3. otherwise a caret floored to the major

Rule 1 wins. If `create-warlock` stays at the old version, `npm create warlock`
keeps scaffolding apps pinned to the **old** family forever — not broken, just
permanently invisible. The release would reach nobody starting a new project.

### Publish order

Exact pins mean every package published references siblings that do not exist
yet, so anyone installing mid-run gets `ETARGET`. Keep the window short and
order it: **leaf packages first, `core`/`web` late, `create-warlock` last.**

---

## Docs are part of the release, not after it

Every package ships `README.md`, `LICENSE` (MIT), `CHANGELOG.md`, `skills/`,
`llms.txt`, `llms-full.txt` — this is the `clone` array in the pkgist family
config. **Keep the clone array consistent across all family members.**

Before the build, for the packages that changed:

1. **Per-package `CHANGELOG.md`** — insert `## <version>`, **UNDATED**, directly
   below the header intro, above the previous top version, with typed sections
   (`### Added` / `### Changed` / `### Fixed` / `### Deprecated` / `### Removed`
   / `### Security`) as **short one-line bullets**, not paragraphs. A package
   only lists versions where it changed.

   > **No `## [Unreleased]` staging** — removed 2026-06-21 (Hasan's call). The
   > generator hides it (`SHOW_UNRELEASED = false`). Do not add one to any
   > package. Track pending notes outside the repos.

   **THE DATE IS GATED ON `package.json`, NOT ON THE PUBLISH.** `core`'s own
   `tests/unit/meta/release-hygiene.test.ts` enforces it, and the rule is:

   - While the changelog's top version is **AHEAD** of `package.json` — the
     staging window, before the bump — it **must be UNDATED**:

     ```
     staged next version 5.3.2 carries a release date (2026-09-05) — a not-yet-released
     version must stay undated (audit F9)
     ```

   - Once `package.json` has been bumped to that version, the heading **matches**
     and a date is permitted. Every prior entry in these files carries one, so
     ship it dated — an undated top entry beside twenty dated ones reads as an
     omission.

   So the order is: **write the section undated → bump the family → date it →
   gate → publish.** Measured 2026-09-05, both halves: dating before the bump
   turned core red, and dating after it went green.

   This instruction previously said to write `## <version> - <date>` with no
   qualification, which is what turned core red in the first place. **The
   mechanical gate is authoritative over this file** — nothing type-checks a
   sentence.

   The heading line must carry **nothing but the version and, once shipped, a
   date**. The date separator accepts a hyphen or an **en dash** but **not an em
   dash** — which our prose uses constantly. Only `core` has a hygiene gate and
   **it inspects only the TOP heading**, so a bare `## 5.1.0` goes green with
   older versions undocumented. The other 27 are unguarded — which means the
   only thing keeping them right is this instruction being right.

2. **Skills → `llms.txt`/`llms-full.txt` → docs mirrors — a projection chain, run
   in THIS ORDER for every package whose public surface changed.**
   `llms.txt`/`llms-full.txt` are pure PROJECTIONS of each package's `skills/`:
   they encode no API, no exports, not even the version, and are never
   hand-edited (see `<pkg>/scripts/generate-llms.mjs`). So "update llms" is
   impossible without first editing the skill.

   1. **Author the skill.** Edit the owning `<pkg>/skills/<skill>/SKILL.md` for
      the new/changed public surface — a new exported symbol, config key, CLI
      command/check, or changed behaviour.
   2. **Regenerate the package projection:** `node <pkg>/scripts/generate-llms.mjs`
      (per changed package — there is NO monorepo aggregator). Rewrites
      `<pkg>/llms.txt` + `llms-full.txt`, which ship in the tarball.
   3. **Regenerate the docs mirrors:** `cd docs && node scripts/generate-site-llms.mjs`
      — rebuilds `docs/public/<pkg>/llms*.txt` + the site aggregate from the
      package llms. This is **NOT** in the docs `prebuild`, so it must be run by
      hand.
   4. **Re-sync agent skills** ONLY if a workspace `skills/*` SOURCE skill changed:
      `npx agent-kit sync` (regenerates `CLAUDE.md` + the agent skill dirs). The
      per-package `<pkg>/skills/` are a different set from the workspace `skills/`.

   **GATE — every public-API change in the release diff must be reflected in its
   owning skill BEFORE the build.** For each new exported symbol / config key /
   CLI check in the diff, grep the owning skill (and, after regen, its
   `llms-full.txt` and `docs/public/<pkg>/llms-full.txt`) for it. A CHANGELOG
   bullet ALONE is not enough: the skills → llms → docs chain does not read
   `CHANGELOG.md`, so a CHANGELOG-only change ships a stale llms/docs surface.
   This is exactly what the 5.8.0 release missed — code + CHANGELOGs were done,
   but auth `pageAuth`, cascade `Migration.foreignId`, and the doctor
   `jwt-secret` check were never added to the skills, so `llms.txt` and the docs
   mirrors omitted the entire 5.8 API until it was caught after publish.

   **The human docs SITE is a SEPARATE surface — check it too.** `docs/src/content/docs/v/latest/<pkg>/`
   is hand-written content, NOT projected from skills/llms, so updating the skill
   does nothing for it. For each new public API, grep those content pages
   (`.md`/`.mdx`) and add usage where a reader would look — the essentials/
   reference page for the symbol AND any recipe that now has a better answer.
   5.9.0 missed this: seal `.coerce()` was in the skill, llms and CHANGELOG, but
   the `seal/recipes/coerce-query-params.md` recipe still taught the old
   `v.numeric()` / hand-rolled `.addMutator()` workaround and never mentioned
   `.coerce()` — the owner found the hole. So the doc-surface has THREE targets,
   not two: (a) the owning skill → llms, (b) the docs `public/` llms mirror,
   (c) the hand-written docs content pages.

3. **New package joining the family?** Add it to the features page and to the
   pkgist family config as well — a new member is not just a new directory.

---

## Rehearsing safely

**`--no-publish` AND `--no-git` together.** Both. `--no-git` alone still
publishes — `commitIsOnRemote` stays true (`package-builder.mjs:84`).
Verified sufficient: `--no-publish` short-circuits at `:130`, _before_ that
test.

**Pin `--bump` to the version already in source** (e.g. `--bump 5.0.2` when
source is 5.0.2). `resolveVersion()` returns an explicit semver as-is rather
than bumping, so the source rewrite becomes a no-op.

**`web/package.json` has CRLF endings** and gets rewritten to LF with identical
content. Back it up first and restore it byte-identically; verify by md5.

**Invoke the binary directly. Never through `npx` or `pnpm exec`** — canon
`50608334`. A run on 2026-08-26 got a false "0 errors" purely because npx failed
to resolve the binary. If pkgist fails, **stop and diagnose — never fall back to
a manual `npm publish`.**

---

## Before you release

1. **Sweep all three git status columns for every package directory** —
   untracked, unstaged deletions, unstaged modifications (canon `cf099533`);
   `git status --porcelain -- packages/<name>`. The gate refuses a dirty
   published surface per member, but know the state before it tells you.
2. **Confirm `main`'s ahead/behind against origin**, deliberately. A surprise
   here is a stop, not a merge.
3. **Assert the release set by name** (see above) and confirm it is the whole
   family. A subset cannot install.
4. **CHANGELOGs, `llms.txt`, `llms-full.txt`, `skills/`, `releases.json`** are
   written **before** the build — `CHANGELOG.md` and the rest are in `clone`,
   so the build is what commits them into each repo and each tarball.
5. **Decide the batch boundaries** and know which packages are released and
   which are not at each one.
6. **Ask the owner whether the generator matrix runs this release** — in the
   Bureau room, before you start, not mid-run. It is **OFF by default** and the
   release ships without it; only an explicit owner authorisation turns it on
   (canon `e00fb7b8`). Bring the rows the diff touches, the cost, and a
   recommendation.

   **Then state the scope you ran — in the release summary and in
   `docs/src/data/releases.json` — on EVERY release, including the skipped
   ones. A release whose scope is not stated must not ship.** Quote the
   authorisation's date and the owner's actual words; a Bureau-only reference is
   a dangling pointer everywhere else (canon `09374678`). See the
   `zero-edit-generator-matrix` skill.

   **Since 5.6 the runner enforces the first half of this.** `--matrix none |
subset | full` is required on a gate run and has no default; `subset` and
   `full` additionally require `--authorised-by`, `--authorisation-date` and
   `--authorisation "<their words>"`. The scope, the rows and the quoted
   authorisation ride in the handoff, so the publish step can read them back
   instead of trusting a memory. What is still yours to write is the prose: the
   summary paragraph and the `releases.json` field.

   `none` skips the matrix and **nothing else** — the local registry is still
   owned, all 31 tarballs are still staged, and every member is still confirmed
   installable. Skipping the matrix is not skipping the gate.

### Exact invocation (verified 5.9.0)

Run all three modes from `tools/release/`, and `--version X.Y.Z` is **required on every
one** (the gate refuses with `--version is required and must be an exact semver`;
it does NOT derive the version from source):

```bash
node --import tsx scripts/release-family.ts gate    --matrix none --version 5.9.0
node --import tsx scripts/release-family.ts publish  --version 5.9.0
node --import tsx scripts/release-family.ts confirm  --version 5.9.0
```

- **Publish auth (since builder `8304b52`):** the publish env falls back to the
  token in the user's global `~/.npmrc` when `NPM_TOKEN` is not set — so an
  interactive release needs neither a per-release env var nor a manual `npm
publish`. `NPM_TOKEN` still wins when present (CI).
- **`confirm` after publish:** a 404 can be propagation lag; never republish.
  Registry views and install/import/scaffold checks share one thirty-minute
  deadline with three-to-sixty-second exponential backoff. Already-live
  packages are not re-polled, and failed consumer/scaffold checks retry in clean
  directories. Confirmation success tags the recorded commit and pushes its
  tag and branch.
- **Failed confirmation on a runner:** preserve the uploaded
  `warlock-<version>-logs` and `warlock-<version>-artifacts` artifacts. The logs
  contain `release-commit.bundle`; the artifacts contain
  `release-artifacts/<version>/build-provenance.json`. Follow the printed
  recovery commands from the repository root to restore provenance, import the
  bundle, verify the recorded SHA and origin ancestry, push the recorded tag
  and branch, then run `blog-check.yml` with `mode=registry`. Wait for every
  subject to become visible first. A no-op release uses the dispatched commit
  recorded in provenance; do not create a replacement release commit.
- **Read the run's own EXIT= line, not the harness exit code** (canon `6c7ca5ab`).

## Mandatory local-registry pre-gate — before npm origin

The npm registry is not a staging environment. **No npm-origin publish is
attempted until the exact candidate has passed the full release gate through an
owned local registry.** The fenced release runner is the authority for this
transition; an operator does not skip ahead to an `npm publish` command.

The runner must perform these steps in order:

1. Independently derive the publishable family from the top-level source
   manifests and reconcile it with the `warlock` declaration in
   `tools/release/pkgist.config.ts`. Compare the **names and resolved roots**, require
   one exact source version, and only then apply the family size (31) as a secondary invariant.
   Two lists that merely have the same count have not agreed.
2. Build every reconciled member in a **fresh pkgist process** with the exact
   release version and both `--no-publish` and `--no-git`. pkgist 1.6.3 accepts
   an individual family member through `pkgist build <package-name>`; this is
   the bounded way around its measured cross-build heap retention. Invoke the
   installed binary directly, never through `npx` or `pnpm exec`.
3. Unpack each candidate and parse its manifest. Require the expected name and
   exact version, and inspect `dependencies`, `peerDependencies`, and
   `optionalDependencies` as objects: every `@warlock.js/*` value must be the
   exact shared version and no `workspace:` value may survive.
4. Pack each build once, record its SHA-256, and make those tarballs immutable
   inputs to the remaining stages. **Do not `grep` the archive for
   `workspace:`.** The literal legitimately appears in sourcemaps and doc
   comments, while a bad parsed manifest can evade an archive-text check.
5. Start an owned Verdaccio instance on a verified-free loopback port with
   isolated temporary storage and an npm uplink for third-party packages.
   Explicitly set and assert the registry URL, cache, environment, port, and
   temporary roots. Stage all 31 exact tarballs there; do not rebuild them.
6. Against that registry, run the complete zero-edit generator gate below:
   derive the feature list from the installed CLI, run every isolated
   `warlock add <feature>` path and the composed path, require exact pins and a
   clean single-Core install, then typecheck, boot, build, start, exercise every
   generated route/command, and run the Web browser/HMR/red-control assertions.
   Generated files are not repaired to make the gate pass.
7. Only a fully green gate may emit a machine-readable **publish handoff**. The
   handoff contains the exact version, ordered 31-name subject list, tarball
   paths, and hashes. A failure emits no handoff.
8. Production publication consumes that handoff, re-hashes every tarball, and
   refuses any missing, added, rebuilt, or changed input. The fenced release
   runner may then publish those exact pkgist-built tarballs to
   `https://registry.npmjs.org`; this is the narrow normal-release exception to
   the ban on direct `npm publish`.

Local staging proves the candidate's family graph, generators, install, and
execution against registry semantics. It does **not** prove npm credentials or
authorization, npm accepted or serves the tarballs, npm propagation, dist-tags,
the sequential-publish `ETARGET` window, or Git branch/tag state. Those remain
separate npm-origin and remote properties.

## After you release — short npm-origin confirmation

Verify against the **registry origin**, by installing and executing — never
against a client cache or the publisher's own log (canon `e0484b63`,
`add5bd30`). Nothing measured inside this checkout is evidence about a
published install (canon `6b7ab838`). The npm-origin confirmation is
deliberately short, but it still proves the two properties local staging cannot.

**How short it may be depends on the scope you ran, and this sentence used to
get that wrong** — it said "the full generator matrix already ran against the
staged candidate", which stopped being true the moment the matrix became
opt-in. On a `none` release nothing has proven that what you publish actually
works; the steps below are then the ONLY execution against the published
artifacts, and step 5 (scaffold, install, execute) is the whole of it.

The gate is:

1. Query every handed-off name and exact version at the npm registry origin,
   bypassing client caches. This proves npm accepted and serves every tarball.
2. During the ordered publish, distinguish expected transient `ETARGET` from a
   completed release: after the final package, repeat origin reads and refuse
   the handoff as complete while any member is absent. This closes the
   sequential-publish window rather than treating an intermediate install as a
   release verdict.
3. In a fresh external app with an empty npm cache and explicit npm origin,
   install the exact version of Core and at least one package whose sibling pin
   must resolve. **`npm ls --all` must be clean** — one Core instance and no
   `ELSPROBLEMS`. **No `--force`, no `--legacy-peer-deps`**.
4. Import and **execute** the installed package.
5. Run exact-version **`npm create warlock` into an empty directory**, confirm
   it stamps the new version, then install and execute the generated result.
   This confirms npm-origin version resolution without rerunning the full local
   generator matrix.

### Only after the npm-origin gate passes — update and deploy the site

The site must never announce a version that the registry-origin gate has not
accepted. Do not prepare, regenerate, commit, or push its release entry before
that gate passes, and do not run this work in parallel with publication.

1. Read `time[<exact-version>]` for `@warlock.js/core` from the npm registry
   origin. Add that full ISO timestamp as `publishedAt` in
   `docs/src/data/releases.json`, keyed by the exact version, plus one short
   `summary`. Inline `code`, **bold**, and links are allowed; the generated
   per-package bullets carry the detail.
2. From the monorepo root, invoke the checked-in scripts directly — never
   through `npx`, `pnpm exec`, or a package-manager alias:

   ```sh
   cd C:/Work/Warlock.js
   node docs/scripts/generate-changelog.mjs
   node docs/scripts/check-changelog-freshness.mjs
   ```

   Parse `docs/src/data/changelog.json` and require its first release version to
   equal `<exact-version>`. The freshness check must pass against the registry
   origin; its unreachable-registry escape is not permission to deploy a
   version the registry gate did not accept.

3. Inspect the exact docs diff, commit it (only `docs/` paths) and push `main`,
   then verify that the rendered warlock.js.org changelog serves
   `<exact-version>`. This is a GitHub Pages deploy, not a pkgist release, so a
   hand commit of `docs/` is intended; the never-commit-by-hand rule below
   applies to the release edits (package manifests).

If this docs step fails after all packages passed the npm-origin gate, **the
package release remains released**. Do not fail or roll back that immutable
release. Instead, put a loud `DOCS OUTSTANDING: <exact-version>` item in the
recorded release output, include the failure, and include this exact recovery
command:

```sh
cd C:/Work/Warlock.js
node docs/scripts/generate-changelog.mjs
node docs/scripts/check-changelog-freshness.mjs
```

The outstanding item remains open until the docs diff is committed and pushed
and the rendered page is verified at the exact version. A green install proves
the packages, not the site.

### The scaffold is the start of the generator gate, not the endpoint

The base scaffold passing proves only `create-warlock`. It does not prove any
feature users add next. Canon `4bbd630e` requires the same release gate to
execute **every supported `warlock add <feature>` path** against the published
packages.

Derive the feature subject list from the installed CLI (`warlock add --list` or
its feature map); never copy a remembered list into the gate. For every listed
top-level feature:

1. Start from an untouched registry-origin scaffold in an external directory.
   Invoke the installed Warlock binary directly with `add <feature>`. Let the
   generator resolve its declared prerequisites; do not pre-create the output
   it is meant to generate.
2. Make **zero edits** to generated files. If the app needs a manual repair to
   boot, hydrate, typecheck, or build, that generator path is red. A repaired
   fixture may isolate the downstream runtime, but it cannot clear the release.
3. Parse `dependencies`, `peerDependencies`, and `optionalDependencies` after
   generation. Every `@warlock.js/*` spec the generator writes must come from
   the publisher's shared version source and equal the exact release version,
   never a caret or other range. Then require clean `npm ls --all`, no
   `ELSPROBLEMS`, and exactly one Core instance.
4. Execute the generated result in development and production with explicit
   environment and an owned, verified-free port. At minimum require typecheck,
   boot/readiness, production build, production start, and a real request to
   every route or command the feature introduced. Feature-specific external
   services may use documented local test doubles; missing credentials do not
   justify skipping generated-code loading or build.
5. For `web`, drive a real browser: click a state-changing control, use `Link`
   and prove there was no document navigation, apply an HMR edit without a
   manual refresh and prove state survived, require zero console/page errors,
   repeat click/Link checks against the production build, and run a mutation
   that makes the same automation fail before restoring green.

Also run the normal composed user path (adding the applicable features to one
scaffold in dependency order) so individually green generators cannot hide
collisions in shared config, scripts, routes, or files. Keep each isolated path
as the diagnostic control.

Record the derived feature list and a result for every member. An omitted
generator is an unverified release surface, not a pass.

A published version is **immutable**. A bad publish is not repairable — it
costs you that version number, and recovery means the next one. Deprecate the
bad version only _after_ its replacement is green.

### The tool's own output is not evidence

**pkgist can exit 0, print `26 published`, and have published 25.** This
happened on 2026-08-11: two `ETIMEDOUT`s against the registry were printed
inline, counted as successes, and `@warlock.js/cascade` never landed. Because
the family pins siblings exactly, `@warlock.js/core` was uninstallable for
every user until someone noticed.

**"25 of 26 published" is not 96% of a release. It can be 0%.** That is why the
check below is every package, never a sample.

```bash
# 1. EVERY package against the registry ORIGIN. `npm view` reads a cached
#    packument and can be minutes stale — force an origin read.
for p in <every published name>; do npm view "$p" version --prefer-online; done

# 2. Install into a CLEAN directory — core AND a package that depends on a
#    sibling. Installing core alone never exercises the lockstep pins resolving
#    as PUBLISHED dependencies, which is exactly what a missing sibling breaks.
# 3. EXECUTE it. Importing is the check; a file listing is not.
```

**Have someone who did not perform the publish run the install independently.**

### Recover the git pushes — plan for it, don't react to it

**pkgist pushes to git BEFORE it publishes to npm, and keeps publishing when the
push fails.** It warns inline and never summarises. On 2026-08-11, **11 of 26
repos** published to npm with their commit unpushed; the 4.11.0 release left 16
in the same state, undiscovered for a day.

A recovery sweep must have three properties, each learned by getting it wrong:

1. **Check the remote first and skip what is already done.** A non-idempotent
   retry creates fresh half-states — a tag pushed against a commit that never
   landed.
2. **Tag only after the commit push succeeds**, and **bound the retries** (3–5,
   not "until it works"). Any two-step remote operation can lose the second
   half; ordering chooses which half, idempotence closes it.
3. **THREE states, never two: `PRESENT` / `ABSENT` / `COULD-NOT-ASK`.**
   `git ls-remote` failing prints nothing, so `grep -q` reports it as absent. A
   sweep that conflated them reported **0 of 26 tags present** when the true
   answer was "the network was down". Refuse to print a total when anything is
   in the third state.

### Write `releases/<version>-summary.md` — required

**A release is not finished until this file exists.** It lives in `releases/` at
the workspace root and is written **for the people who install the packages**:
no task ids, no internal process, no tooling detail.

1. **Anything requiring the reader to ACT comes first** — a security fix, a
   data-loss defect, a migration. If a defect left bad rows in their database,
   say so at the top with the exact command and a way to check _before_
   upgrading.
2. **Each defect: what broke, what it looked like, what changed.** A table of
   "configured → what happened" beats a paragraph.
3. **Name behaviour changes as potentially breaking**, with what to check.
4. **A verification section stating how each claim was checked**, and stating
   plainly what could _not_ be verified. "5 of 26 confirmed, 21 unverified, none
   known missing" is a better sentence than silence.

`releases/4.12.0-summary.md` is a worked example.

---

## Recovery

- **One member failed to publish while the rest succeeded.** pkgist 1.6.3 does
  accept a family member by name: `pkgist build <family-member> --bump
<exact-version> --no-publish --no-git`. That is useful when intentionally
  producing a new candidate, but it is **not** the first recovery move: it
  rebuilds the package, changes the bytes, and therefore requires a new local
  gate and publish handoff. Re-running `build:family` is worse — it rebuilds
  everything and re-attempts publishes that must fail as duplicates.

  **Publish the artifact pkgist already built** — the same bytes its failed
  upload would have sent:

  ```bash
  cd tools/release/builds/@warlock.js/<name>/<version>
  node -e "const p=require('./package.json');console.log(p.name,p.version,p.main,p.module)"
  npm publish --access public \
    --registry https://registry.npmjs.org \
    --userconfig <isolated-npm-origin-userconfig> \
    --cache <fresh-empty-cache>
  ```

  This is the recovery form of the same narrow exception used by the fenced
  release runner: pkgist built these exact bytes in that run, and no pkgist
  publish-only verb exists. The isolated userconfig contains only the explicit
  npm-origin registry and the intended npm-origin credential; the process must
  start with unrelated `npm_config_*` / `NPM_CONFIG_*` values (including scoped
  registries, proxy settings, and Verdaccio auth) removed. Assert the effective
  registry is exactly `https://registry.npmjs.org` before publishing. **Verify
  the entry points and recorded artifact identity first, and say plainly in the
  release summary that recovery bypassed the normal local-gate handoff and
  why.**

- **A publish "succeeded" but the registry disagrees.** `npm view` reads a cache
  and can lag by minutes. Re-read with `--prefer-online` or fetch
  `https://registry.npmjs.org/<name>` directly. Only conclude a publish failed
  after an origin read says so. Canon `c44fcb2f`.

- **Wrong version published.** `npm unpublish <name>@<bad> --force` works
  **within 72 hours** of publish and removes it entirely — cleaner than leaving
  a broken tombstone, and worth preferring while the window is open. Note npm
  will not accept that same version again for 24 hours, so the replacement is
  still the _next_ number. Outside 72h, publish a new patch and `npm deprecate`
  the bad one, pointing at the replacement.

---

## Known gaps & quirks

- **Cross-deps are pinned EXACTLY in the published artifact.** Source manifests
  may carry `workspace:` or `*`; pkgist rewrites siblings to the exact version
  at build time. Verified 2026-08-11 by reading the published package, _after
  this file had said otherwise_. The consequence is the whole point: one member
  missing from the registry makes every package that pins it uninstallable.
- **CI does not sweep a release.** The monorepo's CI runs on every push and PR,
  but nothing re-checks the published packages afterwards. The registry check is
  the sweep.
- **Heterogeneous build modes.** ESM-only (`core`, `auth`), dual (`cascade`),
  and source-served (`fs`, `logger`) packages coexist. The family config must
  mirror each package's existing `main`/`module`/`typings` — read the
  `package.json`, don't apply one template to all. `create-warlock` is a CLI
  scaffolder; match its `bin`/entry.
- **LICENSE** — every package carries an MIT `LICENSE` and lists it in `clone`.

---

## Standing principles

- **Always dry-run before the real build.** No exceptions — but remember a dry
  run still rewrites source versions and compiles nothing.
- **Lockstep — the family moves together.** Never hand-bump one package off the
  shared line except to hotfix a single package.
- **Stamp and sync the changelog before the build.** The tarball must carry the
  dated `CHANGELOG.md`; the site must show the release.
- **Never `npm publish` manually.** The two narrow exceptions are (1) the
  fenced release runner publishing the exact tarball hashes from a green local
  publish handoff, and (2) the built-artifact recovery above. Neither exception
  permits rebuilding, substituting files, or publishing raw package source.
  **Never hand-commit the release edits (version bumps) or hand-push the release
  commit or tag** — the runner owns that. Docs-only commits are the one exception.
- **The tool's own success output is not evidence.** An exit code, a success
  line and a count are claims the tool makes about itself. A partial failure it
  treats as a completed run is invisible to all three. Ask the system that knows
  — the registry, the remote, the rendered page.
- **Verify the PROPERTY, not the step.** "The publish command succeeded" and
  "the package is installable" are different claims. "The push exited 0" and
  "the tag is on origin" are different claims. "The docs pushed" and "the site
  serves the new version" are different claims. Check the second of each pair.
- **Never pipe a command whose exit code you need through `tail`/`head`, and
  never end with `; echo`.** The status recorded is the last command's. A
  crashed test suite and a failed build were both reported as exit 0 on
  2026-08-11.
- **Before publishing, assert every package's top changelog heading is the
  version being released.** One package once said `## Unreleased` while 25 said
  `## 4.12.0` — findable only by comparing across packages, which nobody does
  unprompted.
- **A step that cannot be verified is reported as unverified, not omitted.**
  Distinguish "I checked and it is wrong" from "I could not check".

## See also

- `develop-warlock.js-feature` — the feature loop (code + tests + skills +
  docs). It must NOT stage into a `## [Unreleased]` block; the version section
  is written here, at release.
- `releasing-mongez-monorepo` — the sister playbook for `@mongez/*`
  (independent versions, per-package CI); shares the pkgist mechanics and the
  `--bump` / `--commit` CLI overrides.

---

## The harness lies about crashes

The background-task harness reported **exit 0 for all three OOM crashes** on
2026-08-26. The 134s came only from the runs' own exit lines.

**Read the run's own exit line. Never the harness's.** Canon `6c7ca5ab`,
confirmed live three times in one night.

---

## What `builds/` is and is not

`builds/<version>/` is **not an archive** — it holds the last build stamped with
that version, not the release (canon `8d02dad8`). Re-running a build against an
already-released version overwrites those artifacts.

`tools/release/sources/` is **generated** — pkgist's `package-builder.mjs:60-65` does
`copyDir(packageRoot -> sources/<pkg>)` as a release step. It is write-only and
never deletes (canon `58e4b00e`), so files deleted upstream linger as orphans.
Do not hand-edit it; the next release overwrites it.

`tools/release/pkgist.config.ts` is tracked in the monorepo (it was once purely
local, with no backup).
