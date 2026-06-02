# 2026-05-27 — `warlock add` expansion: missing warlock-package features

**Status:** In Progress (AI providers + socket landed 2026-05-28; remaining warlock-package features pending)
**Started:** 2026-05-27
**Context:** Docs site blueprint ([`domains/shared/design/warlock-docs-site-blueprint.md`](../../shared/design/warlock-docs-site-blueprint.md) §13) locks `warlock add <feature>` as the canonical single-command install for Warlock users (the "Warlock.js" tab on every standalone package's install page). Today's command misses most warlock packages. This plan inventories the gaps + designs the additions. Related: [`2026-05-23-connectors-in-warlock-config.md`](./2026-05-23-connectors-in-warlock-config.md) (sibling work on connector wiring — flag for overlap, §Open questions).

---

## Today's coverage

`@warlock.js/core/src/cli/commands/add.command.ts` + `add-command.action.ts` ship 15 features:

| Type | Features |
| --- | --- |
| Composite | `react-email` (requires `mail` + `react`) |
| Library helpers | `react`, `image` (sharp), `mail` (nodemailer), `ses`, `test` (vitest setup) |
| Warlock packages | `scheduler`, `herald`, `swagger`, `postman` |
| Drivers | `mongodb`, `postgres`, `mysql`, `redis`, `s3` |

**Feature shape:** `{ description, dependencies?, devDependencies?, requires?, script?, onExecuting?, ejectConfig? }`.

- `requires` — cascading installs (e.g., `react-email` pulls in `mail` + `react`).
- `ejectConfig` — writes `src/config/<name>.ts` from a stub if the file is missing.
- `onExecuting` — arbitrary post-install hook (used by `test` to scaffold vite config + setup files).
- PM auto-detected via lockfile sniff (yarn / npm / pnpm).

## Connector model — key insight

Reading `@warlock.js/core/src/connectors/connectors-manager.ts`: all 9 built-in connectors register in the `ConnectorsManager` constructor. The connector itself imports its target package. If the package isn't installed, the connector's import fails at load time.

**Implication for `warlock add`:** the command doesn't need to "register" anything. It only needs to (a) install the package npm dep, (b) scaffold the package's `src/config/<pkg>.ts` so the connector finds its config at boot. The existing `ejectConfig` mechanism already does (b).

## Gaps — missing warlock packages

Per the docs blueprint's 14 standalone + 1 coupled set, these are MISSING from `featuresMap`:

| Feature | Package | Has config file? | Connector | Notes |
| --- | --- | --- | --- | --- |
| `cache` | `@warlock.js/cache` | Yes (`src/config/cache.ts`) | `cache-connector` | Stub needs writing |
| `cascade` | `@warlock.js/cascade` | Yes (`src/config/database.ts`) | `database-connector` | Stub needs writing |
| `auth` | `@warlock.js/auth` | Yes (`src/config/auth.ts`) | (built into core) | Coupled — installed by default in fresh projects? See Q3 |
| `seal` | `@warlock.js/seal` | No | (none — pure library) | Just install, no config |
| `logger` | `@warlock.js/logger` | Yes (`src/config/logger.ts`) | `logger-connector` | Stub needs writing |
| `context` | `@warlock.js/context` | No | (none) | Pure library |
| `fs` | `@warlock.js/fs` | No | (none) | Pure library |
| `ai` | `@warlock.js/ai` | Yes (`src/config/ai.ts`) | (none today — see Q5) | Stub needs writing |
| `ai-openai` | `@warlock.js/ai-openai` | No | (registered via `ai.ts`) | Just install + maybe patch `ai.ts` |
| `ai-anthropic` | `@warlock.js/ai-anthropic` | No | (registered via `ai.ts`) | Same |
| `ai-bedrock` | `@warlock.js/ai-bedrock` | No | (registered via `ai.ts`) | Same |
| `ai-google` | `@warlock.js/ai-google` | No | (registered via `ai.ts`) | Same |
| `ai-ollama` | `@warlock.js/ai-ollama` | No | (registered via `ai.ts`) | Same |

## Gaps — driver entries missing `requires`

~~Today the driver entries don't pull in their warlock packages.~~ **REJECTED 2026-05-28.** `@warlock.js/cache` and `@warlock.js/cascade` are **core dependencies** — the framework won't run without them, so they're always present. Drivers (`redis`, `mongodb`, `postgres`, `mysql`) only need to install their raw npm driver; no `requires: ["cache"]` / `["cascade"]` is needed. No change to the driver entries.

## Proposal

1. **Add 13 new entries to `featuresMap`** (one per missing warlock package). Library-only packages (`seal`, `context`, `fs`) get bare entries: just `dependencies`. Connector-backed packages get `dependencies` + `ejectConfig` referencing a stub.
2. **Write config stubs** in `@warlock.js/core/src/generations/stubs/` — one per package that needs a config file. Each stub: sensible default driver wired, terse comments pointing at the docs page.
3. **Patch existing driver entries** with `requires: ["cache"]` / `requires: ["cascade"]` so multi-package installs cascade correctly.
4. **Decide AI provider registration** — providers don't have config files of their own; they're referenced inside `src/config/ai.ts`. Options in §Open questions.
5. **Update `--list` output** so devs running `warlock add --list` see the new features clearly grouped.
6. **Lockstep updates** per AGENTS.md:
   - `@warlock.js/core/skills/install-packages/SKILL.md` (or similar) — new skill covering the full `warlock add` surface (or extend an existing one if it covers the CLI).
   - `domains/core/docs/` — install + CLI reference pages updated.
   - `domains/core/docs/llms.txt` + `llms-full.txt` regenerated.

## Open questions

1. **Overlap with `2026-05-23-connectors-in-warlock-config.md`?** That sibling plan may already cover connector config wiring. Recommendation: read it before implementing; if it introduces a different config mechanism, this plan's `ejectConfig` proposal needs to align.
2. **Default cache driver when running `warlock add cache` alone?** Options: (a) memory driver (in-package, no npm dep), (b) error and require an explicit driver. Recommendation: **(a)** — memory works out of the box, devs swap to redis/pg later via `warlock add cache redis`.
3. **Should `auth` get a `warlock add auth` entry?** ~~Recommendation: (a) opt-in.~~ **RESOLVED 2026-05-28 → (b): auth is a scaffold default, NOT an `add` feature.** The `create-warlock` template already ships the full `auth/` module, the `User` model, and `guarded.request` — the rest of the app (every generated controller) extends those. Bolting auth on after the fact via `warlock add auth` would leave the scaffold half-wired. No `auth` entry in `featuresMap`; stale `warlock add auth` doc examples removed.
4. **`swagger` + `postman` — keep, drop, or refactor?** Today they're in `featuresMap` but not in the docs blueprint's 14-package set. They look like older warlock packages. Recommendation: **keep as-is for v1**, file a separate question for Hasan on whether they get docs.
5. **AI provider registration in `src/config/ai.ts`** — ~~patch `ai.ts` on install?~~ **RESOLVED 2026-05-28 → (b) install-only, and NO `ai` config eject at all.** The `src/config/ai.ts` referenced in the gaps table is the *legacy* `app/ai` provider system (`import ... from "app/ai/types/ai-config.type"`). The current `@warlock.js/ai` package has no config-file hook — its `config.ts` is a deliberately tiny programmatic API (`ai.config({ defaultStore })`; Phase 3.2 removed the config bag), and providers are constructed in code (`new OpenAISDK({ apiKey })`, per the `setup-*` skills). Ejecting a `config/ai.ts` would write a dead file the framework never reads. Feature names are flat (`openai`, `google`, `anthropic`, `bedrock`, `ollama`), each `requires: ["ai"]`, so `warlock add openai` is the canonical form.
6. **Should `seal` / `context` / `fs` get `warlock add` entries at all?** They're pure libraries with no Warlock-specific wiring. The `warlock add` value-add over `yarn add` is the connector + config scaffold, which these don't have. Recommendation: **yes, include them** for discoverability. **PARTIAL 2026-05-28 → `fs` added to the `create-warlock` template dependencies directly** (it's needed in almost every project, so it ships in the scaffold rather than waiting for an opt-in `add fs`). `seal` is already a template dep. Whether `context` (and a redundant `add fs`/`add seal`) get `featuresMap` entries for `--list` discoverability remains open.
7. **Connector skill / docs** — `@warlock.js/core` doesn't currently have a skill for the connector model. Should we add one? Recommendation: **yes**, as part of this work — when devs run `warlock add` and the connector boots, they should be able to find a skill explaining what happened. File at `@warlock.js/core/skills/use-connectors/SKILL.md` (name TBD).

## Tasks

- [ ] Read `2026-05-23-connectors-in-warlock-config.md` to confirm no conflict with this plan
- [ ] Resolve §Open questions with Hasan
- [ ] Write config stubs for cache / cascade / logger / ai / auth in `@warlock.js/core/src/generations/stubs/`
- [ ] Add 13 new entries to `featuresMap` (cache, cascade, auth, seal, logger, context, fs, ai, 5 providers)
- [ ] Patch driver entries (`redis`, `mongodb`, `postgres`, `mysql`) with `requires: ["cache"]` / `requires: ["cascade"]`
- [ ] Update `--list` formatting to group features by type (warlock packages / drivers / library helpers)
- [ ] Tests covering each new entry (install command runs, deps resolve, ejectConfig writes, no double-install)
- [ ] Lockstep: skills + docs + llms.txt for `@warlock.js/core`
- [ ] Sync with `domains/core/docs/` install/CLI reference pages
- [ ] Verify each `warlock add <feature>` boots successfully in a fresh `create-warlock` scaffold

## Landed 2026-05-28 (subset)

- **`featuresMap` (`add-command.action.ts`):** added `socket` (installs `socket.io`, ejects `src/config/socket.ts`) and the AI set — `ai` + `openai` / `google` / `anthropic` / `bedrock` / `ollama` (each `requires: ["ai"]`, install-only).
- **`socketConfigStub`** added to `generations/stubs.ts`; no `ai` stub (see Q5).
- **`@warlock.js/fs`** added to the `create-warlock` template `dependencies` (scaffold default, not an `add` feature).
- **Docs:** `cli/cli-commands.md` + `cli/generators.md` `add` examples refreshed (AI + socket added; stale `add auth` / `add storage` examples removed — auth is scaffold default per Q3, `storage` was never a feature; the real one is `s3`).
- **Decisions:** Q3 (auth = scaffold default, no `add auth`), Q5 (AI install-only, no `ai` config), Q6 (`fs` via template) resolved above. Driver `requires` **rejected** (cache/cascade are core deps — see Gaps section). Per-feature `env` scaffolding **rejected** (ejected config files already document env vars via `env(...)`; `.env` + `src/config/` is the canonical home).
- **Hardening:** `package.json.scripts` null-guard in `addCommandAction` (was `Object.assign(packageJson.scripts, …)` → spread with `?? {}`); `dependencies`/`devDependencies` guards already landed in a prior refactor.

**Agreed next (separate focused passes):**
- ~~`warlock generate.* --dry-run`~~ **DONE 2026-05-28** — added a shared dry-run writer (`generate/utils/writer.ts`) that owns per-file logging and skips writes in preview mode; every `generate.*` command + the master `generate` gained `--dry-run`. (`add --dry-run` was not done — `add` already has its own `--no-install`; a preview mode there is a separate small follow-up if wanted.)
- `warlock remove <feature>` — reverse of `add` (uninstall deps, drop ejected config + scripts), reusing `featuresMap`. **← next up.**

**Still pending (original plan scope):** `cache` / `cascade` / `logger` / `seal` / `context` `--list` discoverability entries; grouped `--list` output + interactive no-arg picker; a connector skill; tests; llms.txt regen (deferred — entangled with the in-progress docs restructure).

**Out of this plan but fixed alongside:** latent bug in `socket-connector.ts` — `this.server` was declared-but-never-assigned, so `start()` always early-returned and `shutdown()` never cleaned up. Fixed by keying lifecycle off `this.socket` and removing the dead field.

## Summary

(Updated on completion.)
