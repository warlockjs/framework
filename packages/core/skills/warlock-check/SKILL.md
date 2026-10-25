---
name: warlock-check
description: 'Verify a change with one command: `warlock check [--changed] [--json]` runs an incremental typecheck, the app''s Oxlint, the tests affected by the change and framework convention checks, and reports one JSON object per problem `{ code, category, severity, source, file, line, column, message, hint, skill, docs, rule }` with exit 1 for problems in your code and 2 for problems with this machine (missing Redis/DB, busy port, Node version, missing tool). Also `warlock typecheck [--changed]`, `warlock explain <CODE>` and the stable `WL` error codes (`errorCodeOf`, `WarlockError`). Triggers: `warlock check`, `warlock typecheck`, `warlock explain`, `--changed`, `--base`, `runCheck`, `runTypecheck`, `CHECK_EXIT_CODES`, `ToolingProblem`, `WL7101`, `WL8003`, `errorCodeOf`, `explainErrorCode`, `WarlockError`, "verify my change", "run the checks", "is this failure my code or the machine", "what does WL3001 mean", "typecheck only changed files". Skip: app diagnostics at boot — the `warlock-doctor` topic; reading the app''s routes/models — the `warlock-inspect` topic; writing tests — the `test-http` / `test-service` topics.'
---

# Warlock — `warlock check`, `typecheck`, `explain`

Run `warlock check` after every change and loop on it until it exits 0.

```bash
npx warlock check --changed --json    # inner loop: only what changed vs HEAD (+ untracked)
npx warlock check --base main         # what changed since the branch left main
npx warlock check                     # everything, before you finish
npx warlock check --skip tests        # steps: environment, typecheck, lint, tests, conventions
```

## Exit codes

| Exit | Meaning                                                 | What to do                                                                                                      |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `0`  | no errors (warnings allowed)                            | done                                                                                                            |
| `1`  | problems **in your code**                               | fix each problem at `file:line:column`                                                                          |
| `2`  | a problem with **this machine** — the run is incomplete | fix the environment (start Redis/DB, free the port, switch Node, install the tool); do **not** edit code for it |

`2` wins when both kinds exist. Each problem's `category` (`code` / `environment`) says the same per problem.

## One problem

```json
{
  "code": "WL8003",
  "category": "environment",
  "severity": "error",
  "source": "environment",
  "file": "src/app/posts/publish.spec.ts",
  "line": null,
  "column": null,
  "message": "Error: connect ECONNREFUSED 127.0.0.1:6379",
  "hint": "Start the service named in the message (database, Redis, ...) or point the config at a running one.",
  "skill": "warlock-check",
  "docs": "https://warlock.js.org/v/latest/core/cli/error-codes/#wl8003",
  "rule": "publish caches the post"
}
```

```bash
npx warlock check --changed --json > check.json; code=$?
jq -r '.problems[] | "\(.file // "-"):\(.line // 0) \(.code) \(.message)\n  → \(.hint)"' check.json
[ "$code" = 2 ] && echo "environment problem — fix the machine, not the code"
```

| Code                | Problem                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WL7101`            | type error (`rule` = `TS2322`, …)                                                                                                                     |
| `WL7102`            | tsconfig missing/invalid                                                                                                                              |
| `WL7201` / `WL7202` | lint error / warning (`rule` = the rule id)                                                                                                           |
| `WL7301` / `WL7302` | a test failed / a test file failed to load                                                                                                            |
| `WL9001`            | imports an auto-loaded file (`routes.ts`, `main.ts`, `worker.ts`, `events/*`)                                                                         |
| `WL9002`            | relative import ends in `.js`                                                                                                                         |
| `WL9003`            | relative import into another `src/app/<module>` — use `app/<module>/...`                                                                              |
| `WL9004`            | `experimentalDecorators: true` in tsconfig                                                                                                            |
| `WL9005`            | `request.all()` passed to a query, a service or `inApp()` — use `request.validated()`                                                                 |
| `WL9006`            | POST/PUT/PATCH/DELETE route with no auth middleware and no `public: true`                                                                             |
| `WL9007`            | redirect / `navigateTo()` / `<Link to>` target from request input without `safeRedirect()`                                                            |
| `WL9008`            | raw email, credential or request body in a log call                                                                                                   |
| `WL9009`            | regex with `*` / `+` / `{n,}` run on request input                                                                                                    |
| `WL9010`–`WL9012`   | warnings: `await log.*()`, a second controller in a file, a `kind` discriminator                                                                      |
| `WL9022`            | server-only code (controller, service, repository, model, route, connector, `*.server.*`) imports a `*.client.*` module — the message names the chain |
| `WL9023`            | an app-module `index.ts` that only re-exports; **off by default** (`rules.WL9023` in `.warlock-check.json`)                                           |
| `WL9105`            | a key of `utils/locales.json` or `utils/locales/<feature>.json` lacks a configured locale (`app.localeCodes`)                                         |
| `WL8001`–`WL8007`   | this machine: Node version, missing tool, unreachable service, busy port, esbuild binary, git, tool crash/OOM                                         |
| `WL8010`            | installed `@warlock.js/*` packages on different versions — run `warlock update`                                                                       |

## `warlock typecheck`

```bash
npx warlock typecheck                 # whole program, incremental (.warlock/cache/typecheck.tsbuildinfo)
npx warlock typecheck --changed       # changed files + the files importing them
npx warlock typecheck --json --project tsconfig.app.json
```

`--changed` checks diagnostics for changed files and their transitive importers. The native compiler still performs an incremental program compilation.

## `warlock explain`

```bash
npx warlock explain WL3001          # title, fix, skill, docs link
npx warlock explain WL3001 --json   # the registry entry
npx warlock explain                 # every code
```

## Error codes in code

Framework errors carry a stable `code`; read any thrown value with `errorCodeOf()` (it also maps `ECONNREFUSED` → `WL8003`, `EADDRINUSE` / `PortInUseError` → `WL8004`, and follows `cause`):

```ts
import { errorCodeOf, explainErrorCode, router, WarlockError } from "@warlock.js/core";

try {
  router.getRoute("posts.show", {});
} catch (error) {
  const code = errorCodeOf(error); // "WL3003" (unknown route name) or "WL3004" (missing param)
  console.error(code, code && explainErrorCode(code)?.fix);
}

// Throw a coded framework error from a connector or plugin:
throw new WarlockError("WL2003", "search connector failed to boot: SEARCH_URL is not set");
```

## From code

```ts
import { CHECK_EXIT_CODES, runCheck, runTypecheck } from "@warlock.js/core/tooling";

const report = await runCheck({ changed: true });

if (report.exitCode === CHECK_EXIT_CODES.environment) {
  // tell the user which service/tool is missing; don't touch the code
}

const types = runTypecheck({ files: ["src/app/posts/services/publish.service.ts"] });
```

## Gotchas

- `check` boots nothing — no config, no connection, no port — so it runs the same with or without services; only tests that need them fail, and those report `WL8003`/`WL8004`.
- Lint defaults to Oxlint (an app-root config + the app-installed package). No Oxlint config skips lint. A missing package reports `WL8002`. ESLint support was removed in 5.34.0; see `upgrade-from-5-29`.
- Tests use the app's own vitest (`vitest run`, or `vitest related <files> --run` with `--changed`). Test files without vitest installed → `WL8002`.
- The typecheck runs in a child `warlock typecheck` process; running out of memory is reported as `WL8007` instead of ending the run.
- The convention checks are the framework's own and run the same with Oxlint or no linter. A deliberate exception gets `// warlock-check-ignore WL9006 -- why` on the problem's line or the line above (no code = every code on that line).

## See also

- the `report-framework-issue` topic — confirm a framework bug or missing capability, collect `warlock issue` output, and get the user's approval before filing.
- The `warlock-doctor` topic — boot-time diagnostics; `doctor --json` uses the same codes and fields.
- The `warlock-inspect` topic — the app's routes, models and config as JSON.
- The `warlock-conventions` topic — the rules behind `WL9001`–`WL9012`, with the fix for each.

Migrate lint and format tooling with
`npx warlock upgrade --from 5.32 --to 5.33.0 --dry-run`, then remove `--dry-run`
and work through the manual-review list. Use `--lint=oxc` for new apps.

## Web and response contract conventions

The following codes default to **warnings**, so upgrading does not fail existing projects.
They parse real TypeScript/JSX syntax with the same oxc-parser adapter as the existing conventions.

| Code     | Convention                                                                       | Remedy                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WL9013` | A component file exceeds 150 lines                                               | Split components and extract hooks; configure `componentLineLimit`.                                                                                                |
| `WL9014` | More than one component in a file                                                | Move each component into its own TSX file.                                                                                                                         |
| `WL9015` | State/effects or event-handler functions inside a component                      | Move `useState`, `useReducer`, `useEffect`, `useLayoutEffect` and handlers into `use-*.ts` hooks.                                                                  |
| `WL9016` | Native select, checkbox, radio, date, time or datetime-local input               | Use the design-system control. Native controls are allowed in `src/web/design-system/**`.                                                                          |
| `WL9017` | DOM input/textarea/select native validation                                      | Use shared schema validation instead of `required`, `pattern`, `min`, `max`, `minLength`, `maxLength` or input `type="email"`. Custom component props are allowed. |
| `WL9018` | Exported `RequestHandler` in `src/app/**/controllers` lacks `responseSchema`     | Assign `handler.responseSchema` to document each response status.                                                                                                  |
| `WL9019` | Browser route call (`apiHref`, `useSubmitForm({ route })`) takes a run-time name | Pass a string literal or a template with a static prefix, or declare the names with `config.apiRoutes` in a page setup file.                                       |
| `WL9020` | Browser code names a route registered with `clientVisible: false` (error)        | Call the endpoint from the server, or remove `clientVisible: false` from the route.                                                                                |
| `WL9021` | A Cascade column is read or written as a model property (warning)                | Use `model.get("column")` / `model.set("column", value)`; `--fix` rewrites it.                                                                                     |
| `WL9024` | Integration spec imports nothing that needs the app (warning)                    | Move it to the unit project: rename `*.test.ts` to `*.spec.ts` outside `tests/`.                                                                                   |
| `WL9104` | Translation key computed at runtime in `src/web` (the page ships every group)    | Declare the keys with `config.translations` in the page's setup file, for example `["statuses.*"]`.                                                                |

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
suffixes from relative imports (`WL9002`) and rewrites `model.column` reads on Cascade models to `model.get("column")` (`WL9021`). Ignored/disabled findings are not fixed.
Component extraction, control replacement and response schemas require human decisions.
Problems that have a safe edit include optional `fix: { start, end, text }` in JSON;
`start` and `end` are zero-based source string offsets with an exclusive end.
The report otherwise keeps schema version 1 and its existing shape. Applied fixes disappear
from the final report; unresolved findings remain. Review the resulting source diff.

Programmatic usage: `await runCheck({ changed: true, fix: true })` from
`@warlock.js/core/tooling`.

## Explain a source file

`npx warlock explain src/app/posts/services/list.service.ts --json` reports the file's module, convention role, exports, imports, importers and reaching routes/pages. It boots the app for route/page registrations; error-code explanations remain static. See the `warlock-inspect` topic for graph semantics and the boot-free `npx warlock inspect --section files --json` command.

Starter controllers declare a response contract for each returned status. For example:

```ts
contactController.responseSchema = { 200: { body: { message: "string" } } };
```

Use `npx warlock inspect --section files --json` for static inspection without booting the app; `npx warlock explain src/app/contact/controllers/contact.controller.ts` explains its entry points.
