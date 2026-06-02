---
name: write-cli-command
description: 'Author a custom `warlock <my-cmd>` command via the `command()` factory — name, description, action, options, preload, then register in `warlock.config.ts > cli.commands` or drop in `src/app/<module>/commands/`. Triggers: `command`, `CLICommand`, `CLICommandPreload`, `CLICommandOption`, `preload`, `preAction`, `persistent`, `colors`; "write a custom warlock command", "one-off maintenance task", "ship a CLI from a package", "framework built-in commands"; typical import `import { command } from "@warlock.js/core"`. Skip: framework dev/build/start — `@warlock.js/core/run-app/SKILL.md`; warlock.config.ts wiring — `@warlock.js/core/configure-app/SKILL.md`; competing libs `commander`, `yargs`, `oclif`.'
---

# Warlock — write a CLI command

A Warlock CLI command is a `CLICommand` instance produced by the `command()` factory. Three ways to surface it:

1. **Project commands** — drop a `<name>.command.ts` file under `src/app/<module>/commands/` with the `CLICommand` as the default export. Auto-discovered.
2. **Plugin commands** — exposed as a factory function (`registerXCommand()`) from a package, registered via `warlock.config.ts > cli.commands: [...]`.
3. **Framework commands** — `migrate`, `seed`, `dev`, `build`, `generate.*`, `storage.put`, `drop.tables`, etc. Built into core. You don't write these; you copy their shape.

## The shape

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
    // …business work using framework services
    console.log(`Promoting ${options.email}…`);
  },
});
```

Run it: `yarn warlock users.promote --email=hasan@example.com` (or `yarn warlock up -e hasan@example.com`).

## `CLICommandOptions` — the factory input

| Field         | Type                          | Required | Notes                                                                                          |
| ------------- | ----------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `name`        | `string`                      | yes      | Dot notation OK (`db.seed`, `jwt.generate`). May include positional placeholders (`name <arg>`). |
| `description` | `string`                      |          | Shown in `warlock --help` and `warlock <cmd> --help`.                                          |
| `alias`       | `string`                      |          | Short name (`m` for `migrate`).                                                                |
| `action`      | `(data) => void \| Promise`   | yes      | Runs after preloaders. `data` is `{ args, options }`.                                          |
| `preAction`   | `(data) => void \| Promise`   |          | Runs **before** preloaders — banner, input validation.                                         |
| `preload`     | `CLICommandPreload`           |          | What to load before `action` runs. See below.                                                  |
| `persistent`  | `boolean`                     |          | `true` for long-running commands (dev server). Skips the auto-exit.                            |
| `options`     | `CLICommandOption[]`          |          | Flag definitions. See below.                                                                   |

## Options — flag shape

Each entry in the `options` array:

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

`--help`/`-h` are reserved — the framework intercepts them to print per-command help.

## Preload — lazy-loaded subsystems

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
  environemnt: "production",              // force-set (note: original typo preserved)
}
```

Connector names: `"logger"`, `"mailer"`, `"http"`, `"database"`, `"cache"`, `"storage"`, `"communicator"` (herald), `"socket"`. Pass `connectors: true` to start every `Early`-phase connector — `http` and `socket` are `Late` phase and stay off unless you list them explicitly.

Picking the right preload matters: `migrate` only needs database + logger, but `seed` runs full `bootstrap: true` because seeds touch app models. Inspect `@warlock.js/core/src/cli/commands/*.ts` for canonical pairings.

## Inside `action` — `CommandActionData`

```ts
action: async ({ args, options }) => {
  // args: positional, e.g. `warlock storage.put ./uploads backups/` → args = ["./uploads", "backups/"]
  // options: flags, e.g. `--driver=r2 --concurrency=5` → { driver: "r2", concurrency: "5" }
};
```

For positional capture in `name`, declare slots: `name: "storage.put <localPath> [destination]"` — `<>` required, `[]` optional. Storage-put uses this exact pattern.

## Registering external-package commands

The convention is to export a **factory function** that returns a fresh `CLICommand`. Why a factory and not the instance directly? It defers any side-effects (like loading config) to when the command is actually wired into the CLI, and it keeps each project free to skip commands it doesn't want.

```ts title="@warlock.js/auth/src/commands/jwt-secret-generator-command.ts"
import { command } from "@warlock.js/core";
import { generateJWTSecret } from "../services/generate-jwt-secret";

export function registerJWTSecretGeneratorCommand() {
  return command({
    name: "jwt.generate",
    description: "Generate JWT Secret key in .env file",
    action: generateJWTSecret,
  });
}
```

Wire it in the project's `warlock.config.ts`:

```ts title="warlock.config.ts"
import { registerJWTSecretGeneratorCommand } from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  cli: {
    commands: [registerJWTSecretGeneratorCommand()],
  },
});
```

## Output and exit codes

By default, the framework prints `Executing <name>…`, runs your `action`, then prints `Done in <ms>ms` and `process.exit(0)`. Throwing exits with `1` and prints the error. If `persistent: true`, the framework keeps the process alive (no auto-exit on success; errors are logged but don't crash).

For colored output, the canonical helper is `colors` from `@mongez/copper` (re-exported from `@warlock.js/core`):

```ts
import { colors } from "@warlock.js/core";

console.log(colors.green("✓") + " user promoted");
```

## Built-in framework commands

The framework ships a fixed set of commands you call but don't author. Knowing their flags up front saves a `--help` round-trip.

> For `warlock dev` / `warlock build` / `warlock start` — see [`run-app/SKILL.md`](../run-app/SKILL.md). Everything below covers the rest.

### Database + migrations

| Command  | Flags / args                                    | Preloads                       |
| -------- | ----------------------------------------------- | ------------------------------ |
| `warlock migrate` | `--list` (just list pending), `--fresh` / `-f` (drop tables first) | database, logger          |
| `warlock seed` | `--name <pattern>` (run seeds matching the pattern) | full bootstrap (env, configs, app modules) |
| `warlock create-database <name>` | bare positional `<name>`        | database                       |
| `warlock drop.tables` | `--force, -f` (skip confirmation prompt) | database, logger          |
| `warlock db.indexes` | builds DB indexes for every registered model    | database                  |

### Scaffolding

The `generate.*` family covers every module piece:

```
warlock generate.module <name>           (alias: gen.m)  — flags: --minimal, --force
warlock generate.controller <m>/<n>      (alias: gen.c)  — flags: --with-validation, --force
warlock generate.service <m>/<n>         (alias: gen.s)
warlock generate.model <m>/<n>           (alias: gen.md) — flags: --with-resource, --table <name>, --timestamps
warlock generate.repository <m>/<n>      (alias: gen.r)
warlock generate.resource <m>/<n>        (alias: gen.rs)
warlock generate.migration <model-path>  (alias: gen.mig)
warlock generate.typings
warlock generate                         (alias: g)      — interactive picker
```

`<m>/<n>` is `<module>/<name>` (e.g. `products/create-product`). See [`create-module/SKILL.md`](../create-module/SKILL.md) for the full scaffolding flow.

### Feature installation

`warlock add <features...>` installs framework-adjacent features through a curated registry — bundles npm dependencies + scaffold files + tsconfig patches + package.json scripts in one call. Featured names (from `add-command.action.ts`):

| Feature       | Installs                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `react-email` | `react-email` + `@react-email/components` + `@react-email/render` + `@react-email/tailwind`; drops a `welcome-email.tsx` sample; patches `tsconfig.json` |
| `react`       | `react` + `react-dom` + types                                                                       |
| `image`       | `sharp` (for the `Image` class)                                                                     |
| `mail`        | `nodemailer` + types                                                                                |
| `ses`         | `@aws-sdk/client-sesv2`                                                                             |
| `mongodb`     | `mongodb` driver                                                                                    |
| `postgres`    | `pg`                                                                                                |
| `mysql`       | `mysql2`                                                                                            |
| `redis`       | `redis`                                                                                             |
| `s3`          | `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` + `@aws-sdk/s3-request-presigner`                     |
| `scheduler`   | `@warlock.js/scheduler`                                                                             |
| `swagger`     | `@warlock.js/swagger`                                                                               |
| `postman`     | `@warlock.js/postman`                                                                               |
| `herald`      | `@warlock.js/herald` + `amqplib` + types; ejects `src/config/communicator.ts`                       |
| `test`        | `vitest` + `@mongez/vite` + coverage; drops `test-global-setup.ts` / `test-setup.ts` / `vite.config.ts` |

Run `warlock add --list` to see what's currently registered. Pass `--packageManager <yarn\|pnpm\|npm>` to override auto-detection (defaults to whichever lockfile is present).

### Misc

| Command  | Purpose                                                     |
| -------- | ----------------------------------------------------------- |
| `warlock storage.put <localPath> [destination]` | Upload a local file to the default storage disk |
| `warlock jwt.generate` | Generate a JWT secret in `.env` (from `@warlock.js/auth`)            |

## Common patterns

### Single-shot maintenance task

```ts title="src/app/orders/commands/recompute-totals.command.ts"
import { command } from "@warlock.js/core";
import { recomputeAllOrderTotals } from "../services/recompute-all-order-totals.service";

export default command({
  name: "orders.recompute",
  description: "Recompute totals for all orders",
  preload: {
    env: true,
    bootstrap: true,
    connectors: ["database", "logger"],
  },
  action: async () => {
    const count = await recomputeAllOrderTotals();
    console.log(`Recomputed ${count} orders`);
  },
});
```

### Stats report

```ts
export default command({
  name: "stats.report",
  description: "Print daily stats to stdout",
  preload: { env: true, config: ["database"], connectors: ["database"] },
  options: [
    { text: "--from, -f", description: "Start date (YYYY-MM-DD)" },
    { text: "--to, -t", description: "End date (YYYY-MM-DD)" },
  ],
  action: async ({ options }) => {
    const stats = await buildReport(options.from as string, options.to as string);
    console.table(stats);
  },
});
```

### Confirm-before-destroy

```ts
export default command({
  name: "users.purge",
  description: "Hard-delete soft-deleted users older than 90 days",
  options: [{ text: "--force, -f", description: "Skip confirmation", type: "boolean" }],
  preAction: async ({ options }) => {
    if (!options.force) {
      throw new Error("Refusing to run without --force");
    }
  },
  preload: { env: true, bootstrap: true, connectors: ["database", "logger"] },
  action: async () => {
    await purgeStaleSoftDeletedUsers();
  },
});
```

`preAction` runs *before* preloaders — cheap way to bail out without spinning up the database.

## Gotchas

- **Default-export the `CLICommand`** for project commands. The loader does `await import(...)` and reads `.default`.
- **Don't put logic at module top level.** The file gets imported during the commands scan (`warlock --warm-cache`). Anything outside `action` runs at scan time, possibly before any config or env is loaded.
- **Required options block execution.** If `required: true` and the user omits the flag, the framework prints `Missing required options:` and exits `1` before `action` runs.
- **Connectors are not free.** `connectors: true` boots the database, cache, storage, etc. For a print-version-and-exit command, leave `preload` undefined.
- **`name` field with positional slots** (`name: "storage.put <localPath>"`) — the *registered* name is still `storage.put` (the first whitespace-separated token), so look up + alias work normally. Slots are only documentation/help-output.
- **Aliases must be unique across plugin + framework + project.** The first registration wins; later collisions silently overwrite the map entry.

## See also

- [`run-app/SKILL.md`](../run-app/SKILL.md) — the operational commands (`dev` / `build` / `start`) with all flags and config knobs.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — wiring `defineConfig` and `warlock.config.ts`.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, canonical imports.
