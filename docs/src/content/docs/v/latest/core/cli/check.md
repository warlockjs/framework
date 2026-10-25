---
title: "warlock check & typecheck"
description: The single verify command — incremental typecheck, the app's Oxlint, the tests affected by a change and framework convention checks — reporting one JSON object per problem with a stable code, and exit codes that separate "your code" (1) from "this machine" (2). Plus `warlock typecheck [--changed]` on its own.
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
| `--lint`        | string  | `oxlint` (default and only supported value).                                               |
| `--project, -p` | string  | tsconfig path (default `tsconfig.json`).                                                   |
| `--json, -j`    | boolean | Print the report as JSON. stdout carries only the JSON.                                    |

## Exit codes

| Exit | Meaning                                                 | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | No error-severity problem. Warnings are allowed.        | A clean run; lint warnings only.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `1`  | Problems **in your code** only.                         | A type error (`WL7101`), a lint error (`WL7201`), a failing test (`WL7301`), a convention problem (`WL9001`–`WL9009`).                                                                                                                                                                                                                                                                                                                                                                      |
| `2`  | A problem with **this machine**: the run is incomplete. | Node too old for `engines.node` (`WL8001`); an oxlint config without the oxlint package, or test files without vitest (`WL8002`); a test failing with `ECONNREFUSED` because the database or Redis is not running (`WL8003`); a test failing with `EADDRINUSE` (`WL8004`); `--changed` outside a git repository (`WL8006`); a tool that crashed, timed out or ran out of memory (`WL8007`); installed `@warlock.js/*` packages on different versions (`WL8010`, fix with `warlock update`). |

`2` wins over `1`: when the machine kept a step from running, the run did not check everything, so it cannot claim the code is the only problem. Fix the environment, then run again. Every problem's `category` field says the same thing per problem: `code` or `environment`.

Any other exit code means the `check` process itself died — treat it like `2`.

`check` only **detects and reports** environment problems. It never stops a process, frees a port or starts a service; the only processes it ends are the child processes it started itself (a vitest or typecheck run that exceeds its time limit).

## Steps

All steps run, even after one fails, so one run lists every problem.

| Step          | What it does                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment` | Checks the running Node.js against core's minimum (22.15) and the app's own `engines.node` when it is a `>=` range. With `--changed`, lists the changed files with git; if git cannot, every later step is `blocked`.         |
| `typecheck`   | Runs [`warlock typecheck`](#warlock-typecheck) in a child process, so a heap overflow on a large app is reported as `WL8007` instead of ending `check`.                                                                       |
| `lint`        | Oxlint when an app-root Oxlint config exists. Lints `src/**` (or changed files). A missing Oxlint package is `WL8002`.                                                                                                        |
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

Every problem has every key; `file`, `line`, `column` and `rule` are `null` when they do not apply. `rule` is the tool's own identifier: `TS2322`, an Oxlint rule id, or the failing test's full name. `warlock doctor --json` uses the same `code` / `hint` / `skill` / `docs` fields.

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

It runs the TypeScript compiler API with `incremental` and `noEmit`, keeping its state in `.warlock/cache/typecheck.tsbuildinfo`, so the second run only re-checks what changed. With `--changed` it collects diagnostics for changed files and their transitive importers. Compilation still runs incrementally across the program.

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

## Web and response contract conventions

The following codes default to **warnings**, so upgrading does not fail existing projects.
They parse real TypeScript/JSX syntax with the same oxc-parser adapter as the existing conventions.

| Code     | Convention                                                                                               | Remedy                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WL9013` | A component file exceeds 150 lines                                                                       | Split components and extract hooks; configure `componentLineLimit`.                                                                                                |
| `WL9014` | More than one component in a file                                                                        | Move each component into its own TSX file.                                                                                                                         |
| `WL9015` | State/effects or event-handler functions inside a component                                              | Move `useState`, `useReducer`, `useEffect`, `useLayoutEffect` and handlers into `use-*.ts` hooks.                                                                  |
| `WL9016` | Native select, checkbox, radio, date, time or datetime-local input                                       | Use the design-system control. Native controls are allowed in `src/web/design-system/**`.                                                                          |
| `WL9017` | DOM input/textarea/select native validation                                                              | Use shared schema validation instead of `required`, `pattern`, `min`, `max`, `minLength`, `maxLength` or input `type="email"`. Custom component props are allowed. |
| `WL9018` | Exported `RequestHandler` in `src/app/**/controllers` lacks `responseSchema`                             | Assign `handler.responseSchema` to document each response status.                                                                                                  |
| `WL9019` | A browser route call (`apiHref`, `useSubmitForm({ route })`) takes a name that is only known at run time | Pass a string literal or a template with a static prefix, or declare the names with `config.apiRoutes` in a page setup file.                                       |
| `WL9020` | Browser code references a route registered with `clientVisible: false` (an error, not a warning)         | Call the endpoint from the server, or drop `clientVisible: false` from the route.                                                                                  |
| `WL9021` | A Cascade column is read or written as a model property (`user.email`)                                  | Use `user.get("email")` / `user.set("email", value)`; `--fix` rewrites it.                                                                                         |
| `WL9024` | An integration spec (`*.test.ts`, or under `tests/`) imports nothing that needs the app (a warning)      | Move it to the unit project: rename it to `*.spec.ts` outside `tests/`.                                                                                            |
| `WL9104` | Translation key computed at runtime in `src/web` (a page then ships every group)                         | Declare the keys with `config.translations` in the page's setup file.                                                                                              |

## Boundary, barrel and locale conventions

| Code     | Finding                                                                                                                                  | Fix                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `WL9022` | Server-only code imports a `*.client.ts(x)` module, directly or through other files; the message names the import chain (an error)      | Remove the import. Pass the data through a loader, or move shared logic to a file that is neither `.client` nor server-only.        |
| `WL9023` | An `index.ts` in an app module only re-exports other files. **Off by default**; set `rules.WL9023` to `"warning"` or `"error"` to enable | Import from the file that defines each export and delete the barrel.                                                                 |
| `WL9105` | A key of `utils/locales.json` or `utils/locales/<feature>.json` is missing one of the configured locales (an error)                      | Add the missing locale to the key. The configured locales are `localeCodes` in `src/config/app.ts` or in `.warlock-check.json`. |

Server-only code means controllers, services, repositories, models, connectors, a
module's `routes.ts`, `main.ts`, `worker.ts` and `events/`, and any `*.server.*` file.
Pages, layouts, components and other `.client` modules may import a `.client` module. A
type-only import is erased and never reported. Exported input and output types that sit
beside the service, repository or controller that uses them are fine and raise nothing.

`WL9105` reads the dictionaries as files, so it needs no boot. It is skipped when no
locales are configured. To set them for the check only:

```json
{
  "localeCodes": ["en", "ar"],
  "rules": { "WL9023": "warning" }
}
```

Web rules apply to `src/web/**/*.tsx`. Components are top-level JSX-returning functions
with a capitalized name (or an anonymous default export). Hook files and ordinary helpers
are excluded. Handler checks recognize inline JSX callbacks, `handle*`/`on*` functions,
and local function values referenced by event props. They do not execute code or infer
runtime spreads, factory contracts or values imported from other files.

Create `.warlock-check.json` in the project root:

```json
{
  "componentLineLimit": 180,
  "rules": {
    "WL9013": "warning",
    "WL9015": "error",
    "WL9016": "off"
  }
}
```

`rules` accepts `"off"`, `"warning"`, or `"error"` for convention codes, including
existing codes. Per-line `// warlock-check-ignore WL9015 -- reason` works as before.
Use `npx warlock explain WL9015` for the registry explanation.

```bash
npx warlock check --changed --fix --json
```

`--changed` selects tracked changes against HEAD plus untracked source files and their
transitive import dependents (including re-exports, type imports and related tests).
Resolution uses the project's compiler configuration, with relative/app imports as a
fallback for files outside that configuration. Lint and conventions receive that selection;
Vitest uses related mode. TypeScript still compiles incrementally as a program, then filters
diagnostics to the selection and its importers; this is not a partial compilation.

`--fix` applies safe convention edits before the pipeline. Currently it removes `.js`
suffixes from relative imports (`WL9002`) and rewrites `model.column` property reads
on Cascade models to `model.get("column")` (`WL9021`). Ignored/disabled findings are not fixed.
Component extraction, control replacement and response schemas require human decisions.
Problems that have a safe edit include optional `fix: { start, end, text }` in JSON;
`start` and `end` are zero-based source string offsets with an exclusive end.
The report otherwise keeps schema version 1 and its existing shape. Applied fixes disappear
from the final report; unresolved findings remain. Review the resulting source diff.

Programmatic usage: `await runCheck({ changed: true, fix: true })` from
`@warlock.js/core/tooling`.

## Explain a source file

`npx warlock explain src/app/posts/services/list.service.ts --json` reports the file's module, convention role, exports, imports, importers and reaching routes/pages. It boots the app for route/page registrations; error-code explanations remain static. See the `warlock-inspect` topic for graph semantics and the boot-free `npx warlock inspect --section files --json` command.
