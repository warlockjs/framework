---
title: "Deploying with warlock release"
description: Freeze a commit, gate it, prove its migrations, stage the build, switch to it with one atomic symlink, verify the health URL and roll back. Configuration, every subcommand, the files it writes and what it never does.
sidebar:
  order: 15
  label: "warlock release"
---

`warlock release` is a deploy pipeline for an application built with Warlock. It turns "build on the server and hope" into a sequence of recorded steps, each one a command you can run by hand or from CI:

```text
candidate -> gate -> migrations --prove -> stage -> activate -> verify
                                                        \-> rollback
```

It works on one host, with plain directories and symlinks. It never calls PM2, systemd or any process manager: the only thing it runs to restart your app is the command **you** put in `release.restart.command`.

## Configure

Add a `release` section to `warlock.config.ts`. Every field is optional.

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  release: {
    // where releases and the current / previous pointers live (default ".warlock")
    directory: ".warlock",
    // build output inside the frozen source (default "dist")
    distDir: "dist",
    gate: {
      checks: [
        { name: "typecheck", command: "npx warlock typecheck" },
        { name: "check", command: "npx warlock check" },
        { name: "test", command: "npx warlock test" },
        { name: "build", command: "NODE_ENV=production npx warlock build" },
      ],
    },
    // yours: Warlock runs exactly this, nothing else
    restart: { command: "pm2 reload my-app" },
    verify: { url: "http://127.0.0.1:2030/health" },
  },
});
```

| Key                                 | Default                       | Meaning                                                                                                              |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `directory`                         | `".warlock"`                  | Base directory. Releases live in `<directory>/releases/<id>`; the pointers are `<directory>/current` and `previous`. |
| `distDir`                           | `"dist"`                      | Build output, relative to the candidate's source.                                                                    |
| `include`                           | `[]`                          | Extra files or directories copied into the staged release. `package.json` and the lockfile are always copied.        |
| `linkNodeModules`                   | `true`                        | Link the project's `node_modules` into the frozen source and the staged release.                                     |
| `gate.checks`                       | typecheck, check, test, build | Ordered `{ name, command, timeoutMs? }` list. Replaces the defaults.                                                 |
| `migrations.targets`                | none                          | Named `{ env }` overrides for `--target`.                                                                            |
| `migrations.expected`               | the pending set               | Migration names that must be the ones applied, in order.                                                             |
| `migrations.expectedTables`         | none                          | Tables or collections that must exist after the proof.                                                               |
| `restart.command`                   | none                          | Shell command run after activation and rollback. `restart.timeoutMs` defaults to 120000.                             |
| `verify.url`                        | none                          | Health URL for `release verify`.                                                                                     |
| `verify.expectedStatus`             | `200`                         | Required HTTP status.                                                                                                |
| `verify.retries` / `intervalMs`     | `5` / `2000`                  | Extra attempts and the pause between them. `verify.timeoutMs` (default 5000) bounds each request.                    |
| `verify.versionPath` / `commitPath` | `"version"` / `"commit"`      | Dotted paths into the JSON response.                                                                                 |
| `verify.match`                      | `["version", "commit"]`       | Which reported fields must equal the active release.                                                                 |

The restart command runs through the shell in the project root with these variables set: `WARLOCK_RELEASE_ID`, `WARLOCK_RELEASE_DIR` (the release directory) and `WARLOCK_RELEASE_CURRENT` (the `current` symlink path).

## The steps

Commands take an optional release id (`release gate 1.4.0-a1b2c3d`). Without one they use the newest release that is still a candidate, gated or staged.

### `release candidate [--commit <sha>] [--allow-dirty]`

Freezes a commit (default `HEAD`) with `git archive` into `<directory>/releases/<version>-<shortsha>/source`. Every later step works on those bytes, not on a working tree that keeps changing. The working tree must be clean (the release directory itself is ignored), or pass `--allow-dirty`. An existing release is never overwritten.

The candidate gets a `manifest.json`: version (from `package.json` at that commit), commit, creation time, Node version and the lockfile name and SHA-256.

### `release gate`

Runs `gate.checks` in order inside the frozen source and stops at the first failure. Results (exit code, duration, the output tail of a failed check) go into the manifest. Checks after the failing one are not run and not recorded. A passing gate marks the candidate `gated`; running the gate again discards any earlier staging.

### `release migrations [--prove] [--target <name>]`

Without `--prove` it only prints the pending migrations, in the order they would run. With `--prove` it:

1. snapshots the migration ledger, the tables or collections and their indexes;
2. runs the pending migrations;
3. snapshots again and compares: exactly the expected migrations were applied, in order, the ledger grew by exactly those names, and every `migrations.expectedTables` entry exists.

Both snapshots, the tables and indexes that changed and any problems are recorded in the manifest. A failed proof blocks `activate`. The migrations really run, so point it at a database that is safe to migrate: use `--target <name>` to apply the `env` of a `migrations.targets` entry before the database connects.

```ts title="warlock.config.ts"
release: {
  migrations: {
    targets: { staging: { env: { DB_URL: "mongodb://staging-db/app" } } },
    expectedTables: ["orders"],
  },
}
```

It uses cascade's migration API and the data source's driver blueprint, so it does not depend on one database.

### `release stage`

Needs a passing gate. Copies the build output, `package.json`, the lockfile, the `include` entries and a `release.json` (`id`, `version`, `commit`) into `staged/`. The directory is assembled under a temporary name and renamed into place, so a half-copied `staged` never exists. Serve `release.json` (or the same values) from your health endpoint and `release verify` can compare them.

### `release activate [--preflight] [--dry-run] [--allow-same]`

Preflight checks, all of which must pass:

- staged artefacts are present;
- the gate passed (and the migration proof, if one was recorded);
- the release is not already active;
- its version is **strictly greater** than the active one, by semantic-version comparison (`1.10.0` is greater than `1.2.0`).

An equal version (a rebuild from another commit) needs `--allow-same`. A lower version is never activated this way; use `release rollback`.

Then `current` is switched with one atomic symlink rename (`current -> releases/<id>`), the old target becomes `previous`, and the restart command runs if configured. `--preflight` stops after the checks; `--dry-run` prints the plan and changes nothing. If the restart command fails, the pointer stays on the new release (the restart may have partly happened) and the command exits 1 telling you to fix it or roll back.

### `release verify`

Sends GET to `verify.url` until it answers with the expected status and, from the JSON body, the active release's version and commit (a reported short commit of at least 7 characters counts as a match). It retries with a pause and a per-request timeout and records the outcome in the manifest. Exit code 1 means it never matched.

### `release rollback [--dry-run]`

Switches `current` back to `previous`, makes the release you left `previous` (so a second rollback returns to it), and reruns the restart command. Migrations are **not** rolled back: a migration can drop or rewrite data that no reverse step restores, and the previous code usually runs against the newer schema. Undoing a schema change is its own decision, taken with the data in view (`warlock migrate --rollback`).

### `release list`, `release status`, `release prune --keep <n>`

`list` shows every release, newest first, marking `current` and `previous`. `status` shows the active release and the last entries of the log. `prune --keep <n> [--dry-run]` is the only command that deletes a release: it keeps the `n` newest plus whatever `current` and `previous` point to.

All subcommands accept `--json`. A failed step exits 1.

## What it writes

```text
.warlock/
  current -> releases/1.4.0-a1b2c3d
  previous -> releases/1.3.2-9f8e7d6
  release.log                      one JSON line per event
  releases/1.4.0-a1b2c3d/
    manifest.json                  identity, gate results, migration proof, activation, verification
    source/                        the frozen commit
    staged/                        what runs: dist, package.json, lockfile, release.json
```

Add `.warlock` to `.gitignore`. Point your process at `.warlock/current/staged` (for example `node .warlock/current/staged/dist/app.js`); because that path is a symlink, a restart picks up whichever release is current.

## In CI

```bash
npx warlock release candidate
npx warlock release gate
npx warlock release migrations --prove --target staging
npx warlock release stage
npx warlock release activate --preflight
npx warlock release activate
npx warlock release verify || npx warlock release rollback
```
