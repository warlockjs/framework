---
name: update-packages
description: 'Keep a project current with `warlock update` — bump every `@warlock.js/*` dependency in package.json to its latest published version (range operator preserved), then run the lockfile-detected package manager install. Also covers the `warlock dev` update notice and the `devServer.checkForUpdates` toggle. Triggers: `warlock update`, `--no-install`, `checkForUpdates`, `fetchLatestVersion`, `isNewerVersion`; "update warlock packages", "upgrade the framework", "is there a new warlock version", "update notice in the dev server", "bump @warlock.js/* to latest"; typical CLI `warlock update`. Skip: dev/build/start runtime — `@warlock.js/core/run-app/SKILL.md`; writing a custom command — `@warlock.js/core/write-cli-command/SKILL.md`; installing a NEW feature package (auth, mail, storage) — that is `warlock add`; releasing/publishing the framework — workspace release tooling, not this command.'
---

# Warlock — update the framework

`warlock update` upgrades a project's Warlock packages in one step, and `warlock dev` tells you when an upgrade is available. Because the whole `@warlock.js/*` family ships in **lockstep** — every package shares one version — keeping them in sync is the normal case, and this command does exactly that.

## `warlock update`

```bash
warlock update                  # bump every @warlock.js/* dep to latest, then install
warlock update --no-install     # rewrite package.json only; install yourself later
```

| Flag           | Type    | Purpose                                                                             |
| -------------- | ------- | ----------------------------------------------------------------------------------- |
| `--no-install` | boolean | Rewrite the versions in `package.json` without running the package manager install. |

What it does, in order:

1. Reads the project's root `package.json`.
2. Collects every `@warlock.js/*` package across `dependencies` and `devDependencies`. Only the `@warlock.js/` scope is considered — `create-warlock` and unrelated dependencies are never touched.
3. Looks up each package's latest version on the npm registry, in parallel.
4. Rewrites each matching spec, **preserving the range operator**: `^4.2.0` → `^4.3.0`, `~4.2.0` → `~4.3.0`, an exact `4.2.0` → `4.3.0`. Specs that are not a plain semver — `workspace:*`, `*`, `latest`, git/file URLs — are left exactly as written, and any package already at or ahead of latest is skipped.
5. Runs the project's install to reconcile `node_modules` — `npm install` / `yarn install` / `pnpm install`, chosen by the lockfile present (`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`, npm as the fallback). Skipped with `--no-install`.

Re-running on an already-current project is a no-op: nothing resolves as newer, so it prints "All @warlock.js packages are already up to date" and exits without writing or installing.

## The dev-server update notice

On start, `warlock dev` checks npm for a newer `@warlock.js/core` and prints a one-line notice when one exists:

```
  ⚡ A new version of Warlock.js is available  4.2.11 → 4.3.0
     Run  npx warlock update  to update all @warlock.js packages
     Changelog  https://warlock.js.org/changelog/
```

Core's version stands in for the whole family (lockstep), so a single lookup is enough. The check is **best-effort and non-blocking** — it runs fire-and-forget after the server is ready, never delays or breaks startup, and stays silent on any failure (offline, registry down, timeout).

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

- **Only the `@warlock.js/` scope is updated.** Mongez packages (`@mongez/*`), `create-warlock`, and everything else are left alone — update those with your package manager directly.
- **Non-semver specs are intentionally skipped.** A `workspace:*` or `*` dependency stays as written; `update` will not pin it to a concrete version.
- **The notice never blocks dev.** If npm is unreachable, `warlock dev` behaves exactly as before — no delay, no error.
- **`warlock update` is not `warlock add`.** `add` installs a *new* feature package and runs its setup hooks; `update` only bumps the versions of packages you already depend on.

## See also

- [`run-app/SKILL.md`](../run-app/SKILL.md) — `warlock dev` / `build` / `start` and the `devServer.*` config knobs.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — author your own `warlock <cmd>`.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `warlock.config.ts` shape and `defineConfig`.
