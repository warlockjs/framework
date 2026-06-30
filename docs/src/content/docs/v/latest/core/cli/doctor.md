---
title: "warlock doctor"
description: The read-only diagnostics command — runs routes / config / connectors / optional-peers / health / release-hygiene checks, prints a pass/warn/fail report, and exits non-zero on any failure. What each check verifies, the status/exit-code semantics, and how to wire it into CI.
sidebar:
  order: 5
  label: "warlock doctor"
---

`warlock doctor` runs a set of **read-only** diagnostic checks over your application and prints a grouped pass / warn / fail report. It's the "is this app wired correctly?" smoke test — run it locally before a release, or in CI as a pre-deploy gate. It never mutates state, never opens a database/cache/socket connection, and never crashes: a broken probe degrades to a failed check rather than taking the command down.

```bash
warlock doctor
```

No flags, no positional args.

```
✓ routes: 42 registered
✓ config: required sections present (app, http)
✓ connectors: 7 registered, active: logger, database
⚠ optional-peers: not installed → unavailable: sharp (image processing); redis (Redis cache driver)
✓ health: liveness /health + readiness /ready registered
✓ release-hygiene: package.json and CHANGELOG agree on 4.6.0

Summary: 5 ok, 1 warn, 0 fail
```

## What it checks

Six checks run in a fixed order — runtime-surface first, release hygiene last:

| Check             | Status meaning                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `routes`          | Reports the number of registered routes. **`warn`** when zero (a route module probably failed to load silently). |
| `config`          | The required top-level config sections (`app`, `http`) are present. A missing one is a **`fail`**.                |
| `connectors`      | Lists the registered connectors and which are currently active. Informational — passes as long as it can enumerate. |
| `optional-peers`  | Probes the optional peer deps core knows how to use (`sharp`, `nodemailer`, `socket.io`, the AWS SDK family, `redis`, the DB drivers). Missing ones are a **`warn`** — that feature is simply unavailable, never a failure. |
| `health`          | The built-in `/health` (liveness) and `/ready` (readiness) endpoints will be exposed. **`warn`** when disabled via `http.health.enabled = false`. |
| `release-hygiene` | The project `package.json` version matches the top `## x.y.z` heading in `CHANGELOG.md`. A mismatch is a **`fail`**; a missing/unparseable changelog is a **`warn`**. |

## Statuses and exit code

Each check resolves to one of three statuses:

- **`ok`** — the facet is healthy.
- **`warn`** — non-fatal: a feature is unavailable or a soft expectation is unmet (a missing optional peer, disabled health endpoints). **Does not fail the command.**
- **`fail`** — a release/runtime-blocking problem (a missing required config section, a version↔changelog mismatch). **Forces a non-zero exit.**

The exit code is **`1` if any check fails, otherwise `0`** — warnings alone keep a zero exit. That makes `doctor` safe to wire into CI: it only blocks on real failures.

```bash
warlock doctor || exit 1   # fail the pipeline on any fail-status check
```

## What it does NOT do

`doctor` deliberately bootstraps your app code (so routes and connectors are registered for introspection) **but starts no connectors** — it never opens a database, cache, or socket connection. The `connectors` check therefore reports the registered set and which are *already* active without forcing any up. Every check is read-only: it may introspect the router, connectors, config, and `package.json`, but never writes.

## How a check is shaped

Each check is a small, self-contained probe. Internally a check is a `{ name, run() }` pair whose `run` returns a result — sync or async, read-only:

```ts
type CheckStatus = "ok" | "warn" | "fail";

type CheckResult = {
  name: string;     // stable check name, e.g. "routes"
  status: CheckStatus;
  detail: string;   // one-line, user-facing explanation
};
```

The runner executes every check in registration order and aggregates the results into a report — every result, per-status counts, a `hasFailures` flag, and the derived exit code. A check that throws (or rejects) is caught and recorded as a `fail` carrying the error message — never re-thrown. That's what keeps `doctor` itself crash-proof: a broken probe becomes a failed check, not a stack trace.

The default set, the runner, and the formatter live inside `@warlock.js/core`'s CLI internals — `doctor` is consumed as the `warlock doctor` command, not as a programmatic API you import.

## Gotchas

- **Warnings don't fail the command.** A missing optional peer or disabled health endpoint is a `warn` and keeps a zero exit. Only `fail`-status checks set exit `1`.
- **`release-hygiene` reads the project root.** It compares `package.json` and `CHANGELOG.md` at the project root — the same version↔changelog invariant the release-hygiene unit guard enforces, surfaced as a pre-release check.
- **No connectors are started.** Don't expect `doctor` to verify a live DB connection — it reports what's *registered*, not what connects. For runtime liveness use the `/health` / `/ready` endpoints.

## Going further

- [CLI commands](./cli-commands.md) — every other built-in `warlock` command.
- [Health checks](../digging-deeper/health-checks.md) — the `/health` / `/ready` endpoints the `health` check reports on.
- [Production hardening checklist](../digging-deeper/production-hardening-checklist.md) — where a pre-deploy `warlock doctor` run fits in the release flow.
