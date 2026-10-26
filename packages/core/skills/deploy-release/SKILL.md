---
name: deploy-release
description: 'Deploy a Warlock application with `warlock release` — freeze a clean commit as a candidate, run the gate, prove migrations, stage the build, switch `current` by atomic symlink, verify the health URL and roll back, configured by the `release` section of `warlock.config.ts`. Triggers: `warlock release`, `release candidate`, `release gate`, `release migrations --prove`, `release stage`, `release activate`, `release verify`, `release rollback`, `release prune`, `ReleaseConfig`, `release.restart.command`, `release.verify`, `.warlock/releases`; "deploy my app", "zero-downtime deploy", "roll back a deploy", "atomic release", "release gate", "prove migrations before deploy". Skip: the `/health` and `/ready` endpoints themselves — the `health-checks` topic; generating a PM2 ecosystem file — `warlock pm2` (the `run-app` topic); publishing the framework packages — `releasing-warlock-monorepo`; competing tools Capistrano, Deployer, hand-rolled symlink scripts.'
---

# Warlock — deploy with `warlock release`

A recorded, step-by-step deploy for one host. Each step is a command; each writes into a per-release `manifest.json` and a shared `release.log`.

```text
candidate -> gate -> migrations --prove -> stage -> activate -> verify
                                                        \-> rollback
```

Warlock never calls PM2, systemd or any process manager. The only restart is the command you set in `release.restart.command`.

When the deploy also upgrades the framework, run `npx warlock release-notes --from <current>` first (`<current>` is the `@warlock.js/core` version now in `package.json`). It lists the breaking changes of every release in between; `warlock upgrade --check` rehearses them on a copy.

## Configure

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  release: {
    gate: {
      checks: [
        { name: "typecheck", command: "npx warlock typecheck" },
        { name: "test", command: "npx warlock test" },
        { name: "build", command: "NODE_ENV=production npx warlock build" },
      ],
    },
    restart: { command: "pm2 reload my-app" },
    verify: { url: "http://127.0.0.1:2030/health" },
  },
});
```

Defaults: `directory` `.warlock`, `distDir` `dist`, gate = typecheck, check, test, build. Add `.warlock` to `.gitignore`.

## Run the steps

```bash
npx warlock release candidate [--commit <sha>] [--allow-dirty]
npx warlock release gate
npx warlock release migrations --prove --target staging
npx warlock release stage
npx warlock release activate --preflight
npx warlock release activate [--dry-run] [--allow-same]
npx warlock release verify || npx warlock release rollback
```

Every command takes an optional release id (`release gate 1.4.0-a1b2c3d`); without one it uses the newest candidate, gated or staged release. `--json` prints the result as JSON; a failed step exits 1.

- **candidate** freezes the commit with `git archive` into `.warlock/releases/<version>-<shortsha>/source`. Refuses a dirty tree without `--allow-dirty` and never overwrites a release.
- **gate** runs the checks in order in the frozen source and stops at the first failure; results go into the manifest.
- **migrations** without `--prove` only lists the pending set. With `--prove` it snapshots the ledger, tables and indexes, runs the pending migrations, snapshots again and compares with the expected set (`release.migrations.expected`, default the pending set; `expectedTables`). The migrations really run: use `--target` (a `release.migrations.targets` entry whose `env` is applied before the database connects) on a database that is safe to migrate. A failed proof blocks activation.
- **stage** (needs a passing gate) copies `dist`, `package.json`, the lockfile, `release.include` entries and `release.json` into `staged/`, atomically.
- **activate** needs staged artefacts, a passed gate (and proof), and a version strictly greater than the active one (semver; `--allow-same` accepts an equal version, a lower one is refused). It switches `current -> releases/<id>` with an atomic rename, keeps the old target as `previous`, then runs the restart command with `WARLOCK_RELEASE_ID`, `WARLOCK_RELEASE_DIR` and `WARLOCK_RELEASE_CURRENT` set. If that command fails, the pointer stays switched and the exit code is 1.
- **verify** GETs `release.verify.url` with retries and a timeout and checks the status plus the `version` and `commit` fields of the JSON body against the active release (`verify.versionPath`, `commitPath` and `match` adjust that). Serve the `release.json` values from your health endpoint.
- **rollback** switches `current` back to `previous` (and `previous` to the release just left), reruns the restart command. It does not roll migrations back: a migration may have destroyed data no reverse step restores; use `warlock migrate --rollback` deliberately if needed.
- **list** and **status** show releases and the active one; **prune --keep <n>** is the only command that deletes releases and always keeps `current` and `previous`.

## Layout

```text
.warlock/current -> releases/<id>      .warlock/previous -> releases/<id>
.warlock/release.log
.warlock/releases/<id>/{manifest.json, source/, staged/}
```

Run the app from `.warlock/current/staged` so a restart follows the pointer.

## Pitfalls

- Run `activate --dry-run` or `--preflight` first in CI; both change nothing.
- Without `restart.command` activation only moves the symlink; the running process keeps serving the old code.
- `verify` fails when the response does not report a version; set `verify.match` to `[]` to check only the status.
