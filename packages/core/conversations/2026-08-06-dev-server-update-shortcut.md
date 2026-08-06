---
session: 2026-08-06-dev-server-update-shortcut
date: 2026-08-06
topic: "@warlock.js/core dev-server update check — offline safety + `u` shortcut to update & restart"
status: in-progress
---

# Dev-server update check: offline safety + `u` shortcut

## Scope (from Hasan)

1. Make sure the dev-server "check for updates" does **not crash the server when offline**.
2. Introduce a keyboard shortcut (`u`) shown in the update notice: press `u` → update the
   `@warlock.js/*` package versions, install them, then restart the dev server. Is it applicable?

## Findings (verified by reading source)

- `src/utils/npm-registry.ts` → `fetchLatestVersion()` already wraps everything in `try/catch`
  and returns `undefined` on any failure (offline, DNS, abort, non-200, bad JSON). Timeout 30s.
- `src/dev-server/check-for-updates.ts` → `checkForFrameworkUpdate()` wraps its whole body in
  `try/catch`, so it can't reject. Called fire-and-forget from `dev-server.command.ts:35`.
  → **Offline already cannot crash the dev server.** Gaps found: (a) 30s budget is far too long
  for a courtesy check on a hanging network, (b) no regression test proving it.
- `src/updater/update-warlock-packages.ts` → **real defect**: when every registry lookup fails
  (offline), `updates.length === 0` and it prints "All @warlock.js packages are already up to
  date" — a lie. Also `installDependencies()` uses `execSync`, which **throws** on install
  failure; acceptable for the one-shot CLI, fatal for an in-dev-server shortcut.
- No `process.stdin` / raw-mode usage anywhere in the dev server → the `u` shortcut needs a new
  keypress layer, and taking raw mode means owning `Ctrl+C` ourselves.
- `warlock dev` is a single foreground process (`bin/warlock.js` → `esm/cli/start.mjs`), and
  persistent commands do not `process.exit` when their action resolves
  (`cli-commands.manager.ts:449`) → a self re-exec restart is applicable.
- `connectorsManager.shutdown()` closes the http connector → the port is released before the
  replacement process boots (no EADDRINUSE).

## Decisions & approvals

- [x] Answer to Q2: **yes, applicable** — implemented as raw-mode keypress + re-exec restart.
- [x] Restart mechanism: parent shuts the server down, spawns `process.execPath` with the same
      argv/execArgv and `stdio: "inherit"`, ignores signals, then exits with the child's code.
      (Keeps `npm run dev` semantics intact; costs one thin waiter process per update.)
- [x] Raw mode is enabled **only while an update is pending**, and released before handing the
      terminal to the package-manager child. Not an always-on shortcut bar (see open question 1).
- [ ] Awaiting Hasan's review before commit / publish.

## Tasks

- [x] Read dev-server + updater + cli sources
- [x] `shortcuts.ts` — raw-mode keypress manager (Ctrl+C safe)
- [x] `restart-dev-server.ts` — graceful shutdown + re-exec
- [x] `check-for-updates.ts` — short timeout, `u` hint, shortcut wiring
- [x] `update-warlock-packages.ts` — offline-aware outcome, non-throwing install
- [x] `dev-server.command.ts` — await server ready, pass instance to the check
- [x] Unit tests (offline paths + outcome resolution + shortcuts)
- [x] Skill `skills/update-packages/SKILL.md`
- [x] Docs site page + changelog

## Open questions I asked

1. Always-on shortcut bar (`r` restart / `q` quit / `h` help) as a follow-up? — recommended yes,
   separate change.

## Verification

- Real network probe (not mocked), `fetchLatestVersion` against the live registry:
  - online → `4.8.2` in 687ms, exit 0
  - all traffic forced through a dead proxy (connection refused) → `undefined` in 32ms, exit 0
  - blackhole proxy (packets dropped) → `undefined` in 5011ms, exit 0 — the 5s abort budget holds
- `tsc --noEmit` clean for every touched file (repo-wide run has pre-existing errors in unbuilt
  sibling packages).
- New suites green: 59 tests across shortcuts / check-for-updates / npm-registry / updater.
- Full core suite: the only failures are 3 pre-existing ones, confirmed by stashing this work —
  `define-config` (cwd path), `own-resolver.equivalence` (import), `release-hygiene`. The staged
  `## 4.9.0` changelog heading actually **fixes** the release-hygiene failure.

## Round 2 — Hasan's answers (all three)

1. **Yes** → always-on shortcut bar built: `r` restart, `c` clear, `q` quit, `h` help
   (`src/dev-server/register-dev-shortcuts.ts`, armed from `startDevelopmentServer` only after
   `start()` resolves). `u` still comes from the update notice and joins the same bar; `h` lists
   whatever is armed via the new `DevServerShortcuts.list()`.
   - Bug this exposed: with the bar armed, `unregister("u")` no longer empties the map, so raw
     mode would have stayed on while the package-manager install owned stdio. The `u` handler now
     calls `release()` explicitly and `resume()` only when it is *not* restarting.
2. **Yes** → 4.9.0. ⚠ A concurrent session had already staged a 4.9.0 entry in
   `docs/src/data/releases.json` (ai + ai-openai, dated July 22 2026). Lockstep means one version
   carries every package, so core's changes were **appended** to that entry rather than replacing
   it, and `@warlock.js/core` was added to `featured`.
3. **Agreed** → no `devServer.updateShortcut` knob; `checkForUpdates: false` remains the only one.

## Docs done (round 2)

- `core/CHANGELOG.md` `## 4.9.0` — shortcut-bar bullet added.
- `core/skills/run-app/SKILL.md` — new "Keyboard shortcuts" section + trigger phrases.
- `core/skills/update-packages/SKILL.md` — cross-links the bar instead of repeating the raw-mode note.
- `core/llms.txt` + `core/llms-full.txt` — regenerated (38 skills).
- `docs/src/content/docs/v/latest/core/cli/cli-commands.md` — `#### Keyboard shortcuts` +
  `#### The update notice` under `dev`, and an offline paragraph under `update`.
- `docs/src/data/releases.json` + regenerated `docs/src/data/changelog.json`.
- `docs/public/llms.txt` + `docs/public/llms-full.txt` — regenerated (19 packages).

Verified live on the local docs server: `/changelog/` renders the 4.9.0 core block (anchor
`v4-9-0`, mentions core / keyboard shortcuts / the offline fix) and
`/v/latest/core/cli/cli-commands/` renders the 6-row shortcut table with no horizontal overflow
and no console errors.

## Not done (deliberate)

- No commit, no version bump, no publish.
- `docs/` working tree also carries a concurrent session's changes (`Header.astro`, and their
  share of `changelog.json` / `releases.json` / `public/llms-full.txt`) — do not commit the docs
  repo wholesale without checking with them.

## Round 3 — workspace split + supervisor decision

**Supervisor: APPROVED as recommended** — not a standalone roadmap item; it is *how* auto-restart
on config change gets built. Queued with items 2 (bun in the updater), 3 (cache the update check),
and the `spawn("node")` → `process.execPath` one-liner in `start-production.command.ts`.

**Correction owed to Hasan:** he asked whether I had removed the `@mongez` entries from the new
warlock builder. I had **not** — I kept the full copy and raised it as an open question. Now done.

**Runner split (one per family, registries disjoint):**

| Runner | Owns | Packages |
| --- | --- | --- |
| `@warlock.js/builder` (`warlock-release-runner`) | `warlock` family only | 27 |
| `@mongez/builder` (`mongez-release-runner`) | `@mongez/*` only | 25 (20 standalone + `atom` + `localization`) |
| `compiler-v2` | legacy, trimmed to mongez-only, superseded | 25 |

Split done by bracket-matching the `standalone` / `families` arrays (no line-number assumptions);
backups of both original configs are in the session scratchpad. Verified: `pkgist validate` clean
on all three, `pkgist list` resolves 27 / 25 / 25 roots, and cross-contamination greps return 0
both ways.

Also created `@mongez/.claude/` (3 mongez skills + `mongez-docs` launch on 4322) mirroring
`@warlock.js/.claude/`, repointed every skill's `compiler-v2` reference at its new runner, and
updated the global `CLAUDE.md` publishing section to document the split.

## Round 4 — the code (all approved items built)

`compiler-v2` → **`compiler-v2.legacy`** (retired, per Hasan). `ui-ux-pro-max` left at the node root.

**Supervisor** (`src/dev-server/supervisor.ts`) — `warlock dev` is now a supervisor + worker pair.
Contract: worker exits `75` (`RESTART_EXIT_CODE`) to ask for a replacement; supervisor respawns.
Anything else is mirrored and the supervisor stops. Marker is `WARLOCK_DEV_WORKER=1` (env, not a
CLI flag, so the public surface is unchanged).

Two design points that mattered:
- The branch lives in the command's **`preAction`, not `action`** — preAction runs BEFORE the
  preloaders, so the supervisor never loads config or starts connectors. In `action` it would have
  held a second DB connection open for the whole session. `superviseDevServer()` returns a promise
  that never settles precisely so nothing downstream of it runs.
- Shortcuts stayed in the **worker**, not the supervisor. Keyboard isolation was the one supervisor
  benefit I'd already judged theoretical; keeping it in the worker made this a much smaller change
  for the same real value.

`restart-dev-server.ts` shrank to shutdown + `exit(75)`; the old re-exec/waiter path is gone. It
returns `false` (rather than exiting) when there is no supervisor, so a programmatic
`startDevelopmentServer()` never kills a server it cannot replace.

**Auto-restart** — `warlock.config.ts` or any `.env*` in a batch triggers a restart;
`devServer.restartOnConfigChange: false` restores the warning. If a restart is declined or
impossible, the batch's ordinary code files still hot-reload (deliberately no early `return`).

**Bun** — `bun.lock` / `bun.lockb` detected **first** (Bun writes a `yarn.lock` for compatibility,
so yarn would otherwise win and run the wrong installer). While doing it, `warlock add`'s duplicate
detection was deleted in favour of the shared one — it had a latent bug returning an `undefined`
install command when no lockfile matched.

**Update-check cache** — `.warlock/update-check.json`, 24h TTL. Failed lookups are never cached;
future-stamped entries are ignored; the entry is cleared once `u` applies an update.

**`execPath`** — `warlock start` no longer spawns a bare `node`.

### Verification

- **Real two-process probe** (unmocked, actual spawns): three worker runs, all reporting the
  **same parent pid**, exit code 42 propagated through the supervisor. Under the old design each
  run's parent would have been the previous run's pid. This is the direct proof that the tree no
  longer deepens.
- A supervisor unit test caught a real bug: the exit handler treated `process.exit` as control
  flow, so a stubbed exit fell through into a respawn. Added explicit `return`s.
- Suites: 259 dev-server + updater tests green; full core 1369/1370 (the 1 failure and 1
  unimportable file are the same pre-existing two).
- `tsc --noEmit` clean for every touched file (the one `warlock-config/types.ts` error is the
  pre-existing unbuilt-`cascade` import, confirmed by stashing).
- EOL: two files (`start-production.command.ts`, `start-development-server.ts`) flipped LF→CRLF
  and were renormalised — diffs went from 160/194 lines to 6/6.
- Docs verified live: `/changelog/`, `/v/latest/core/cli/cli-commands/` (h4s render in order, the
  supervisor tree diagram scrolls inside its own box, page has no horizontal scroll, no console
  errors), `/v/latest/core/architecture-concepts/warlock-config/`.

## Round 5 — second wave of 4.9.0 (Hasan: "go with your rec")

**Bug 1 — `build.outDirectory` was a docs-lie.** The code only ever read `build.outdir`
(`default-configurations.ts`, `types.ts`, `production-builder.ts`) while the skills and the live
docs site told users to write `outDirectory` — in copy-pasteable config examples. A config written
from the documentation was **silently ignored** and the bundle still went to `dist/`.
`define-config.test.ts` had been failing on exactly this the whole time.
Fix: `outDirectory` accepted as an alias (`outdir` wins if both), folded by a shared
`normalize-build-config.ts` used by BOTH `defineConfig` and `resolveBuildConfig` — the latter
matters because a project can `export default { … }` without ever calling `defineConfig`.
All 13 doc/skill mentions renamed to `outdir`, with the alias documented.

⚠ Subtlety that cost a test run: normalisation must happen **before** the merge with defaults.
After the merge the defaults have already supplied an `outdir`, so "outdir wins if both are set"
could never distinguish the user's value from the default and the alias was dropped.

**Bug 2 — `own-resolver.equivalence.test.ts` never ran.** Top-level import of `createPathsMatcher`,
removed in get-tsconfig v5. Production already migrated (`resolve-hook.ts:32`), so this was a stale
test — but it took the 5 `probeFile` tests down with it and left the resolver-equivalence invariant
unverified while looking covered. Rewritten against `resolvePathAlias`, mirroring the hook.

**Crash recovery** — supervisor now replaces a worker that dies **after ≥5s of uptime** (OOM,
native crash, dead loader thread). A worker that dies sooner failed to *boot* and has already
printed why, so it is NOT restarted — restarting would reprint the same error and bury it. That
minimum-healthy-uptime rule is what separates the two cases without a noisy retry loop. Flapping
capped at 3 crashes / 60s. An explicit restart (`r`/`u`/config change) uses the restart exit code,
so the uptime rule never swallows it. `superviseDevServer(now = Date.now)` takes an injectable
clock purely so these paths are testable without wall-clock waits.

**`warlock update --dry-run` / `--check`** — new `outdated` outcome; `--check` exits 1 when behind
(CI gate), `--dry-run` always exits 0. Both imply a dry run and never write.

### Final verification

**Full core suite: 130/130 files, 1395 passed, 2 skipped, 0 failed.** First fully green run of the
session — both long-standing failures (`define-config`, `own-resolver.equivalence`) are fixed.
Test count rose 1370 → 1397: the new tests plus the 5 `probeFile` tests that had been dead behind
the broken import. The 2 skips are the golden-replay tests, which correctly skip without their
gitignored fixture.

⚠ An earlier full run the same evening reported "5 failed files / 4 failed tests / 15 skipped". A
clean re-run reported 0. Treat full-suite counts taken while the machine is saturated as
unreliable — the same over-counting showed up earlier in the session (one run said 6 failed files
when the real number was 2). Always re-run before believing a failure count.

`tsc --noEmit`: only the pre-existing unbuilt-`@warlock.js/cascade` import in `warlock-config/types.ts`.

### Environment note

The machine was running ~40 unrelated node processes (Hasan's own dev servers across mentoor /
Bureau / teamsup). Test and tsc runs that previously took 15-90s were taking 5-10+ minutes and had
to be backgrounded. Nothing of mine was left running; nothing was killed.

## Next step

Hasan reviews. Nothing committed, bumped, or published.
