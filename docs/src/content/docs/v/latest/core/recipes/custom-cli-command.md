---
title: "Custom CLI command"
description: Add your own `warlock <my-cmd>` — author with the `command()` factory, register in `warlock.config.ts` or auto-discover from `src/app/<module>/commands/`, accept options, and only load the subsystems you need.
sidebar:
  label: "Custom CLI command"
---

Every Warlock project ends up with one-off operations that don't deserve an HTTP endpoint: a data fix-up, a stats dump, a key rotation, a one-time backfill. Those belong in the CLI. Warlock ships a `command()` factory that lets you bolt new commands onto `warlock` the same way the framework's own `migrate`, `seed`, and `generate.*` are wired. This recipe walks the full path: author the command, decide how to register it, read arguments and options, and only load the subsystems you actually need.

We'll build `warlock report.sales` — prints a sales summary from the database, colored, with `--from`/`--to` options.

## Step 1 — The shape of a command

A Warlock command is a `CLICommand` instance produced by the `command()` factory from `@warlock.js/core`:

```ts title="src/app/reports/commands/report-sales.command.ts"
import { colors } from "@mongez/copper";
import { command } from "@warlock.js/core";

export default command({
  name: "report.sales",
  description: "Print a sales summary for a date range",
  alias: "rs",
  preload: {
    env: true,
    config: ["database"],
    connectors: ["database"],
  },
  options: [
    {
      text: "--from, -f",
      description: "Start date (YYYY-MM-DD)",
      required: true,
    },
    {
      text: "--to, -t",
      description: "End date (YYYY-MM-DD)",
      defaultValue: new Date().toISOString().slice(0, 10),
    },
  ],
  action: async ({ options }) => {
    console.log(colors.cyan(`Fetching sales from ${options.from} to ${options.to}…`));
    // …business logic comes next
  },
});
```

A few things to notice before we fill in the logic:

1. **Default export.** Project commands are auto-discovered by the loader if you export the `CLICommand` as the default from a `.command.ts` file inside `src/app/<module>/commands/`.
2. **`name` is the CLI verb.** Dot notation is a convention (`db.seed`, `jwt.generate`, `report.sales`) — the loader treats the dot as a literal character. `warlock report.sales` is the invocation.
3. **`alias` is a short name.** `warlock rs --from=2026-01-01` works the same as `warlock report.sales --from=...`.
4. **`preload` says what subsystems to boot.** By default a command starts cold — no env, no config, no DB. Opt in to what you need. More on that below.
5. **`options` are flag definitions.** Parsed and validated before `action` runs.

## Step 2 — How options work

Each entry in the `options` array has this shape:

```ts
{
  text: "--from, -f",      // "--key", "-k", "--key, -k", or "-k, --key"
  description: "Start date (YYYY-MM-DD)",
  type: "string",          // "string" (default) | "boolean" | "number"
  defaultValue: "2026-01-01",
  required: true,
}
```

The parser extracts the long-form name (camelCased) and the short alias from `text` automatically:

- `--from, -f` → `name: "from"`, `alias: "f"`
- `--no-cache` → `name: "noCache"` (kebab becomes camelCase)
- `--port=3000` → `name: "port"`
- `-p` → `name: "p"` (no long form, no alias)

Read the parsed values from the `options` argument inside your action:

```ts
action: async ({ options, args }) => {
  console.log(options.from);     // "2026-01-01"
  console.log(options.to);       // today's date
  console.log(args);             // positional args (no flags)
};
```

`--help` and `-h` are reserved — the framework intercepts them to print the per-command help. Don't try to use them.

If `required: true` and the flag is missing, Warlock refuses to run the command and prints which options weren't supplied. No try/catch needed in your code.

## Step 3 — The `preload` knob

The biggest gotcha with Warlock CLIs is forgetting that the framework doesn't start the world for you. Run a command with no `preload` and `process.env.DB_HOST` is undefined, `config.get("...")` returns `undefined`, and any Cascade query throws. You opt in to subsystems with `preload`:

```ts
preload: {
  env: true,                       // load .env files (skipped if bootstrap is true)
  config: ["database"],            // load only src/config/database.ts
  connectors: ["database"],        // start only the database connector
}
```

The fields, in the order you'll reach for them:

| Field             | Effect                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `env: true`       | Loads `.env` / `.env.local`. Skip when `bootstrap: true`.                                                                    |
| `config: true`    | Loads every file under `src/config/`.                                                                                        |
| `config: ["x"]`   | Loads only `src/config/x.ts`.                                                                                                |
| `connectors: true`     | Starts the early-phase built-in connectors (DB, cache, storage, logger, mailer).                                        |
| `connectors: ["x"]`    | Starts only the named connectors. Bypasses phase splitting — you're saying "I know exactly what I want."                |
| `bootstrap: true`      | Runs the full bootstrap flow (env + bootstrap script + all auto-loaded files). Slowest; reaches the closest to "real app." |
| `prestart: true`       | Runs `src/app/prestart.ts` after bootstrap + config (if it exists).                                                     |
| `runtimeStrategy`      | Forces `"production"` or `"development"` mode (default: detected from `NODE_ENV`).                                       |
| `environemnt`          | Overrides the environment (`"production"`, `"development"`, `"test"`).                                                  |

For our report command, we need DB access and that's all — so `env`, the `database` config, and the `database` connector. We skip `bootstrap` because we don't need routes or HTTP.

## Step 4 — Fill in the business logic

```ts title="src/app/reports/commands/report-sales.command.ts"
import { colors } from "@mongez/copper";
import { command } from "@warlock.js/core";
import { ordersRepository } from "app/orders/repositories/orders.repository";

export default command({
  name: "report.sales",
  description: "Print a sales summary for a date range",
  alias: "rs",
  preload: {
    env: true,
    config: ["database"],
    connectors: ["database"],
  },
  options: [
    {
      text: "--from, -f",
      description: "Start date (YYYY-MM-DD)",
      required: true,
    },
    {
      text: "--to, -t",
      description: "End date (YYYY-MM-DD)",
      defaultValue: new Date().toISOString().slice(0, 10),
    },
  ],
  action: async ({ options }) => {
    const { from, to } = options as { from: string; to: string };

    console.log();
    console.log(colors.cyan(`  Sales report: ${from} → ${to}`));
    console.log(colors.gray("  " + "─".repeat(48)));

    const { data: orders } = await ordersRepository.list({
      createdAtFrom: from,
      createdAtTo: to,
    });

    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.get("total")), 0);
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    console.log();
    console.log(`  ${colors.green("Total revenue")}      ${colors.bold(`$${totalRevenue.toFixed(2)}`)}`);
    console.log(`  ${colors.green("Total orders")}       ${colors.bold(String(totalOrders))}`);
    console.log(`  ${colors.green("Average order")}      ${colors.bold(`$${averageOrderValue.toFixed(2)}`)}`);
    console.log();
  },
});
```

Notes on the code:

- **`@mongez/copper`** is Warlock's terminal color library — `colors.cyan`, `colors.green`, `colors.gray`, `colors.bold`, etc. It's already a transitive dep of `@warlock.js/core`, so you don't add it explicitly.
- **`ordersRepository.list`** is the project's own repository. The recipe assumes you've built an `orders` module per the [Add a CRUD module recipe](./add-a-crud-module.md).
- **Type-cast on `options.from`/`options.to`.** The parser types options as `string | boolean | number` because it doesn't know what each flag means. Cast at the boundary.

Run it:

```bash
yarn warlock report.sales --from=2026-01-01 --to=2026-01-31
```

```
  Sales report: 2026-01-01 → 2026-01-31
  ────────────────────────────────────────────────

  Total revenue      $42135.50
  Total orders       287
  Average order      $146.81
```

## Step 5 — Where to put the file

Three ways to surface a command. Pick the one that matches your situation.

### Project commands — auto-discovered

Drop your `.command.ts` file under `src/app/<module>/commands/`. The CLI loader scans these on first use and caches the result in the manifest. No registration step required:

```
src/app/reports/commands/report-sales.command.ts
```

The convention is `<verb-noun>.command.ts`. The file's default export is the `CLICommand` instance.

If the loader can't find your command, run `yarn warlock --warm-cache` to force a rescan. Add `--no-cache` to any invocation to skip the manifest entirely.

### Plugin / package commands — explicit factory

Commands that ship from an npm package use the factory pattern. You don't auto-discover other people's packages — they register themselves:

```ts title="src/services/generate-jwt-secret.ts (in @warlock.js/auth)"
export function registerJWTSecretGeneratorCommand() {
  return command({
    name: "jwt.generate",
    description: "Generate JWT Secret key in .env file",
    action: generateJWTSecret,
  });
}
```

And the consumer wires it via `warlock.config.ts`:

```ts title="warlock.config.ts"
import {
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  cli: {
    commands: [registerJWTSecretGeneratorCommand(), registerAuthCleanupCommand()],
  },
});
```

Two reasons to prefer factories for package commands:

1. **The package can't know if you want the command.** Some projects don't need `auth.cleanup`. The factory pattern means "import nothing until you opt in."
2. **The factory call can take options.** A real-world example: `registerEmailDigestCommand({ recipient: "ops@acme.com" })`. Project commands don't have this need.

### Framework commands — read-only

`migrate`, `seed`, `dev`, `build`, `generate.*`, `storage.put`, `drop.tables`, `jwt.generate` (when authored by core, not auth) — these are built into `@warlock.js/core`. You don't write these. Read their source under `@warlock.js/core/src/cli/commands/` when you want a template for your own.

## Step 6 — Take positional arguments

The `action` receives `args` alongside `options`. Positional arguments come from anything that isn't a `--flag`:

```ts
export default command({
  name: "report.tax",
  description: "Print tax report for a region",
  options: [
    {
      text: "--year, -y",
      description: "Year",
      defaultValue: new Date().getFullYear(),
    },
  ],
  action: async ({ args, options }) => {
    const region = args[0];

    if (!region) {
      console.log(colors.red("Error: region argument is required"));
      console.log(colors.yellow("Usage: warlock report.tax <region> [--year]"));
      process.exit(1);
    }

    console.log(`Generating tax report for ${region} (year: ${options.year})`);
    // …
  },
});
```

Invocation: `yarn warlock report.tax us --year=2025`. The string `us` lands in `args[0]`; `--year` lands in `options.year`.

If you want the placeholder visible in `--help`, embed it in the command name:

```ts
name: "report.tax <region>",
```

The framework treats this as documentation only — it doesn't enforce that `args[0]` is present. Validate it yourself in `action`.

## Step 7 — Pre-action banners and input validation

Sometimes you want to do work _before_ the slow preloaders run — print a banner, check that the user passed sane flags, fail fast on bad input. That's what `preAction` is for:

```ts
preAction: async ({ options }) => {
  if (typeof options.from === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(options.from)) {
    console.log(colors.red("Error: --from must be in YYYY-MM-DD format"));
    process.exit(1);
  }
},
action: async ({ options }) => {
  // runs AFTER preloaders — DB is up, env is loaded, etc.
},
```

`preAction` runs before any preloader. It's the right place for input validation; the action below runs only if preAction lets it through.

## Step 8 — Persistent (long-running) commands

The default behavior of a command is: action returns, framework prints a success line, process exits. For dev servers, watchers, and other long-running tools you want the process to stay alive after the action returns. Set `persistent: true`:

```ts
export default command({
  name: "queue.work",
  description: "Run the queue worker",
  persistent: true,
  preload: {
    env: true,
    config: true,
    connectors: ["database"],
  },
  action: async () => {
    await startWorker();
    // intentionally doesn't return — worker.run() keeps the loop open
  },
});
```

Persistent commands also have different error handling — runtime errors after the worker is running don't crash the process. Use this for daemons; not for one-shot commands.

## Listing every command

```bash
yarn warlock --help
```

Prints every framework, plugin, and project command grouped by source. The CLI also shows the closest matches if you typo a name:

```bash
$ yarn warlock report.sallles
Command "report.sallles" not found.

Did you mean one of these?
  report.sales
  report.tax
```

## Gotchas

- **Don't `import` your command from app code.** It's a CLI entry point. Importing it inside `routes.ts` or a service will execute the `command()` factory at module load and register the command twice.
- **`preload.bootstrap: true` is heavy.** It runs every auto-loaded file (`main.ts`, `routes.ts`, etc.) for every module. For ops commands, prefer explicit `config` + `connectors` lists.
- **`process.exit(0)` is implicit on success.** The manager exits for you after a non-persistent command's action returns. Calling `process.exit(0)` yourself is harmless but redundant.
- **The manifest can go stale in dev.** If you add a new command and `warlock <new-name>` says "not found," run `yarn warlock --warm-cache` (or add `--no-cache` to your invocation) to force a rescan.
- **Pre-existing `name`s shadow each other.** Two commands with `name: "report.sales"` in different modules — last one registered wins. The loader doesn't warn. Pick unique verbs.

## See also

- ``write-cli-command` skill` — the canonical reference, with full option semantics and edge cases
- ``configure-app` skill` — `warlock.config.ts`, `defineConfig`, what plugins can register
- [Configuration](../getting-started/03-configuration.md) — `src/config/*`, env, and how preloaders read them
- [Bootstrap and connectors](../architecture-concepts/bootstrap-and-connectors.md) — what `preload.connectors` actually does
