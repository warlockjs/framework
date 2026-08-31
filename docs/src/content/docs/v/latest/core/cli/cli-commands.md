---
title: "CLI commands"
description: Every built-in warlock command — dev, build, start, migrate, seed, add, update, generate.*, storage.put — what they do, what flags they take, and how to write your own.
sidebar:
  order: 1
  label: "CLI commands"
---

The `warlock` binary is the single entry point for everything you do at the terminal — dev server, production build, database operations, code generation, storage management. This page is the canonical reference for every shipped command, plus the recipe for adding your own.

Every command is a `CLICommand` instance produced by the `command()` factory. Built-ins, plugins from `@warlock.js/*` packages, and project-local commands all share the same shape. Knowing one is knowing all of them.

## Running commands

In a Warlock project, `warlock` is wired into `package.json` via `yarn`:

```bash
pnpm warlock dev
pnpm warlock migrate --fresh
pnpm warlock generate.module products
```

Equivalent shortcuts your project may have configured:

```bash
pnpm start         # → pnpm warlock dev
pnpm migrate       # → pnpm warlock migrate
pnpm build         # → pnpm warlock build
```

Look at the project's `package.json > scripts` to see the local shortcuts. Under the hood everything routes through the same CLI runner.

`warlock --help` prints all commands. `warlock <command> --help` prints flags for one. The `--help` / `-h` flags are reserved — you can't bind them yourself.

---

## Development

### `dev`

Start the development server with hot module reload, type generation, and health checkers.

```bash
warlock dev
warlock dev --fresh                  # clear the manifest before starting
warlock dev --skip-typings           # skip background type generation
warlock dev --skip-health            # skip health checkers
```

| Flag                  | Type      | Description                                                                    |
| --------------------- | --------- | ------------------------------------------------------------------------------ |
| `--fresh, -f`         | boolean   | Delete `.warlock/manifest.json` before starting (force full re-parse from disk). |
| `--skip-typings, -st` | boolean   | Skip background type generation for this run.                                  |
| `--skip-health, -sh`  | boolean   | Skip file health checkers for this run.                                        |

Persistent — the process stays alive until you Ctrl+C it. Boots the full app: env, all configs, every connector, then your modules. See [How it works](../architecture-concepts/how-it-works.md) for what's happening behind the scenes.

#### Keyboard shortcuts

Once the server is ready it listens for single keypresses — press `h` at any time to list the ones that are armed.

| Key      | Does                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| `r`      | Restart the server on a fresh process.                                                        |
| `c`      | Clear the console.                                                                            |
| `q`      | Graceful shutdown, exit `0` — the same path as `Ctrl+C`.                                       |
| `h`      | Print the shortcuts armed right now.                                                          |
| `u`      | Only while an update notice is showing — update every `@warlock.js/*` package and restart.     |
| `Ctrl+C` | Graceful shutdown, unchanged.                                                                 |

#### The supervisor

`warlock dev` runs as two processes: a thin **supervisor** that owns the terminal and loads nothing, and a **worker** that is the actual dev server.

```
shell
└─ warlock dev            ← supervisor
   └─ warlock dev         ← the server, replaced on every restart
```

A restart never re-launches the supervisor: the worker shuts down — freeing the http port — exits with a "restart me" code, and the supervisor spawns a replacement. The process tree stays exactly two deep however many restarts happen, and the supervisor mirrors the worker's exit code so `npm run dev` behaves normally.

`Ctrl+C` reaches the worker directly, so shutdown is unchanged. `SIGTERM` and `SIGHUP` are forwarded explicitly, since they don't propagate to the process group on Windows.

The supervisor also **recovers from crashes**. A worker that dies after running healthily for at least 5 seconds — out of memory, a native crash, a dead loader thread — is replaced automatically. One that dies sooner failed to *boot* and has already printed why, so it is left alone rather than having its error buried under a reprint. More than 3 crashes in a minute and the supervisor stops instead of restarting behind your back.

#### Restart on config change

`warlock.config.ts` and `.env*` are read at boot, so they can't be hot-reloaded — reloading would leave your running services on stale values. When one changes, the dev server restarts itself:

```
14:22:07 warlock.config.ts changed — restarting to apply.
```

Set `devServer.restartOnConfigChange: false` to get a warning instead and restart by hand.

Reading one key at a time needs stdin in raw mode, which takes `Ctrl+C` away from the terminal driver. The dev server re-raises `SIGINT` itself, and always leaves raw mode on shutdown, so your shell is never left without line editing. Shortcuts are only armed on an interactive terminal — with piped stdin, in CI, or under a process supervisor, stdin is never touched.

#### The update notice

On start, `warlock dev` also checks npm for a newer `@warlock.js/core` release and prints a one-line notice when one is available:

```
  ⚡ A new version of Warlock.js is available  4.8.2 → 4.9.0
     Press u to update all @warlock.js packages and restart
     Changelog  https://warlock.js.org/changelog/
```

Press **`u`** and the dev server does the whole upgrade for you: it rewrites every `@warlock.js/*` dependency to latest, runs your package manager install, then shuts down and relaunches itself on the new version. If the registry can't be reached, nothing changes and `u` stays available to retry; if the install fails, `package.json` keeps the new versions and you finish it by hand.

The shortcut needs an interactive terminal. Without one (CI, piped stdin, a process supervisor) the notice prints `Run npx warlock update` instead — see [`update`](#update).

The check itself is best-effort and non-blocking: it never delays or breaks startup, stays silent when npm is unreachable, and is automatically skipped in CI and non-interactive (non-TTY) shells. The answer is cached for 24 hours in `.warlock/update-check.json`, so a day of restarts costs one lookup — failed lookups are never cached, and the entry is dropped once an update is applied. Turn the whole thing off with `devServer.checkForUpdates: false` in `warlock.config.ts`.

### `generate.typings`

Regenerate the TypeScript ambient types in `.warlock/typings/` from your config files.

```bash
warlock generate.typings
warlock generate.typings --files src/config/database.ts,src/config/storage.ts
```

| Flag           | Type    | Description                                                                                  |
| -------------- | ------- | -------------------------------------------------------------------------------------------- |
| `--files, -f`  | string  | Comma-separated list of files to generate typings for. Omit to regenerate everything.        |

The dev server runs this automatically on every boot (unless `--skip-typings`). You'd run it manually after editing a config file in a fresh checkout or when the IDE's autocomplete is lying to you.

---

## Production

### `build`

Bundle the application for production. Reads `warlock.config.ts > build` for esbuild options.

```bash
warlock build
```

No flags. Output lands in `dist/` (or wherever `warlock.config.ts > build.outDir` points). See [How it works](../architecture-concepts/how-it-works.md) for the bundler story.

### `start`

Start the production server from the build output.

```bash
warlock start
```

Persistent. Reads `warlock.config.ts` to resolve the entry path and source-map flag, then `spawn`s `node` with the right arguments. Forwards `SIGTERM` / `SIGINT` to the child cleanly — Ctrl+C does what you expect.

The started banner goes to stdout **only after the running app reports a completed boot**; progress goes to stderr. A boot that fails prints to both streams and exits non-zero, even if the child process exited `0` — so `warlock start | grep -q "production server started"` is a sound health gate. See [Deployment](../digging-deeper/deployment) for the readiness contract.

Build first, then start:

```bash
warlock build && warlock start
```

---

## Database

### `migrate`

Run database migrations. Without flags, runs all pending migrations.

```bash
warlock migrate
warlock migrate --fresh                  # drop all tables, run from scratch
warlock migrate --rollback               # roll everything back
warlock migrate --list                   # migration state: executed, then what's next
warlock migrate --pending                # only what will run next, in execution order
warlock migrate --all                    # show all migration files in the app
warlock migrate --sql --pending-only     # export pending migrations as SQL files
warlock migrate --sql --compact          # ...minus comments and blank lines
warlock migrate --path src/app/orders/models/order/migrations
```

| Flag                | Type    | Description                                                                                              |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `--fresh, -f`       | boolean | Drop all tables and re-run migrations from scratch.                                                      |
| `--rollback, -r`    | boolean | Roll back migrations, dropping all tables.                                                               |
| `--path, -p`        | string  | Path to a specific migration file or folder. Defaults to running all.                                    |
| `--list, -l`        | boolean | Migration state: executed migrations, then what will run next.                                           |
| `--pending`         | boolean | Only what will run next, in execution order. Sets an exit code — see below.                              |
| `--all, -a`         | boolean | List *every* migration file in the app, executed or not.                                                 |
| `--sql, -s`         | boolean | Export migrations as phase-ordered SQL files instead of executing them.                                  |
| `--pending-only`    | boolean | With `--sql`, export only pending migrations. Otherwise exports all.                                     |
| `--compact, -c`     | boolean | With `--sql`, strips generated comments and blank lines.                                                 |

The minimal preload — only `database` and `logger` connectors — keeps migrations fast.

#### Checking what will run next

Before applying a schema change to a database other people are using, the question is *what is about to run* — not what already has.

```bash
warlock migrate --list
```

```
Total Executed Migrations: 22

  ✔ accessToken
    Executed: 03-08-2026 11:04:19 PM
  …

Total Pending Migrations: 1

  1. 08-10-2026_create_media
```

The pending block is printed **in execution order**, so it reads as a dry run rather than a set.

:::caution[Don't derive the pending set by hand]
Differencing `--all` against `--list` gives the wrong answer, and it errs towards *"safe to proceed"*.

`--all` lists files under `src/app`. `--list` reads the migrations table, which **also** contains migrations registered by packages through `database.migrations` — `@warlock.js/auth` contributes two. The two outputs are drawn from different populations, so the difference under-counts what is pending. Use `--list` or `--pending`; neither has that problem.
:::

#### Gating a deploy on `--pending`

`--list` is a report and always exits `0`. `--pending` is a gate:

| Exit code | Meaning                                     |
| --------- | ------------------------------------------- |
| `0`       | Computed, and **nothing** is pending.       |
| `1`       | Computed, and at least one migration is pending. |
| `2`       | **Could not be computed.**                  |

```bash
warlock migrate --pending && ./deploy.sh   # deploys only when nothing is outstanding
```

`2` exists because "three migrations are waiting" and "I could not work out what is waiting" need opposite responses — run them, versus stop and look. A single non-zero code would make them indistinguishable to a script.

Computing the pending set means loading your migration files, and a file missing its default export throws. When that happens the executed listing is still printed in full, followed by an explicit line:

```
Pending: unavailable — src/app/media/migrations/broken.ts must have a default export
  The executed list above is still accurate.
```

It never reports `0` pending in that case. An empty pending list means *nothing is pending*, and nothing else.

### `seed`

Run database seeds.

```bash
warlock seed
warlock seed --fresh             # drop all rows first
warlock seed --list              # show the order without running
warlock seed --transaction       # run inside a transaction (default: true)
```

| Flag                  | Type      | Default | Description                                                          |
| --------------------- | --------- | ------- | -------------------------------------------------------------------- |
| `--fresh, -f`         | boolean   |         | Drop all rows from all tables before seeding.                        |
| `--list, -l`          | boolean   |         | Print the seed execution order without running.                      |
| `--transaction, -t`   | boolean   | `true`  | Run all seeds inside a single transaction.                           |

Full `bootstrap: true` — seeds touch app models, so the whole app initializes. Slower than `migrate`; that's the price for being able to use model classes in your seed files.

Authoring seed files — the `seeder()` factory, the `{ track, now, batchSize }` run context, `dependsOn` ordering, and undoing a seed — is covered in the [Seeding guide](../digging-deeper/seeding.md).

### `create-database <name>`

Create a new database on the configured connection.

```bash
warlock create-database my_app
warlock create-database my_app --connection secondary
warlock cdb my_app                          # alias
```

| Positional | Description                              |
| ---------- | ---------------------------------------- |
| `<name>`   | The database name to create. Required.   |

| Flag                | Default      | Description                                                       |
| ------------------- | ------------ | ----------------------------------------------------------------- |
| `--connection, -c`  | `"default"`  | Database connection name as defined in `src/config/database.ts`.  |

The connector layer takes care of MongoDB vs Postgres — your config decides; the command runs against whichever you've wired.

### `drop.tables`

Drop every table in the database. Yes, every one. Use carefully.

```bash
warlock drop.tables
warlock drop.tables --force            # skip confirmation
```

| Flag           | Description                            |
| -------------- | -------------------------------------- |
| `--force, -f`  | Skip the confirmation prompt.          |

Without `--force`, the command prompts before deleting anything. Pairs naturally with `migrate --fresh` if you want a complete reset.

---

## Installation and packages

### `add <features...>`

Install one or more Warlock feature packages and run their setup.

```bash
warlock add auth
warlock add auth mail storage
warlock add --list                           # see what's available
warlock add auth --package-manager yarn
warlock add auth --no-install                # record deps, run setup, skip the install
```

| Positional      | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| `<features...>` | One or more feature names. Required unless using `--list`.        |

| Flag                       | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `--package-manager`        | Package manager to use (auto-detected if omitted).                       |
| `--list, -l`               | List every available feature.                                            |
| `--no-install`             | Record the dependencies in `package.json` and run the setup (eject configs, add scripts, run setup hooks) without invoking the package manager install. Pass it last, after the feature list. Used by scaffolders that run a single install afterwards. |

The command installs the npm package(s), runs their post-install hooks (configuration files, migrations, etc.), and updates your `warlock.config.ts` where needed.

#### AI features

The AI toolkit is split across a core package, provider packages, and capability satellites — each a separate `add` feature:

| Feature | Installs | Notes |
| ------- | -------- | ----- |
| `ai` | `@warlock.js/ai` | Core toolkit (agents, tools, workflows). **Ejects `src/config/ai.ts`** — see below. Required by every other AI feature. |
| `ai-openai` | `@warlock.js/ai-openai` | OpenAI provider. |
| `ai-google` | `@warlock.js/ai-google` | Google (Gemini) provider. |
| `ai-anthropic` | `@warlock.js/ai-anthropic` | Anthropic (Claude) provider. |
| `ai-bedrock` | `@warlock.js/ai-bedrock` | AWS Bedrock provider. |
| `ai-ollama` | `@warlock.js/ai-ollama` | Ollama provider. |
| `ai-tools` | `@warlock.js/ai-tools` | Ready-made agent tools + MCP client/server (`ai.tools.*`, `ai.mcp`). |
| `ai-panoptic` | `@warlock.js/ai-panoptic` | Observability — collector, exporters, local dashboard, via `ai.config({ panoptic })`. |
| `ai-workspace` | `@warlock.js/ai-workspace` | Policy-jailed filesystem + shell workspace (`ai.workspace`). |

Every AI feature `requires: ["ai"]`, so adding any one pulls in the core package automatically:

```bash
warlock add ai                          # core only — ejects src/config/ai.ts
warlock add ai-openai ai-tools          # core + OpenAI provider + tools (one install)
```

**`warlock add ai` ejects `src/config/ai.ts`.** The ejected file exports a declarative `Partial<AIConfig>` (default cache store, panoptic options) — the [`ai` connector](../architecture-concepts/connectors.md#the-built-in-catalog) applies it on boot via `ai.config(...)`, so core never hard-depends on `@warlock.js/ai`. The top of the file carries an auto-managed marker block:

```ts title="src/config/ai.ts"
import type { AIConfig } from "@warlock.js/ai";

// >>> warlock:ai-packages (auto-managed) >>>
// <<< warlock:ai-packages <<<

const ai: Partial<AIConfig> = {
  // defaultStore, panoptic, …
};

export default ai;
```

The satellite features (`ai-tools`, `ai-panoptic`, `ai-workspace`) link their **side-effect import** into that block when installed — for example `warlock add ai-workspace` inserts `import "@warlock.js/ai-workspace";` after the marker. Keeping those imports at the top of `config/ai.ts` guarantees each satellite has registered its surface on the `ai` object (`ai.tools`, `ai.workspace`, panoptic's wiring) **before** the `ai` connector runs `ai.config(...)`. The insert is idempotent — re-running `add` for an already-linked satellite is a no-op.

These same features are offered in the AI step of [`create-warlock`](https://www.npmjs.com/package/@warlock.js/create-warlock) when scaffolding a new app.

### `update`

Update every `@warlock.js/*` package in your project to its latest published version, then reinstall.

```bash
warlock update                  # bump all @warlock.js/* deps to latest, then install
warlock update --no-install     # rewrite package.json only; install yourself later
warlock update --dry-run        # show what would change; touch nothing
warlock update --check          # same, but exit 1 when behind — a CI gate
```

| Flag           | Type    | Description                                                                          |
| -------------- | ------- | ------------------------------------------------------------------------------------ |
| `--no-install` | boolean | Rewrite the versions in `package.json` without running the package manager install.  |
| `--dry-run`    | boolean | Report which packages would be updated without writing `package.json` or installing. |
| `--check`      | boolean | Like `--dry-run`, but exits `1` when any package is behind.                           |

`--check` is the CI form: exit `0` means every `@warlock.js/*` package is current, exit `1` means at least one is behind (or the registry couldn't be reached). Both flags imply a dry run, so neither ever writes to `package.json`.

Scans `dependencies` and `devDependencies` for `@warlock.js/*` packages, looks up each one's latest version on npm, and rewrites the matching specs — **preserving each range operator** (`^`, `~`, or an exact pin). Non-semver specs (`workspace:*`, `*`, git/file URLs) are left untouched, and packages already at or ahead of latest are skipped. It then runs your project's install — `bun` / `npm` / `yarn` / `pnpm`, auto-detected from the lockfile — to reconcile `node_modules`.

Bun is checked first: a Bun project may also carry a `yarn.lock` (Bun writes one for tooling compatibility), and matching yarn there would run the wrong installer. [`add`](#add) shares the same detection.

Because the whole `@warlock.js/*` family is versioned in lockstep, this keeps every framework package on the same release. The [`dev`](#dev) server surfaces a notice when a newer version is published — and lets you apply it with a single `u` keypress — so you rarely need to run this by hand.

Offline runs are honest about it: if none of the registry lookups answer, the command reports that npm was unreachable and changes nothing, rather than claiming everything is up to date. If the install fails after the versions were rewritten, `package.json` keeps them (re-run your package manager to finish) and the command exits non-zero.

---

## Storage

### `storage.put <localPath> [destination]`

Upload a local file or directory to any configured storage driver.

```bash
warlock storage.put ./public/logo.png assets/logo.png
warlock storage.put ./uploads --driver r2                       # whole directory
warlock storage.put ./uploads backups/2026 --driver r2 -c 10    # under a prefix
warlock sput ./public/logo.png assets/logo.png                  # alias
```

| Positional       | Description                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `<localPath>`    | The local file or directory to upload. Required.                                             |
| `[destination]`  | Destination path/prefix. Optional — defaults to the file's basename for files.               |

| Flag                  | Type    | Default                              | Description                                                                          |
| --------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `--driver, -d`        | string  | configured default                   | Storage driver name as defined in `src/config/storage.ts`.                           |
| `--concurrency, -c`   | number  | `5`                                  | Number of concurrent uploads when uploading a directory.                             |

Auto-detects file vs. directory. Files are streamed (no full-buffer-in-memory), so you can upload large assets without blowing the heap. Built for the "migrate from local storage to S3/R2" workflow.

---

## Diagnostics

### `doctor`

Run a set of read-only health checks (routes, config, connectors, optional peers, health endpoints, release hygiene) and print a pass/warn/fail report. Exits non-zero when any check fails.

```bash
warlock doctor
```

No flags. Bootstraps app code so routes and connectors are registered for introspection, but starts no connectors — it never opens a database/cache/socket connection. The full check list, statuses, exit-code semantics, and CI usage are in the [`warlock doctor` guide](./doctor.md).

### `routes`

List the registered HTTP routes as a verb-colored table — method, path, name, controller action, middleware count, and source file. Read-only and connector-free, like `doctor`.

```bash
warlock routes                 # the table
warlock routes --method GET    # filter by verb
warlock routes --path /users   # filter by path substring
warlock routes --name users    # filter by route-name substring
warlock routes --json          # machine-readable rows (pipe to jq / CI)
```

Bootstraps app code so route modules register, but starts no connectors. Because the route-module loader is fail-loud, a route file that throws on import surfaces here instead of being silently dropped. Full output, filters, and JSON shape are in the [`warlock routes` guide](./routes.md).

### `routes:diff`

Bootstrap the current app diagnostically (without starting connectors) and
compare its page routes against the page-route manifest the last successful
`warlock build` wrote. Exits non-zero on drift — a CI gate
against shipping a page renamed or route-changed in dev without a rebuild.

```bash
warlock routes:diff
```

Requires a prior `warlock build`. See the [`routes:diff` section](./routes.md#warlock-routesdiff) for the output shape and comparison rules.

---

## Generators

The whole `generate.*` family lives in [Generators](./generators.md) — that page covers what each one produces, naming transformations, and best practices. The quick reference:

| Command                                          | Alias        | What it generates                                                  |
| ------------------------------------------------ | ------------ | ------------------------------------------------------------------ |
| `generate <generator> [args...]`                 | `g`          | Master dispatch — `warlock g module products`.                     |
| `generate.module <name>`                         | `gen.m`      | A new module folder with the standard subfolders.                  |
| `generate.controller <module>/<name>`            | `gen.c`      | A controller, optionally with a validation schema (`--with-validation`). |
| `generate.service <module>/<name>`               | `gen.s`      | A service.                                                         |
| `generate.model <module>/<name>`                 | `gen.md`     | A Cascade model with its migration file.                           |
| `generate.repository <module>/<name>`            | `gen.r`      | A `RepositoryManager` subclass.                                    |
| `generate.resource <module>/<name>`              | `gen.rs`     | A `Resource` subclass.                                             |
| `generate.migration <model-path>`                | `gen.mig`    | A migration file with add/drop/rename DSL support.                 |

See [Generators](./generators.md) for the full surface.

---

## Writing your own command

Three places to surface a custom CLI:

1. **Project-local** — drop `<name>.command.ts` under `src/app/<module>/commands/`. Auto-discovered.
2. **Package-exported** — your package exports `registerXCommand()`; the consuming project lists it under `warlock.config.ts > cli.commands`.
3. **Framework** — built into `@warlock.js/core`. You don't write these.

### The factory

```ts title="src/app/users/commands/promote-admin.command.ts"
import { command } from "@warlock.js/core";

export default command({
  name: "users.promote",
  description: "Promote a user to admin by email",
  alias: "up",
  preload: {
    env: true,
    config: ["database"],
    connectors: ["database", "logger"],
  },
  options: [
    {
      text: "--email, -e",
      description: "User email address",
      required: true,
    },
  ],
  action: async ({ options }) => {
    console.log(`Promoting ${options.email}…`);
    // …business work using framework services
  },
});
```

Run it: `pnpm warlock users.promote --email=hasan@example.com` (or `pnpm warlock up -e hasan@example.com`).

Two rules for project-local commands:

- **Default-export** the result of `command(...)`. The discovery loader does `(await import(path)).default`.
- **Don't put logic at module top level.** The file gets imported during scans (and again at execution time). Anything outside `action`/`preAction` runs at scan time, possibly before any config or env is loaded.

### `CLICommandOptions`

| Field         | Type                            | Required | Notes                                                                                          |
| ------------- | ------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `name`        | `string`                        | yes      | Dot notation OK (`db.seed`, `jwt.generate`). May include positional placeholders (`name <arg>`). |
| `description` | `string`                        |          | Shown in help output.                                                                          |
| `alias`       | `string`                        |          | Short name (`m` for `migrate`).                                                                |
| `preload`     | `CLICommandPreload`             |          | What subsystems to load before `action`. See below.                                            |
| `persistent`  | `boolean`                       |          | `true` for long-running commands. Skips the auto-exit.                                         |
| `preAction`   | `(data) => void \| Promise`     |          | Runs **before** preloaders — banner, input validation.                                         |
| `action`      | `(data) => void \| Promise`     | yes      | Runs after preloaders. `data` is `{ args, options }`.                                          |
| `options`     | `CLICommandOption[]`            |          | Flag definitions.                                                                              |

### Options — the flag shape

```ts
{
  text: "--fresh, -f",            // "--key", "-k", "--key, -k", or "-k, --key"
  description: "Drop tables first",
  type: "boolean",                // "string" (default) | "boolean" | "number"
  defaultValue: false,            // applied if flag missing
  required: false,                // 1 missing required → command refuses to run
}
```

The parser auto-extracts `name` (long form, camelCased) and `alias` (short form) from `text`. Inside `action`, read via `options.fresh` — kebab-case becomes camelCase (`--no-cache` → `options.noCache`).

### Preload — lazy-loaded subsystems

Commands run with a minimal world by default. Opt in to what you need so the command stays fast:

```ts
preload: {
  env: true,                              // load .env
  config: ["database", "log"],            // load these src/config/*.ts files (or `true` for all)
  bootstrap: true,                        // full bootstrap (env + app + prestart hooks)
  connectors: ["database", "cache"],      // start these connectors (or `true` for all early-phase)
  prestart: true,                         // run src/app/prestart.ts after config
  warlockConfig: true,                    // load warlock.config.ts
  runtimeStrategy: "production",          // force-set
  environemnt: "production",              // force-set (note: original typo preserved in the API)
}
```

Connector names: `"logger"`, `"mailer"`, `"http"`, `"database"`, `"herald"`, `"cache"`, `"storage"`, `"socket"`, `"notifications"`, `"access"`. Pass `connectors: true` to start every Early-phase connector. The `http` and `socket` connectors are Late phase and stay off unless you explicitly list them.

Picking the right preload matters: `migrate` only needs database and logger; `seed` needs the full bootstrap because seeds use app models. Inspect the built-in commands' source on GitHub for canonical pairings.

### Inside `action` — `CommandActionData`

```ts
action: async ({ args, options }) => {
  // args:    positional, e.g. `warlock storage.put ./uploads backups/` → ["./uploads", "backups/"]
  // options: flags, e.g. `--driver=r2 --concurrency=5` → { driver: "r2", concurrency: 5 }
};
```

For positional capture in `name`, declare slots: `name: "storage.put <localPath> [destination]"` — `<>` required, `[]` optional. Slots are documentation/help-output; the registered command name is always the first whitespace-separated token.

### Package-exported commands

The convention for external packages is a **factory function** that returns a fresh `CLICommand`:

```ts title="A package-exported command factory"
import { command } from "@warlock.js/core";
import { generateJWTSecret } from "../services/generate-jwt-secret";

export function registerJWTSecretGeneratorCommand() {
  return command({
    name: "jwt.generate",
    description: "Generate a JWT secret key in .env",
    action: generateJWTSecret,
  });
}
```

Wire it in the project's `warlock.config.ts`:

```ts title="warlock.config.ts"
import {
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  cli: {
    commands: [
      registerJWTSecretGeneratorCommand(),
      registerAuthCleanupCommand(),
    ],
  },
});
```

Why a factory and not the instance directly? Two reasons. It defers side effects (config loading, import work) until the command is wired in. And each project decides which commands it wants — listing the factory is opt-in.

### Output and exit codes

By default, the framework prints `Executing <name>…`, runs your `action`, prints `Done in <ms>ms`, and `process.exit(0)`. Throwing exits with `1` and prints the error. If `persistent: true`, the framework keeps the process alive — no auto-exit on success; errors are logged but don't crash.

For colored output, use the `colors` helper re-exported from `@warlock.js/core`:

```ts
import { colors } from "@warlock.js/core";

console.log(colors.green("[OK]") + " user promoted");
console.log(colors.red("[!]")  + " something went wrong");
```

### Gotchas

- **Connectors are not free.** `connectors: true` boots the database, cache, storage, etc. For a print-version-and-exit command, leave `preload` undefined.
- **Required options block execution.** If `required: true` and the user omits the flag, the framework prints `Missing required options:` and exits `1` before `action` runs.
- **Aliases must be unique.** The first registration wins; later collisions silently overwrite. If your alias mysteriously runs the wrong command, check for a project-local override of a framework alias.
- **`name` with positional slots is documentation.** `name: "storage.put <localPath>"` registers as `storage.put` — the slot is for help output only.
- **`--help` is reserved.** Don't try to bind it. The framework intercepts it.

## Going further

- [`guides/generators.md`](./generators.md) — the `generate.*` family in depth.
- [`guides/warlock-config.md`](../architecture-concepts/warlock-config.md) — wiring package-exported commands via `cli.commands: [...]`.
- [`guides/bootstrap-and-connectors.md`](../architecture-concepts/bootstrap-and-connectors.md) — what `preload.bootstrap` and `preload.connectors` actually do.
