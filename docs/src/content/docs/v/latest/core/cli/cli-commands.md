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
yarn warlock dev
yarn warlock migrate --fresh
yarn warlock generate.module products
```

Equivalent shortcuts your project may have configured:

```bash
yarn start         # → yarn warlock dev
yarn migrate       # → yarn warlock migrate
yarn build         # → yarn warlock build
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

On start, `warlock dev` also checks npm for a newer `@warlock.js/core` release and prints a one-line notice when one is available — run [`update`](#update) to upgrade. The check is best-effort and non-blocking: it never delays or breaks startup, and is automatically skipped in CI and non-interactive (non-TTY) shells. Turn it off with `devServer.checkForUpdates: false` in `warlock.config.ts`.

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
warlock migrate --list                   # show executed migrations only
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
| `--list, -l`        | boolean | List all *executed* migrations.                                                                          |
| `--all, -a`         | boolean | List *every* migration file in the app, executed or not.                                                 |
| `--sql, -s`         | boolean | Export migrations as phase-ordered SQL files instead of executing them.                                  |
| `--pending-only`    | boolean | With `--sql`, export only pending migrations. Otherwise exports all.                                     |
| `--compact, -c`     | boolean | With `--sql`, strips generated comments and blank lines.                                                 |

The minimal preload — only `database` and `logger` connectors — keeps migrations fast.

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

### `update`

Update every `@warlock.js/*` package in your project to its latest published version, then reinstall.

```bash
warlock update                  # bump all @warlock.js/* deps to latest, then install
warlock update --no-install     # rewrite package.json only; install yourself later
```

| Flag           | Type    | Description                                                                          |
| -------------- | ------- | ------------------------------------------------------------------------------------ |
| `--no-install` | boolean | Rewrite the versions in `package.json` without running the package manager install.  |

Scans `dependencies` and `devDependencies` for `@warlock.js/*` packages, looks up each one's latest version on npm, and rewrites the matching specs — **preserving each range operator** (`^`, `~`, or an exact pin). Non-semver specs (`workspace:*`, `*`, git/file URLs) are left untouched, and packages already at or ahead of latest are skipped. It then runs your project's install — `npm` / `yarn` / `pnpm`, auto-detected from the lockfile — to reconcile `node_modules`.

Because the whole `@warlock.js/*` family is versioned in lockstep, this keeps every framework package on the same release. The [`dev`](#dev) server surfaces a notice when a newer version is published, so you know when to run it.

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

Run it: `yarn warlock users.promote --email=hasan@example.com` (or `yarn warlock up -e hasan@example.com`).

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
