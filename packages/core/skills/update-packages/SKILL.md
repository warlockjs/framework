---
name: update-packages
description: 'Keep a project current with `warlock update` — bump every `@warlock.js/*` dependency in package.json to its latest published version (range operator preserved), then run the lockfile-detected package manager install. Also covers the `warlock dev` update notice, its `u` update-and-restart keyboard shortcut, and the `devServer.checkForUpdates` toggle. Triggers: `warlock update`, `--no-install`, `--dry-run`, `--check`, `checkForUpdates`, `fetchLatestVersion`, `isNewerVersion`; "update warlock packages", "upgrade the framework", "is there a new warlock version", "update notice in the dev server", "press u to update", "dev server keyboard shortcut", "update check offline", "bump @warlock.js/* to latest"; typical CLI `warlock update`. Skip: dev/build/start runtime — `@warlock.js/core/run-app/SKILL.md`; writing a custom command — `@warlock.js/core/write-cli-command/SKILL.md`; installing a NEW feature package (auth, mail, storage) — that is `warlock add`; releasing/publishing the framework — workspace release tooling, not this command.'
---

# Warlock — update the framework

`warlock update` upgrades a project's Warlock packages in one step, and `warlock dev` tells you when an upgrade is available. Because the whole `@warlock.js/*` family ships in **lockstep** — every package shares one version — keeping them in sync is the normal case, and this command does exactly that.

## `warlock update`

```bash
warlock update                  # bump every @warlock.js/* dep to latest, then install
warlock update --no-install     # rewrite package.json only; install yourself later
warlock update --dry-run        # show what would change; touch nothing
warlock update --check          # same, but exit 1 when behind — a CI gate
```

| Flag           | Type    | Purpose                                                                             |
| -------------- | ------- | ----------------------------------------------------------------------------------- |
| `--no-install` | boolean | Rewrite the versions in `package.json` without running the package manager install. |
| `--dry-run`    | boolean | Report which packages would be updated without writing package.json or installing.  |
| `--check`      | boolean | Like `--dry-run`, but **exits 1** when any package is behind.                       |

`--check` is the CI form — its exit code carries the answer:

| Exit | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Every `@warlock.js/*` package is current.                            |
| `1`  | At least one is behind (or the registry could not be reached).       |

Both flags imply a dry run, so neither ever writes to `package.json`.

What it does, in order:

1. Reads the project's root `package.json`.
2. Collects every `@warlock.js/*` package across `dependencies` and `devDependencies`. Only the `@warlock.js/` scope is considered — `create-warlock` and unrelated dependencies are never touched.
3. Looks up each package's latest version on the npm registry, in parallel.
4. Rewrites each matching spec, **preserving the range operator**: `^4.2.0` → `^4.3.0`, `~4.2.0` → `~4.3.0`, an exact `4.2.0` → `4.3.0`. Specs that are not a plain semver — `workspace:*`, `*`, `latest`, git/file URLs — are left exactly as written, and any package already at or ahead of latest is skipped.
5. Runs the project's install to reconcile `node_modules`, chosen by the lockfile present. Skipped with `--no-install`.

| Lockfile                        | Install         | Add (`warlock add`) |
| ------------------------------- | --------------- | ------------------- |
| `bun.lock` / `bun.lockb`        | `bun install`   | `bun add`           |
| `package-lock.json`             | `npm install`   | `npm install`       |
| `yarn.lock`                     | `yarn install`  | `yarn add`          |
| `pnpm-lock.yaml`                | `pnpm install`  | `pnpm add`          |
| *none*                          | `npm install`   | `npm install`       |

Bun is checked **first**: a Bun project may also carry a `yarn.lock` (Bun writes one for tooling compatibility), and matching yarn there would run the wrong installer against the wrong lockfile. `warlock update` and `warlock add` share this detection, so they can never disagree.

Re-running on an already-current project is a no-op: nothing resolves as newer, so it prints "All @warlock.js packages are already up to date" and exits without writing or installing.

**Offline is not "up to date".** If *every* registry lookup fails, the command says so and changes nothing:

```
⚠ Could not reach the npm registry — no versions were changed. Check your connection and try again.
```

If the install fails after the versions were rewritten, `package.json` keeps the new versions (re-run your package manager to finish) and the CLI exits non-zero.

## The dev-server update notice

On start, `warlock dev` checks npm for a newer `@warlock.js/core` and prints a one-line notice when one exists:

```
  ⚡ A new version of Warlock.js is available  4.8.2 → 4.9.0
     Press u to update all @warlock.js packages and restart
     Changelog  https://warlock.js.org/changelog/
```

Core's version stands in for the whole family (lockstep), so a single lookup is enough. The check is **best-effort and non-blocking** — it runs fire-and-forget after the server is ready, never delays or breaks startup, and stays silent on any failure (offline, registry down, timeout). Its abort budget is 5s, much shorter than the `warlock update` command's, so a hanging network leaves nothing behind.

**The answer is cached for 24 hours** in `.warlock/update-check.json`, so a normal day of dev-server restarts costs one registry lookup rather than one per boot. Three deliberate details: a **failed** lookup is never cached (one flaky moment must not silence the notice for a day), an entry stamped in the *future* is ignored (a clock that moves backwards would otherwise pin the cache as fresh forever), and the entry is **dropped** once `u` actually applies an update, so the next boot compares against the version you just installed.

### The `u` shortcut

Pressing `u` on that notice runs the whole upgrade without leaving the dev server:

1. The shortcut is disarmed and the terminal handed back, so the package manager owns stdin.
2. Every `@warlock.js/*` dependency is rewritten to latest and installed — exactly what `warlock update` does.
3. The worker shuts down (freeing the http port) and exits `75`; the `warlock dev` supervisor spawns a replacement on the new version. See [`run-app/SKILL.md`](../run-app/SKILL.md) for the supervisor.

What happens when it doesn't go to plan:

| Situation                     | Result                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Registry unreachable          | Nothing changes, the server keeps serving, and `u` is re-armed for a retry.   |
| Install failed                | `package.json` keeps the new versions; `u` is **not** re-armed — finish the install and restart by hand. |
| Restart could not be launched | The notice tells you to restart manually.                                     |

The shortcut is only offered when stdin is an interactive TTY. When it isn't (CI, piped stdin, a process supervisor), the notice falls back to the `Run npx warlock update` line instead — it never silently does nothing.

`u` joins the dev server's standing shortcut bar (`r` restart, `c` clear, `q` quit, `h` help) — press `h` to list whatever is armed. See [`run-app/SKILL.md`](../run-app/SKILL.md) for the bar and the raw-mode / `Ctrl+C` contract.

It is automatically skipped when:

- `process.env.CI` is set (CI runs),
- stdout is not a TTY (piped / non-interactive shells),
- `process.env.NO_UPDATE_NOTIFIER` is set, or
- `devServer.checkForUpdates` is `false`.

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    checkForUpdates: false, // silence the "update available" notice
  },
});
```

## Building blocks

Two small zero-dependency utilities back the tooling and are exported from `@warlock.js/core`:

- `fetchLatestVersion(name, timeoutMs?)` — the latest published version of an npm package, or `undefined` on any failure. Never throws.
- `isNewerVersion(latest, current)` — `true` when `latest` is a strictly newer semver than `current`. Compares `major.minor.patch` and orders a stable release above its prereleases.

## Gotchas

- **Bun projects are detected first.** A `bun.lock` or `bun.lockb` wins over any other lockfile in the same project.
- **Only the `@warlock.js/` scope is updated.** Mongez packages (`@mongez/*`), `create-warlock`, and everything else are left alone — update those with your package manager directly.
- **Non-semver specs are intentionally skipped.** A `workspace:*` or `*` dependency stays as written; `update` will not pin it to a concrete version.
- **The notice never blocks dev.** If npm is unreachable, `warlock dev` behaves exactly as before — no delay, no error, no notice, and no `u` shortcut.
- **`u` is not offered without a TTY.** Don't expect it in CI logs or piped output; the notice prints the command instead.
- **`warlock update` is not `warlock add`.** `add` installs a *new* feature package and runs its setup hooks; `update` only bumps the versions of packages you already depend on.

## See also

- [`run-app/SKILL.md`](../run-app/SKILL.md) — `warlock dev` / `build` / `start` and the `devServer.*` config knobs.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — author your own `warlock <cmd>`.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `warlock.config.ts` shape and `defineConfig`.
