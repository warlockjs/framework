---
name: warlock-workspace-facts
description: Hard-won operational facts about the Warlock.js framework monorepo (github.com/warlockjs/framework) that cost real time to rediscover: the layout (packages/, docs/, tools/release/), that CWD — not a config path or a flag — decides what vitest finds, how to run one package's tests and typecheck, where the old per-package repositories and the stale D: copy went, mirror source copies under tools/release/sources, and the evidence standard for reporting a fix.
---

# Working in the Warlock.js framework monorepo

**One repository: `github.com/warlockjs/framework`.** Read before your first edit or test run.

## Layout

| Path                 | What it is                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/<name>`    | One published package each: `@warlock.js/<name>`, plus `create-warlock`.                                                                         |
| `docs/`              | The documentation site (Astro + Starlight), deployed to warlock.js.org.                                                                          |
| `tools/release/`     | The release runner (`@mongez/pkgist` + gate scripts). npm-managed with its own `package-lock.json`, deliberately **outside** the pnpm workspace. |
| `scripts/`           | Workspace-wide checks: `check-spec-coverage.mjs`, `ci/affected-packages.mjs`.                                                                    |
| `.github/workflows/` | CI, docs, create-warlock and release pipelines.                                                                                                  |

- Install once at the root: `pnpm install` (pnpm 11.24.0, Node ≥ 22.15). `linkWorkspacePackages: true` links every `@warlock.js/*` dependency to the package in this repository, never to npm.
- `packages/create-warlock` carries its **own** `pnpm-workspace.yaml` and lockfile: pnpm run from inside it treats it as a standalone project, which is how its own CI proves the scaffolder works without the monorepo.
- The full history of every package was imported from its original repository (rewritten into `packages/<name>/`), so `git log -- packages/core` and `git blame` reach back past the move. The original repositories (`warlockjs/core`, `warlockjs/web`, …, `warlockjs/release`, `warlockjs/documentation`) are **archived**: read-only, kept for their tags.

## ⚠ Stale copies that look identical

- `D:/xampp/htdocs/mongez/node/@warlock.js/` is the pre-2026-08-26 location.
- `C:/Work/Warlock.js/<package>/` are the per-package clones from before the monorepo.

Editing either produces a change that saves cleanly, passes its tests, and ships nothing. **Work in the monorepo.** If an older card, skill or comment names one of those paths, translate it to `packages/<name>` and say you did.

## CWD IS LOAD-BEARING for vitest

A vitest project's `include` globs resolve relative to the **current working directory**, not the config file's directory. Running from the repo root with `--config packages/web/vitest.config.ts` prints **"No test files found"** and exits **successfully** — a green-looking run that executed nothing.

**Run a package's tools from inside the package:**

```sh
cd packages/web && ./node_modules/.bin/vitest run --config vitest.config.ts --project web
# or, from anywhere:
pnpm --filter @warlock.js/web test
```

`npx vitest` / `pnpm exec` are not used here — invoke the package's own `./node_modules/.bin/<tool>`. **A run that reports no test files is a FAILED run.** Read the file/test counts in the tail before believing a green, and say which vitest project you ran (`web/vitest.config.ts` defines `web`, `web-tests` and `web-vite`).

The same two scripts CI and the release gate run for each package are `typecheck` and `test`; `pnpm --filter <name> typecheck` reproduces CI for one package. `queue` and `notifications` need Redis on port 6390.

## Prettier: say the scope

From the root, `pnpm format:check` runs `prettier --ignore-path .prettierignore --check .`. Always report a formatting result **with its scope and its cwd** — "clean on the 5 files I touched, from `packages/core`" is evidence; a bare "clean" is not.

**If a gate's binary cannot be found, the gate is `BLOCKED`** — never `passed` with a caveat.

## Mirror source copies under `tools/release/sources/`

When present, `tools/release/sources/@warlock.js/**` holds copies of package sources at **identical line numbers** to the originals. They are build artifacts. **Do not "fix" a bug there** — fix `packages/<name>/src`. Expect duplicate grep hits and report them as mirrors.

## Evidence standard

- **Every claim carries a `file:line`, or say "not found".**
- **Write the failing test FIRST**, run it, and paste the failing output.
- **A negative result is a valid result** — but a negative result from the wrong directory is not a result at all.
- **Pre-existing test failures must be PROVEN pre-existing**: revert your change, re-run, show they still fail.
- **Prose about code drifts from code.** Read the artifact and cite it.
- **Reject a bad value; never quietly repair it.**
- Watch for **silent** failure modes specifically: synchronous `events.trigger` swallowing async rejections, `process.exit(0)` erasing them, esbuild silently dropping CSS imports, a test run that finds zero files and still exits 0.

## Repo conventions

- **No `.js` extensions in import paths.**
- **Use `type`, never `kind`** — discriminators, props, fields, variables.
- **No reference that only resolves inside Bureau** in shipped source, comments, test titles or error messages.
- Match the surrounding code's style, error conventions, and test location.

## Known events pitfall

`@mongez/events` `trigger` / `triggerAll` / `emit` are **fully synchronous** — they do not await handlers. `await events.triggerAll(...)` silently drops async listeners and lets rejections escape. Use **`triggerAsync` / `triggerAllAsync`** when an `await` is intended. Handlers run in registration order, and **a handler returning `false` silently cancels every handler after it**.

## Redis and HTTP test services

Queue/notification integration tests probe Redis with PING at
`QUEUE_REDIS_HOST:QUEUE_REDIS_PORT` (default `127.0.0.1:6390`). Local runs skip
unavailable integration cases with a clear message while unit cases still run.
CI and `WARLOCK_REDIS_INTEGRATION=1` require a reachable service. Use a disposable
Redis instance with persistence disabled for local testing; never flush a shared
database. HTTP socket tests bind port `0` to avoid depending on port 3000.

Strictness allowances are measured per source owner; lower them after fixing
indexed reads and retain explicit nonempty bounds or runtime assertions. Never
raise an existing allowance to absorb new errors. Empty generator selections
reject before opening stdin.

Release quality commands force `WARLOCK_REDIS_INTEGRATION=1`, so local release
gates require Redis just like release CI. Mocked configured-port reporting cases
mock the availability preflight too; their port numbers never need to be free.

## Repository formatting

Use the root Oxfmt configuration for repository source, including scaffolder
source. `pnpm format:check` is the CI check; `pnpm format` writes it. Preserve
BOMs and generated-byte oracles. Generated app templates retain their separate
Prettier/Oxc checks. Import sorting stays disabled: Oxfmt does not replace the
TypeScript-aware organize-imports plugin's full behavior.
