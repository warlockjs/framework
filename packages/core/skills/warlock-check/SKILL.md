---
name: warlock-check
description: 'Verify a change with one command: `warlock check [--changed] [--json]` runs an incremental typecheck, the app''s ESLint/oxlint, the tests affected by the change and framework convention checks, and reports one JSON object per problem `{ code, category, severity, source, file, line, column, message, hint, skill, docs, rule }` with exit 1 for problems in your code and 2 for problems with this machine (missing Redis/DB, busy port, Node version, missing tool). Also `warlock typecheck [--changed]`, `warlock explain <CODE>` and the stable `WL` error codes (`errorCodeOf`, `WarlockError`). Triggers: `warlock check`, `warlock typecheck`, `warlock explain`, `--changed`, `--base`, `runCheck`, `runTypecheck`, `CHECK_EXIT_CODES`, `ToolingProblem`, `WL7101`, `WL8003`, `errorCodeOf`, `explainErrorCode`, `WarlockError`, "verify my change", "run the checks", "is this failure my code or the machine", "what does WL3001 mean", "typecheck only changed files". Skip: app diagnostics at boot — the `warlock-doctor` topic; reading the app''s routes/models — the `warlock-inspect` topic; writing tests — the `test-http` / `test-service` topics.'
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

| Code                | Problem                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `WL7101`            | type error (`rule` = `TS2322`, …)                                                                             |
| `WL7102`            | tsconfig missing/invalid                                                                                      |
| `WL7201` / `WL7202` | lint error / warning (`rule` = the rule id)                                                                   |
| `WL7301` / `WL7302` | a test failed / a test file failed to load                                                                    |
| `WL9001`            | imports an auto-loaded file (`routes.ts`, `main.ts`, `worker.ts`, `events/*`)                                 |
| `WL9002`            | relative import ends in `.js`                                                                                 |
| `WL9003`            | relative import into another `src/app/<module>` — use `app/<module>/...`                                      |
| `WL9004`            | `experimentalDecorators: true` in tsconfig                                                                    |
| `WL9005`            | `request.all()` passed to a query, a service or `inApp()` — use `request.validated()`                         |
| `WL9006`            | POST/PUT/PATCH/DELETE route with no auth middleware and no `public: true`                                     |
| `WL9007`            | redirect / `navigateTo()` / `<Link to>` target from request input without `safeRedirect()`                    |
| `WL9008`            | raw email, credential or request body in a log call                                                           |
| `WL9009`            | regex with `*` / `+` / `{n,}` run on request input                                                            |
| `WL9010`–`WL9012`   | warnings: `await log.*()`, a second controller in a file, a `kind` discriminator                              |
| `WL8001`–`WL8007`   | this machine: Node version, missing tool, unreachable service, busy port, esbuild binary, git, tool crash/OOM |

## `warlock typecheck`

```bash
npx warlock typecheck                 # whole program, incremental (.warlock/cache/typecheck.tsbuildinfo)
npx warlock typecheck --changed       # changed files + the files importing them
npx warlock typecheck --json --project tsconfig.app.json
```

`--changed` checks the changed files and their direct importers only; a full run (cheap after the first, it is incremental) catches anything further away.

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
- Lint runs only the linters the app configures (`eslint.config.*`; an oxlint config + the `oxlint` package). No config → the step is skipped, not failed.
- Tests use the app's own vitest (`vitest run`, or `vitest related <files> --run` with `--changed`). Test files without vitest installed → `WL8002`.
- The typecheck runs in a child `warlock typecheck` process; running out of memory is reported as `WL8007` instead of ending the run.
- The convention checks are the framework's own and run the same with ESLint, Oxlint or no linter. A deliberate exception gets `// warlock-check-ignore WL9006 -- why` on the problem's line or the line above (no code = every code on that line).

## See also

- `report-framework-issue.md` — confirm a framework bug or missing capability, collect `warlock issue` output, and get the user's approval before filing.
- The `warlock-doctor` topic — boot-time diagnostics; `doctor --json` uses the same codes and fields.
- The `warlock-inspect` topic — the app's routes, models and config as JSON.
- The `warlock-conventions` topic — the rules behind `WL9001`–`WL9012`, with the fix for each.
