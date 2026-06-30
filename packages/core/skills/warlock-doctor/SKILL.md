---
name: warlock-doctor
description: 'Run `warlock doctor` — a read-only diagnostics command that checks routes / config / connectors / optional-peers / health endpoints / release hygiene and prints a pass/warn/fail report, exiting non-zero on any failure. Add your own probe with the `DoctorCheck` contract and `runChecks` / `formatReportLines`. Triggers: `warlock doctor`, `doctorCommand`, `DoctorCheck`, `CheckResult`, `CheckStatus`, `DoctorReport`, `runChecks`, `formatReportLines`, `printReport`, `defaultDoctorChecks`; "diagnose my app", "preflight / preflight check", "is the app healthy", "why are there 0 routes", "pre-release sanity check", "CI smoke check"; run as `yarn warlock doctor`. Skip: the live `/health` + `/ready` HTTP probes — `@warlock.js/core/health-checks/SKILL.md`; authoring a general CLI command — `@warlock.js/core/write-cli-command/SKILL.md`; releasing the package — `releasing-warlock-monorepo`; competing tools `npm doctor`, `nest info`, hand-rolled preflight scripts.'
---

# Warlock — `warlock doctor`

`warlock doctor` is a read-only preflight. It boots the app far enough to introspect it — loads every config file and bootstrap code so routes and connectors register — but **starts no connectors**, so it never opens a database, cache, or socket connection. It then runs a set of checks and prints a grouped pass / warn / fail report.

```bash
yarn warlock doctor
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

## What it checks

The default set is `defaultDoctorChecks` (in registration order — runtime-surface checks first, release hygiene last):

| Check | `ok` | `warn` | `fail` |
| --- | --- | --- | --- |
| `routes` | ≥ 1 route registered | 0 routes (a route module likely failed to load) | — |
| `config` | required sections (`app`, `http`) present | — | a required section is missing |
| `connectors` | manager enumerable; reports registered + active set | — | (only if the probe itself throws) |
| `optional-peers` | every known optional peer installed | a peer is missing → its feature is unavailable | — |
| `health` | `/health` + `/ready` will be exposed | `http.health.enabled = false` (probes off) | — |
| `release-hygiene` | `package.json` version matches the top `## x.y.z` CHANGELOG heading | no `CHANGELOG.md`, or no parseable heading | version ≠ top heading |

Optional peers are resolved from the **consuming app's** `node_modules` (via `createRequire(process.cwd())`), so the report reflects what *your* project has installed, not core's own deps.

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
  name: string;     // stable check name, e.g. "routes"
  status: CheckStatus;
  detail: string;   // one-line, user-facing explanation
};

type DoctorCheck = {
  name: string;
  run: () => CheckResult | Promise<CheckResult>;   // MUST be read-only
};

type DoctorReport = {
  results: CheckResult[];                 // in registration order
  summary: Record<CheckStatus, number>;   // counts per status
  hasFailures: boolean;                   // true iff any fail
  exitCode: 0 | 1;                        // 1 when hasFailures, else 0
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
    const pending = await countPendingMigrations();   // your read-only probe

    return pending === 0
      ? { name: "migrations", status: "ok", detail: "no pending migrations" }
      : { name: "migrations", status: "warn", detail: `${pending} pending` };
  },
};

const report = await runChecks([...defaultDoctorChecks, migrationsCheck]);

printReport(report);                  // colored, to stdout
const lines = formatReportLines(report);   // plain strings — snapshot-friendly

if (report.hasFailures) process.exit(report.exitCode);
```

`formatReportLines` returns plain (uncolored) `<symbol> <name>: <detail>` lines plus a `Summary: …` line — handy for tests. `printReport` is the colored stdout wrapper; the structured `DoctorReport` stays the source of truth for the exit code.

## Patterns

### CI / pre-release gate

```bash
yarn warlock doctor || exit 1   # non-zero exit fails the job
```

A red `release-hygiene` line catches the classic "bumped `package.json` but forgot the CHANGELOG heading" mistake before a publish.

### Diagnosing a silent 404 surface

A `⚠ routes: 0 routes registered` line is the tell that a route module threw on import or registration and the failure was surfaced (not swallowed). Re-run `warlock dev` and read the boot error.

## Gotchas

- **`doctor` starts no connectors.** It intentionally does not open DB / cache / socket connections — the `connectors` check reports the *registered* set and which are already active, without forcing any up. Don't expect it to detect a down database.
- **Optional-peers resolves from the project, not core.** A peer installed only inside core's own `node_modules` still reports as missing — the probe uses `process.cwd()`.
- **Warnings don't fail the command.** Only a `fail` flips the exit code. Missing optional peers and disabled health endpoints are deliberate-choice `warn`s.
- **Custom checks must stay read-only.** `run()` runs against a booted-but-not-connected app; mutating state or opening a connection breaks the contract and can hang the command.

## See also

- [`health-checks/SKILL.md`](../health-checks/SKILL.md) — the live `/health` + `/ready` HTTP probes and the `health` registry the `health` doctor check reports on.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — authoring a command + its `preload` plan, the shape `doctorCommand` is built from.
- [`add-connector/SKILL.md`](../add-connector/SKILL.md) — connector registration, which the `connectors` check enumerates.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — project layout the checks assume.
