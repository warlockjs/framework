---
title: "warlock check & typecheck"
description: The single verify command — incremental typecheck, the app's ESLint/oxlint, the tests affected by a change and framework convention checks — reporting one JSON object per problem with a stable code, and exit codes that separate "your code" (1) from "this machine" (2). Plus `warlock typecheck [--changed]` on its own.
sidebar:
  order: 9
  label: "warlock check"
---

`warlock check` is the one command to run after a change. It typechecks, lints, runs the tests the change affects and checks the framework's conventions, then prints **one list of problems**, each with a stable [error code](./error-codes.md), a position, a one-line fix and the skill that explains it. Its exit code tells whether the problem is **in your code** or **on this machine**, so neither a person nor an agent edits code to fix a stopped Redis server.

```bash
warlock check                 # everything
warlock check --changed       # only what changed against HEAD (plus untracked files)
warlock check --base main     # only what changed since this branch left main
warlock check --json          # the report as JSON
```

```
src/app/posts/controllers/update-post.controller.ts:14:7  WL7101  Type 'string' is not assignable to type 'number'. (TS2322)
  → Fix the type error at the reported position; the TypeScript code (TS1234) is in `rule`.
src/app/posts/services/publish.service.ts:2:24  WL9003  "../../users/models/user" reaches from module "posts" into "users"; import "app/users/models/user" instead.
  → Import across modules through the app/<module>/... alias instead of ../../.

✓ environment  passed — Node 22.15.0
✗ typecheck    failed — 212 file(s) checked in 3120ms
✓ lint         passed — oxlint over 212 file(s)
- tests        skipped — no test files
✗ conventions  failed — 212 file(s) checked

2 error(s) in the code (exit 1)
```

`check` boots nothing: no config is loaded, no connector starts, no connection opens and no port binds.

| Flag            | Type    | Description                                                                                |
| --------------- | ------- | ------------------------------------------------------------------------------------------ |
| `--changed, -c` | boolean | Limit every step to the files changed against `HEAD` plus untracked files.                 |
| `--base, -b`    | string  | Compare with `git merge-base <ref> HEAD` instead of `HEAD`. Implies `--changed`.           |
| `--skip, -s`    | string  | Comma-separated steps to skip: `environment`, `typecheck`, `lint`, `tests`, `conventions`. |
| `--lint`        | string  | `oxlint` (default) or `eslint` (deprecated; removed in 5.34.0).                            |
| `--project, -p` | string  | tsconfig path (default `tsconfig.json`).                                                   |
| `--json, -j`    | boolean | Print the report as JSON. stdout carries only the JSON.                                    |

## Exit codes

| Exit | Meaning                                                 | Examples                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | No error-severity problem. Warnings are allowed.        | A clean run; lint warnings only.                                                                                                                                                                                                                                                                                                                                                            |
| `1`  | Problems **in your code** only.                         | A type error (`WL7101`), a lint error (`WL7201`), a failing test (`WL7301`), a convention problem (`WL9001`–`WL9009`).                                                                                                                                                                                                                                                                      |
| `2`  | A problem with **this machine**: the run is incomplete. | Node too old for `engines.node` (`WL8001`); an oxlint config without the oxlint package, or test files without vitest (`WL8002`); a test failing with `ECONNREFUSED` because the database or Redis is not running (`WL8003`); a test failing with `EADDRINUSE` (`WL8004`); `--changed` outside a git repository (`WL8006`); a tool that crashed, timed out or ran out of memory (`WL8007`). |

`2` wins over `1`: when the machine kept a step from running, the run did not check everything, so it cannot claim the code is the only problem. Fix the environment, then run again. Every problem's `category` field says the same thing per problem: `code` or `environment`.

Any other exit code means the `check` process itself died — treat it like `2`.

`check` only **detects and reports** environment problems. It never stops a process, frees a port or starts a service; the only processes it ends are the child processes it started itself (a vitest or typecheck run that exceeds its time limit).

## Steps

All steps run, even after one fails, so one run lists every problem.

| Step          | What it does                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment` | Checks the running Node.js against core's minimum (22.15) and the app's own `engines.node` when it is a `>=` range. With `--changed`, lists the changed files with git; if git cannot, every later step is `blocked`.         |
| `typecheck`   | Runs [`warlock typecheck`](#warlock-typecheck) in a child process, so a heap overflow on a large app is reported as `WL8007` instead of ending `check`.                                                                       |
| `lint`        | Oxlint when an app-root Oxlint config exists. Lints `src/**` (or changed files). A missing Oxlint package is `WL8002`. ESLint requires explicit `--lint eslint` and a flat config; its presence alone does not enable it.     |
| `tests`       | The app's own vitest (never a global one): `vitest run` for a full check, `vitest related <changed files> --run` with `--changed`, both with `--passWithNoTests` and the JSON reporter. Skipped when there are no test files. |
| `conventions` | Static checks over `src/**` (or the changed files) and `tsconfig.json`, the same whichever linter the app uses — see [Convention checks](#convention-checks).                                                                 |

A step's status is `passed`, `failed`, `skipped` (does not apply, or `--skip`) or `blocked` (this machine kept it from running).

## Convention checks

The `conventions` step parses each file with the TypeScript compiler (no type information, no boot) and reports:

| Code     | Severity | What it finds                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WL9001` | error    | An import of a file the framework loads by itself: `src/app/main.ts`, a module's `routes.ts`, `main.ts`, `worker.ts`, or anything in `events/`. Test files may import them.                                                                                                                                                                                                        |
| `WL9002` | error    | A relative import ending in `.js` / `.jsx`.                                                                                                                                                                                                                                                                                                                                        |
| `WL9003` | error    | A relative import from one `src/app/<module>` into another; the message names the `app/<module>/...` alias to use.                                                                                                                                                                                                                                                                 |
| `WL9004` | error    | `"experimentalDecorators": true` in `tsconfig.json`.                                                                                                                                                                                                                                                                                                                               |
| `WL9005` | error    | `request.all()`, `allExceptParams()`, `heavy()` or `heavyExceptParams()` passed to a call — a model query, a service, `inApp()` — directly, spread into an object, or through a local constant. Responses and loggers are not counted.                                                                                                                                             |
| `WL9006` | error    | A POST/PUT/PATCH/DELETE route with no auth middleware and no `public: true`: `router.post/put/patch/delete()`, `router.add("POST", …)`, `router.restfulResource()` (unless `only` lists read methods) and the mutating route-builder methods (`create`, `update`, `destroy`, `post`, `put`, `patch`, `delete`, `postOne`, `updateOne`, `patchOne`, `deleteOne`).                   |
| `WL9007` | error    | A `redirect()`, `permanentRedirect()` or `navigateTo()` target, or a `<Link>`/`<NavLink>` `to`/`href`, that reads request input (`request.input()`, `request.query.next`, `useQueryString()`, a loader's `query`, `location.search`, …) without `safeRedirect()` / `safeRedirectTarget()` or an enclosing `if (isSafeRedirect(…))`.                                                |
| `WL9008` | error    | A raw email, credential (`*Token`, `*Password`, `*Secret`, `apiKey`, …) or whole request body/headers/cookies passed to `log.*`, `logger.*`, `console.*` or `request.log()`, outside `maskEmail()`, `redact()`, `escapeLogValue()` or `request.toLogSnapshot()`. A credential under a key the logger censors by default (`{ token }`) is fine; emails are not censored by default. |
| `WL9009` | error    | A regex with an unbounded quantifier (`*`, `+`, `{n,}`) run on request input with `test`, `exec`, `match`, `matchAll`, `replace`, `replaceAll`, `search` or `split`.                                                                                                                                                                                                               |
| `WL9010` | warning  | `await log.info(…)` and its siblings: they return the logger, not a promise.                                                                                                                                                                                                                                                                                                       |
| `WL9011` | warning  | A second controller in one file: a constant or function named `*Controller`, or a constant typed `*RequestHandler`.                                                                                                                                                                                                                                                                |
| `WL9012` | warning  | A tagged union whose discriminator is `kind` (a property typed with string/number literals) instead of `type`.                                                                                                                                                                                                                                                                     |

Warnings are reported and never change the exit code.

The checks follow names, not types: the request is the identifier `request` or `req`, the router is `router`, and a middleware is an auth guard when its name contains `auth` or `guard` — the same rule the [dev-server warning](/v/latest/core/the-basics/routing/#public-mutating-routes) applies to registered routes — or when it is a constant initialised with `markAuthGuard()` in the same file. A wrapper such as `guarded(() => …)` guards the routes inside it, and an options value the check cannot see into (a variable, a spread) is trusted.

When a finding is deliberate, say so next to it. A `warlock-check-ignore` comment on the problem's line or the line above skips the codes it names, or every code when it names none:

```ts
// warlock-check-ignore WL9006 -- the signature middleware authenticates this webhook
router.post("/webhooks/billing", billingWebhookController, { middleware: [verifySignature()] });
```

## The JSON report

```json
{
  "schemaVersion": 1,
  "ok": false,
  "exitCode": 1,
  "changed": true,
  "files": ["src/app/posts/controllers/update-post.controller.ts"],
  "steps": [
    {
      "name": "environment",
      "status": "passed",
      "durationMs": 31,
      "detail": "Node 22.15.0, 1 changed file(s)"
    },
    {
      "name": "typecheck",
      "status": "failed",
      "durationMs": 2140,
      "detail": "3 file(s) checked in 980ms"
    }
  ],
  "problems": [
    {
      "code": "WL7101",
      "category": "code",
      "severity": "error",
      "source": "typescript",
      "file": "src/app/posts/controllers/update-post.controller.ts",
      "line": 14,
      "column": 7,
      "message": "Type 'string' is not assignable to type 'number'.",
      "hint": "Fix the type error at the reported position; the TypeScript code (TS1234) is in `rule`.",
      "skill": "warlock-check",
      "docs": "https://warlock.js.org/v/latest/core/cli/error-codes/#wl7101",
      "rule": "TS2322"
    }
  ],
  "summary": { "errors": 1, "warnings": 0, "code": 1, "environment": 0 }
}
```

Every problem has every key; `file`, `line`, `column` and `rule` are `null` when they do not apply. `rule` is the tool's own identifier: `TS2322`, an ESLint rule id, or the failing test's full name. `warlock doctor --json` uses the same `code` / `hint` / `skill` / `docs` fields.

Within `schemaVersion: 1` fields are only added, never removed or retyped; ignore keys you do not know.

## `--changed`

The changed files are `git diff --name-only --relative <ref>` (added, copied, modified, renamed) plus `git ls-files --others --exclude-standard`, limited to JavaScript/TypeScript files that exist. `<ref>` is `HEAD`, or `git merge-base <base> HEAD` with `--base`. Then:

- **typecheck** reports diagnostics for the changed files and the project files that import them directly;
- **lint** and **conventions** read only the changed files;
- **tests** runs `vitest related` on them.

A type change can break a file two imports away. `--changed` is for the inner loop; run a full `warlock check` before you finish — it is incremental, so it is fast after the first run.

## `warlock typecheck`

```bash
warlock typecheck                     # the whole program
warlock typecheck --changed           # changed files and their importers
warlock typecheck --base main --json
warlock typecheck --project tsconfig.app.json
```

It runs the TypeScript compiler API with `incremental` and `noEmit`, keeping its state in `.warlock/cache/typecheck.tsbuildinfo`, so the second run only re-checks what changed. With `--changed` it collects diagnostics only for the changed files and their direct importers; the checker is lazy, so files nobody asks about are parsed but not checked — most of the memory a full check costs.

Problems are `WL7101` (a type error; the TypeScript code is in `rule`) and `WL7102` (a missing or invalid tsconfig). Exit codes match `check`: 0, 1 for type errors, 2 when git is unavailable for `--changed`.

## In an agent loop or CI

```bash
# Inner loop: fast, only what changed.
warlock check --changed --json > check.json
case $? in
  0) echo "clean" ;;
  1) echo "fix the code: $(jq -r '.problems[] | "\(.file):\(.line) \(.code) \(.message)"' check.json)" ;;
  2) echo "fix the machine: $(jq -r '.problems[] | select(.category=="environment") | .message' check.json)" ;;
esac

# Before merging: everything.
warlock check
```

`warlock explain <CODE>` prints any code's meaning and fix; see [Error codes](./error-codes.md).

## Programmatic use

```ts
import { runCheck, runTypecheck, CHECK_EXIT_CODES } from "@warlock.js/core/tooling";

const report = await runCheck({ changed: true, skip: ["tests"] });

if (report.exitCode === CHECK_EXIT_CODES.environment) {
  console.error(
    "environment:",
    report.problems.filter((problem) => problem.category === "environment"),
  );
}

const types = runTypecheck({ files: ["src/app/posts/services/publish.service.ts"] });
```

`runCheck()` runs the typecheck in-process unless you pass a `typecheck` runner; the CLI passes one that uses a child process.

## Legacy lint selection

`warlock check --lint eslint` keeps ESLint working until 5.34.0 and prints one
deprecation warning to stderr per process, including with `--json`. `check`
does not execute `warlock.config.ts`; select the legacy linter explicitly for
each check invocation. Background dev-server checks use their own config switches.

ESLint + Prettier are deprecated in 5.33.0 and will be removed in **5.34.0**.
New apps should use `--lint=oxc`. To migrate an existing app, install the new
core release and `ts-morph`, then run:

```bash
npx warlock upgrade --from 5.32 --to 5.33.0 --dry-run
npx warlock upgrade --from 5.32 --to 5.33.0
npm install
npm run format
npm run lint:check
npx warlock check
```

Review every reported `file:line`: customized configs are preserved and need
manual translation before removal. The codemod installs the template's Oxlint
and Oxfmt versions and pins TypeScript to 7.0.2. It replaces standard lint/format
scripts, removes legacy dependencies, and deletes only recognized generated
configs. A generated `.prettierignore` becomes `.oxfmtignore`. Existing Oxc
configs are preserved. `--dry-run --json` reports the same planned changes
without writing files.
