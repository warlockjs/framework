---
name: warlock-doctor
description: 'Run `warlock doctor` — a read-only diagnostics command that checks routes / config / connectors / optional-peers / health endpoints / multi-site renders / capabilities / release hygiene and prints a pass/warn/fail report, exiting non-zero on any failure. Add your own probe with the `DoctorCheck` contract and `runChecks` / `formatReportLines`. Triggers: `warlock doctor`, `warlock doctor --json`, `toDoctorJson`, `WL1001`, `doctorCommand`, `DoctorCheck`, `CheckResult`, `CheckStatus`, `DoctorReport`, `runChecks`, `formatReportLines`, `printReport`, `defaultDoctorChecks`; "diagnose my app", "preflight / preflight check", "is the app healthy", "why are there 0 routes", "pre-release sanity check", "CI smoke check"; run as `npx warlock doctor`. Skip: the live `/health` + `/ready` HTTP probes — the `health-checks` topic; authoring a general CLI command — the `write-cli-command` topic; releasing the package — `releasing-warlock-monorepo`; competing tools `npm doctor`, `nest info`, hand-rolled preflight scripts.'
---

# Warlock — `warlock doctor`

`warlock doctor` is a read-only preflight. It boots the app far enough to introspect it — loads every config file and bootstrap code so routes and connectors register — but **starts no connectors**, so it never opens a database, cache, or socket connection. It then runs a set of checks and prints a grouped pass / warn / fail report.

```bash
npx warlock doctor
```

```
✓ routes: 42 registered
✓ config: required sections present (app, http)
✓ connectors: 3 registered, active: database, cache
⚠ optional-peers: not installed → unavailable: sharp (image processing); redis (Redis cache driver)
✓ health: liveness /health + readiness /ready registered
✓ release-hygiene: package.json and CHANGELOG agree on 4.6.0

Summary: 5 ok, 1 warn, 0 fail
```

## Error codes and `--json`

Every `warn`/`fail` finding carries a stable error code (`WL1001`, `WL2001`, …), printed after the detail and explained by `warlock explain <code>`. `--json` prints the report with the same `code` / `hint` / `skill` / `docs` fields `warlock check --json` uses (boot output goes to stderr):

```bash
npx warlock doctor --json | jq '.results[] | select(.status != "ok") | "\(.code) \(.detail)"'
npx warlock explain WL1001
```

```json
{
  "schemaVersion": 1,
  "results": [
    {
      "name": "config",
      "status": "fail",
      "detail": "missing required config section(s): http",
      "code": "WL1001",
      "hint": "Add the missing file under src/config/ (for example src/config/app.ts) exporting the section.",
      "skill": "configure-app",
      "docs": "https://warlock.js.org/v/latest/core/cli/error-codes/#wl1001"
    }
  ],
  "summary": { "ok": 0, "warn": 0, "fail": 1 },
  "exitCode": 1
}
```

A custom check sets `code` on its non-ok results the same way (`{ name, status: "fail", code: "WL2003", detail }`); `ok` results carry none.

## What it checks

The default set is `defaultDoctorChecks` (in registration order — runtime-surface checks first, release hygiene last):

| Check             | `ok`                                                                | `warn`                                          | `fail`                                                                                                     |
| ----------------- | ------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `routes`          | ≥ 1 route registered                                                | 0 routes (a route module likely failed to load) | —                                                                                                          |
| `config`          | required sections (`app`, `http`) present                           | —                                               | a required section is missing                                                                              |
| `connectors`      | manager enumerable; reports registered + active set                 | —                                               | (only if the probe itself throws)                                                                          |
| `optional-peers`  | every known optional peer installed                                 | a peer is missing → its feature is unavailable  | —                                                                                                          |
| `jwt-secret`      | `auth.userType` configured and a JWT signing secret set             | —                                               | `auth.userType` is configured but no signing secret (`auth.accessToken.secret` / `auth.jwt.secret`) is set |
| `health`          | `/health` + `/ready` will be exposed                                | `http.health.enabled = false` (probes off)      | —                                                                                                          |
| `sites`           | each fixed-host site in `web.sites` renders its root page in development without a 5xx | —                         | a site answers 5xx (`WL5005`), with the status, phase and page file                                        |
| `capabilities`    | every required capability has a provider after boot                 | a required capability has none (`WL2008`)       | —                                                                                                          |
| `release-hygiene` | `package.json` version matches the top `## x.y.z` CHANGELOG heading | no `CHANGELOG.md`, or no parseable heading      | version ≠ top heading                                                                                      |

`sites` renders the root page of every site in an app with `web.sites` through the development page pipeline, inside the doctor process (the request is injected into the booted HTTP server; no port is opened). A multi-site app can answer 500 on every page in development and under the test server while production is healthy; this is the check that sees it. It requests `/` (or the site's `basePath`) with the site's first hostname as the `Host` header, one site at a time; a redirect or a 404 is fine, only a 5xx or no answer fails. Sites whose hosts are resolved at runtime (`dynamic: true`) are not rendered.

`capabilities` reads the registry that `defineCapability()` fills (the `use-capabilities` topic): a required capability that no `provideCapability()` call filled while the app booted is a slot the first caller will trip over.

`jwt-secret` is the pre-flight form of the silent first-login 500: when `auth.userType` is set but no signing secret is, every login and token operation fails with a generic 500 at runtime — `doctor` turns that into a `fail` before you ship. It resolves the secret from both the current key (`auth.accessToken.secret`) and the legacy `auth.jwt.secret`, so a project on the older-but-supported shape doesn't trip it. When `auth.userType` isn't configured at all (no auth), the check emits **no line** — it's skipped, not a pass — so it never nags a project that isn't doing auth.

Optional peers are resolved from the **consuming app's** `node_modules` (via `createRequire(process.cwd())`), so the report reflects what _your_ project has installed, not core's own deps.

## Exit code

```
warn only  → exit 0   (warnings never fail the command)
any fail    → exit 1   (so CI / a release script can gate on it)
```

`doctor` itself can never crash: a check that throws is caught by the runner and recorded as a `fail` (detail `check threw: <message>`), not re-thrown.

## The contract

```ts
type CheckStatus = "ok" | "warn" | "fail";

type CheckResult = {
  name: string; // stable check name, e.g. "routes"
  status: CheckStatus;
  detail: string; // one-line, user-facing explanation
  code?: WarlockErrorCode; // stable code of a warn/fail verdict, e.g. "WL1001"
};

type DoctorCheck = {
  name: string;
  run: () => CheckResult | Promise<CheckResult>; // MUST be read-only
};

type DoctorReport = {
  results: CheckResult[]; // in registration order
  summary: Record<CheckStatus, number>; // counts per status
  hasFailures: boolean; // true iff any fail
  exitCode: 0 | 1; // 1 when hasFailures, else 0
};
```

A `DoctorCheck.run` must be **read-only** — it may introspect the router, connectors, config, and `package.json`, but must never mutate state or open a connection. It may be sync or async, and may throw (the runner degrades a throw to a `fail`).

## Running checks yourself

The runner and formatter are exported, so you can assemble your own check set — e.g. an app-specific preflight script or a custom CLI command:

```ts
import {
  runChecks,
  formatReportLines,
  printReport,
  defaultDoctorChecks,
  type DoctorCheck,
} from "@warlock.js/core";

const migrationsCheck: DoctorCheck = {
  name: "migrations",
  async run() {
    const pending = await countPendingMigrations(); // your read-only probe

    return pending === 0
      ? { name: "migrations", status: "ok", detail: "no pending migrations" }
      : { name: "migrations", status: "warn", detail: `${pending} pending` };
  },
};

const report = await runChecks([...defaultDoctorChecks, migrationsCheck]);

printReport(report); // colored, to stdout
const lines = formatReportLines(report); // plain strings — snapshot-friendly

if (report.hasFailures) process.exit(report.exitCode);
```

`formatReportLines` returns plain (uncolored) `<symbol> <name>: <detail>` lines plus a `Summary: …` line — handy for tests. `printReport` is the colored stdout wrapper; the structured `DoctorReport` stays the source of truth for the exit code.

## Patterns

### CI / pre-release gate

```bash
npx warlock doctor || exit 1   # non-zero exit fails the job
```

A red `release-hygiene` line catches the classic "bumped `package.json` but forgot the CHANGELOG heading" mistake before a publish.

### Diagnosing a silent 404 surface

A `⚠ routes: 0 routes registered` line is the tell that a route module threw on import or registration and the failure was surfaced (not swallowed). Re-run `warlock dev` and read the boot error.

## Gotchas

- **`doctor` starts no connectors.** It intentionally does not open DB / cache / socket connections — the `connectors` check reports the _registered_ set and which are already active, without forcing any up. Don't expect it to detect a down database.
- **Optional-peers resolves from the project, not core.** A peer installed only inside core's own `node_modules` still reports as missing — the probe uses `process.cwd()`.
- **Warnings don't fail the command.** Only a `fail` flips the exit code. Missing optional peers and disabled health endpoints are deliberate-choice `warn`s.
- **Custom checks must stay read-only.** `run()` runs against a booted-but-not-connected app; mutating state or opening a connection breaks the contract and can hang the command.

## See also

- The `health-checks` topic — the live `/health` + `/ready` HTTP probes and the `health` registry the `health` doctor check reports on.
- The `write-cli-command` topic — authoring a command + its `preload` plan, the shape `doctorCommand` is built from.
- The `add-connector` topic — connector registration, which the `connectors` check enumerates.
- The `warlock-conventions` topic — project layout the checks assume.
- The `warlock-check` topic — `warlock check` / `typecheck` / `explain` and the error-code registry the findings use.
- The `warlock-inspect` topic — `warlock inspect`, the same boot pass printed as a versioned JSON report of the app.

## Lint and format checks

`warlock doctor` checks application wiring and HTTP health probes. Use
`npx warlock check` for source lint diagnostics and `npm run format:check` for
formatting. Oxlint/Oxfmt are the only supported tools in 5.34.0. Use the
`oxc-toolchain-removal` upgrade step to migrate remaining legacy configs.
Migrate with `npx warlock upgrade --from 5.32 --to 5.33.0` (preview with `--dry-run`).
