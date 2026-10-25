---
title: "warlock upgrade"
description: Codemods for Warlock upgrades — warlock upgrade --to <version> applies the mechanical edits each breaking change needs, lists every place that needs a decision with file and line, and shows a diff with --dry-run or JSON with --json.
sidebar:
  order: 8
  label: "warlock upgrade"
---

`warlock upgrade --to <version>` applies the code changes an upgrade needs. For
every breaking change between the release your app is on and the target, it
either edits the code (when the change is mechanical) or lists the place that
needs a decision, with `file:line` and the reason. It also moves every
`@warlock.js/*` dependency in `package.json` to the target version.

```bash
warlock upgrade --from 5.30 --to 5.31.0 --dry-run   # show the diff and the review list; write nothing
warlock upgrade --from 5.30 --to 5.31.0             # apply it
warlock upgrade --from 5.30 --to 5.31.0 --json      # machine-readable result, for scripts and agents
```

Pass `--from` with the release the app is upgrading from. Without it the
command reads the installed `@warlock.js/core` as the starting version, and
once the new release is installed (which it is, since the command ships with
it) that version is the target itself, so there is nothing to upgrade across
and the command stops with an error asking for `--from`. An app on 5.29 passes
`--from 5.29` so the 5.30 changes run too.

Then install (the command prints the right install command for your package
manager), run the type check and the tests, and work through the review list.

## Options

| Flag           | Type    | Description                                                                                                                                                     |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--to`         | string  | Version to upgrade to: `5.31` or `5.31.0`. Required.                                                                                                            |
| `--from`       | string  | Version to upgrade from. Default: the installed `@warlock.js/core` (then its range), which is already the target once the new release is installed, so pass it. |
| `--dry-run`    | boolean | Print the unified diff and the review list without writing any file.                                                                                            |
| `--check`      | boolean | Rehearse the whole upgrade on a scratch copy and report what breaks; the project is never written. See [Rehearse it with `--check`](#rehearse-it-with---check).    |
| `--skip-install` | boolean | With `--check`: apply the upgrade to the copy, install nothing and run no project command.                                                                     |
| `--keep`       | boolean | With `--check`: keep the scratch copy on disk and print where it is.                                                                                            |
| `--timeout-minutes` | number | With `--check`: time limit for each command (default 20).                                                                                                  |
| `--memory-mb`  | number  | With `--check`: heap cap for each Node process it starts (default 4096).                                                                                        |
| `--json`, `-j` | boolean | Print the result as JSON (see below).                                                                                                                           |

A codemod runs when the upgrade crosses its release (`from < release <= to`),
so `--from 5.30 --to 5.31.0` skips the 5.30 changes. The command reads
`src/**/*.{ts,tsx}`, `package.json`, `.nvmrc` and `.node-version`; it does not
boot the app. Exit code `0` means it ran (review items included), `1` means
bad arguments or a missing `ts-morph`.

## Rehearse it with `--check`

`--dry-run` shows what the codemods would edit. It cannot tell you whether the app still installs, typechecks and boots on the new release. `--check` answers that without touching the project:

```bash
warlock upgrade --check --from 5.37 --to 5.38.0
```

1. Copies the project to a scratch directory under the OS temp directory, leaving out `node_modules`, `.git` and `storage`.
2. Applies the upgrade there: `package.json` versions and every codemod, exactly as `warlock upgrade` would.
3. Installs there with the package manager detected on the real project, and prints which one it chose and why. With npm it first removes the framework family's lock entries, as [`warlock update`](./cli-commands.md#update) does.
4. Runs, in the copy and one after the other: `warlock generate.typings`, `warlock typecheck`, `warlock doctor` (which renders the root page of every site) and the app's `unit` Vitest project.
5. Reports the breaking changes that hit the app (each codemod that rewrote or flagged code, with the files) and the outcome and duration of every step, with the tail of the output of a failed one. Exit code `1` when a step failed.

The real project is never written: every command runs with the copy as its working directory, and the command refuses to run if the scratch directory would be inside the project. The copy is deleted afterwards unless you pass `--keep`.

### Resource use on a shared server

The check installs dependencies and runs a typecheck and a test project, so it is as heavy as those commands are. It runs one child process at a time, at low priority (`nice` 10), caps each Node process's heap with `--max-old-space-size` (`--memory-mb`, default 4096) and kills a command, including its child processes, after `--timeout-minutes` (default 20). The copy needs disk space for the source tree plus a full `node_modules`; point `TMPDIR` at a volume with room. On a machine other people share, run it under whatever memory and CPU limit you use for builds.

- `--skip-install` applies the upgrade to the copy and stops: you get the breaking changes that hit the app and the diff-level result, with the install, typings, typecheck, doctor and test steps reported as skipped. Use it when you only need to know what the codemods touch.
- `--keep` leaves the copy (with its `node_modules`) so you can open it, rerun a step or compare files. Delete it when you are done.
- The copy includes `.env`, so the app boots with its real configuration. `warlock doctor` does not open connections, but the unit project runs your code: give it a test environment.

## ts-morph

The codemods edit TypeScript with [ts-morph](https://ts-morph.com), an optional
peer of `@warlock.js/core` loaded only by this command. Without it the command
stops before touching anything and prints the install command, e.g.
`pnpm add --save-dev ts-morph`.

## What it does for 5.30 and 5.31

| Codemod                         | Release | Edits                                                                                                                                                                                           | Lists for review                                                                                                                        |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `logger-sync-calls`             | 5.30    | Removes `await` before `log.info/warn/error/debug/success/fatal/log/assert`.                                                                                                                    | `.then()` chained on a log call.                                                                                                        |
| `request-log-snapshot`          | 5.30    | In custom log channels: `context.request.baseRequest.url/method/ip` → `.url/.method/.ip`, `.route.path` → `.route`, `.route.name` → `.name`.                                                    | Any other read that is not on the snapshot (methods, headers, …).                                                                       |
| `head-viewport`                 | 5.30    | Removes a hand-written default viewport `<meta>` next to `<Head />`.                                                                                                                            | A non-default viewport tag (move it to `metadata.viewport`).                                                                            |
| `seal-validate-result`          | 5.30    | —                                                                                                                                                                                               | `validate()` results whose `.data` is read without an `isValid` check.                                                                  |
| `ai-tool-dispatch`              | 5.30    | —                                                                                                                                                                                               | `ai.agent()`/`spawnSubAgent()` with tools and no `toolDispatch`.                                                                        |
| `ai-anthropic-body`             | 5.30    | —                                                                                                                                                                                               | `providerOptions.anthropic.body` setting a reserved key.                                                                                |
| `ai-finish-reason`              | 5.30    | —                                                                                                                                                                                               | `switch` statements over a `finishReason`.                                                                                              |
| `node-22-15`                    | 5.31    | Raises `engines.node`, `.nvmrc` and `.node-version` below 22.15.                                                                                                                                | A Node alias it cannot read.                                                                                                            |
| `rate-limit-defaults`           | 5.31    | —                                                                                                                                                                                               | `src/config/http.ts` without a `rateLimit` (the default now applies).                                                                   |
| `seal-refine-output`            | 5.31    | —                                                                                                                                                                                               | Every `.refine()` (now runs on validated output).                                                                                       |
| `seal-container-catch`          | 5.31    | —                                                                                                                                                                                               | `.catch()` on `v.object/array/record/tuple` (now a no-op).                                                                              |
| `seal-union-output`             | 5.31    | —                                                                                                                                                                                               | Every `v.union()` (now returns the branch's output).                                                                                    |
| `ai-compaction-opt-in`          | 5.31    | —                                                                                                                                                                                               | Agent `compaction` without `afterTokens` and `summarize`.                                                                               |
| `vite-8-vitest-5`               | 5.36    | Raises `vite`, `vitest`, `@vitest/*` and `@vitejs/plugin-react` in `package.json` (including `overrides`/`resolutions`); rewrites a `vitest/runners` test runner to `TestRunner` from `vitest`. | Removed `vitest/*` entry points, a Vite config `esbuild` option, object `manualChunks`.                                                 |
| `vitest-inline-project-plugins` | 5.37.1  | —                                                                                                                                                                                               | A `lowerStage3Decorators()` call repeated inside a Vitest config that declares `projects` (Vitest 5 projects inherit the root plugins). |
| `test-runtime-worker-lifetime`  | 5.38    | —                                                                                                                                                                                               | `src/config/tests.ts` without a `lifetime` (new apps boot once per worker; yours keeps booting per file) and a Vitest `unit` project without `guardUnitProject()`. |
| `warlock-versions`              | every   | Sets each `@warlock.js/*` dependency to the target, keeping `^`/`~`/exact.                                                                                                                      | —                                                                                                                                       |

Changes with nothing to edit (hashed auth throttle keys, the new image cache
layout) are printed under "Plan for". Each `**BREAKING**` entry in the package
changelogs names its codemod. The `upgrade-from-5-29` skill explains every
change in detail.

## Output

```text
warlock upgrade 5.29.0 → 5.31.0 (dry run: nothing written)

✓ logger-sync-calls (5.30.0) Remove `await` from synchronous log calls — 2 would change
    src/app/orders/services/place-order.service.ts:5  removed await before logger.info()
    src/app/orders/services/place-order.service.ts:7  removed await before logger.success()
! seal-refine-output (5.31.0) Review `.refine()` callbacks — 1 to review
    src/app/users/schema/user.schema.ts:4  `.refine()` now runs on the validated output, …
```

`--json` prints `{ from, to, dryRun, codemods, applied, manual, notes,
changedFiles, diff, installHint? }`. `applied` and `manual` entries carry
`codemod`, `file` and `line`; `manual` entries add the `hint` and the `skill`
to read.

## 5.35 to 5.36: Vite 8 and Vitest 5

`@warlock.js/web` now requires Vite 8 (`^8.0.0`) and `@vitejs/plugin-react` 6, and
the test kit targets Vitest 5. Move the family together:

```bash
npm install --save-dev ts-morph
npx warlock upgrade --from 5.35 --to 5.36.0 --dry-run
npx warlock upgrade --from 5.35 --to 5.36.0
npm install
npx warlock check
```

The `vite-8-vitest-5` step only touches what Vite 8 and Vitest 5 no longer
accept: the dependency ranges, a generated `src/test-runner.ts` that imports
`VitestTestRunner` from `vitest/runners`, and a `vitest/runners` import with other
names. It lists removed `vitest/*` entry points, a Vite config `esbuild` option and
object `manualChunks` for review. See the Upgrading note in the `@warlock.js/web`
changelog.

## 5.33 to 5.34: toolchain removal

ESLint and Prettier support was removed in **5.34.0**. Oxlint/Oxfmt is the only
supported toolchain. `--lint eslint` and `healthCheckers.eslint` are removed.
Install the new core release and `ts-morph`, then migrate an existing app:

```bash
npm install --save-dev ts-morph
npx warlock upgrade --from 5.33 --to 5.34.0 --dry-run
npx warlock upgrade --from 5.33 --to 5.34.0
npm install
npm run format
npm run lint:check
npx warlock check
```

The `oxc-toolchain-removal` step reapplies the preserved 5.33 `oxc-toolchain`
migration when legacy configs, scripts or dependencies remain. Apps upgrading
from 5.32 can still use `npx warlock upgrade --from 5.32 --to 5.33.0` first.
It replaces standard scripts/dependencies, pins TypeScript 7.0.2, updates generated
editor settings, removes `healthCheckers.eslint` and selects Oxlint. A generated
`.prettierignore` becomes `.oxfmtignore`; Oxfmt scripts read it explicitly.

Literal custom rules are translated without executing the config. Per-folder
`no-restricted-imports` and `no-restricted-exports` become Oxlint overrides with
file/exclusion patterns. Supported `@typescript-eslint/*` rules become native
`typescript/*` rules (or native base rules). Options are checked against the
pinned Oxlint 1.88.0 schema. Type-aware equivalents enable `options.typeAware`
and add `oxlint-tsgolint@7.0.2004` to the app's dev dependencies.
`unused-imports/no-unused-imports` uses `no-unused-vars` with safe import fixes;
Oxlint shares the severity for imports and variables, so differing active
severities are reported for review.

Only unsupported rules/options, computed or imported settings, selectors such
as `no-restricted-syntax`, and conflicting existing Oxc rules need manual review.
Each finding names its source `file:line`, rule and affected file patterns.
Fully ported lint configs are removed; configs with findings remain for reference
until those findings are addressed. Existing Oxc rules are kept on conflict.
`--dry-run --json` reports the same plan without writes. Customized formatting,
editor settings and nonstandard scripts can also require review.

**Upgrading:** new and migrated template configs enable
`"categories": { "correctness": "error" }`. Address the additional diagnostics;
existing Oxc configs retain their categories. A real lockfile beside a workspace
marker determines the installer: `package-lock.json` plus `pnpm-workspace.yaml`
without `pnpm-lock.yaml` now produces `npm install`.
