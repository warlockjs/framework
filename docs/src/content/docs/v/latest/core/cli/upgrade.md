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
warlock upgrade --to 5.31 --dry-run   # show the diff and the review list; write nothing
warlock upgrade --to 5.31             # apply it
warlock upgrade --to 5.31 --json      # machine-readable result, for scripts and agents
```

Then install (the command prints the right install command for your package
manager), run the type check and the tests, and work through the review list.

## Options

| Flag           | Type    | Description                                                                          |
| -------------- | ------- | ------------------------------------------------------------------------------------ |
| `--to`         | string  | Version to upgrade to: `5.31` or `5.31.0`. Required.                                 |
| `--from`       | string  | Version to upgrade from. Default: the installed `@warlock.js/core` (then its range). |
| `--dry-run`    | boolean | Print the unified diff and the review list without writing any file.                 |
| `--json`, `-j` | boolean | Print the result as JSON (see below).                                                |

A codemod runs when the upgrade crosses its release (`from < release <= to`),
so `--from 5.30 --to 5.31` skips the 5.30 changes. The command reads
`src/**/*.{ts,tsx}`, `package.json`, `.nvmrc` and `.node-version`; it does not
boot the app. Exit code `0` means it ran (review items included), `1` means
bad arguments or a missing `ts-morph`.

## ts-morph

The codemods edit TypeScript with [ts-morph](https://ts-morph.com), an optional
peer of `@warlock.js/core` loaded only by this command. Without it the command
stops before touching anything and prints the install command, e.g.
`pnpm add --save-dev ts-morph`.

## What it does for 5.30 and 5.31

| Codemod                | Release | Edits                                                                                                                                        | Lists for review                                                       |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `logger-sync-calls`    | 5.30    | Removes `await` before `log.info/warn/error/debug/success/fatal/log/assert`.                                                                 | `.then()` chained on a log call.                                       |
| `request-log-snapshot` | 5.30    | In custom log channels: `context.request.baseRequest.url/method/ip` → `.url/.method/.ip`, `.route.path` → `.route`, `.route.name` → `.name`. | Any other read that is not on the snapshot (methods, headers, …).      |
| `head-viewport`        | 5.30    | Removes a hand-written default viewport `<meta>` next to `<Head />`.                                                                         | A non-default viewport tag (move it to `metadata.viewport`).           |
| `seal-validate-result` | 5.30    | —                                                                                                                                            | `validate()` results whose `.data` is read without an `isValid` check. |
| `ai-tool-dispatch`     | 5.30    | —                                                                                                                                            | `ai.agent()`/`spawnSubAgent()` with tools and no `toolDispatch`.       |
| `ai-anthropic-body`    | 5.30    | —                                                                                                                                            | `providerOptions.anthropic.body` setting a reserved key.               |
| `ai-finish-reason`     | 5.30    | —                                                                                                                                            | `switch` statements over a `finishReason`.                             |
| `node-22-15`           | 5.31    | Raises `engines.node`, `.nvmrc` and `.node-version` below 22.15.                                                                             | A Node alias it cannot read.                                           |
| `rate-limit-defaults`  | 5.31    | —                                                                                                                                            | `src/config/http.ts` without a `rateLimit` (the default now applies).  |
| `seal-refine-output`   | 5.31    | —                                                                                                                                            | Every `.refine()` (now runs on validated output).                      |
| `seal-container-catch` | 5.31    | —                                                                                                                                            | `.catch()` on `v.object/array/record/tuple` (now a no-op).             |
| `seal-union-output`    | 5.31    | —                                                                                                                                            | Every `v.union()` (now returns the branch's output).                   |
| `ai-compaction-opt-in` | 5.31    | —                                                                                                                                            | Agent `compaction` without `afterTokens` and `summarize`.              |
| `warlock-versions`     | every   | Sets each `@warlock.js/*` dependency to the target, keeping `^`/`~`/exact.                                                                   | —                                                                      |

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
