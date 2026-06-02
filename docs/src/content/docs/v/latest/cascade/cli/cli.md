---
title: "Standalone Cascade CLI — `cascade migrate` from any project"
sidebar:
  order: 1
  label: "Standalone CLI"
---

The `cascade` binary lets you run migrations against any project without pulling in `@warlock.js/core`. Useful when Cascade is the only piece of the warlock stack you've adopted, when you want a tight tool for a CI pipeline or container init step, or when you're scripting migrations outside the dev-server.

If you're inside a full warlock app you already have `warlock migrate` — the same code path, with project glue (config-registered migrations, dev-server file discovery) included. This guide is for the standalone case.

## What ships

One binary, four commands:

- `cascade migrate` — run all pending migrations
- `cascade migrate:list` — print what's already been executed
- `cascade migrate:rollback` — undo the last batch (or everything with `--all`)
- `cascade migrate:export-sql` — write `.up.sql` / `.down.sql` files without touching the DB

No `db:create`, no `db:drop-tables`, no `seed`. Those only really make sense inside a project that knows which database to act on — they belong in the warlock CLI. For standalone Cascade, you create and drop the database with whatever tool you'd normally use.

## Install and invoke

```bash
yarn add @warlock.js/cascade
```

Cascade ships a `cascade` bin entry, so `npx cascade` works once installed — that's the canonical invocation in CI, container init, and anywhere a production-shape command beats running a local script. If your migrations are `.ts` files you'll want to invoke through a TypeScript runtime — Cascade bundles no transpiler:

```bash
npx tsx node_modules/.bin/cascade migrate
```

Add a script in `package.json` so you don't type that every time:

```json
{
  "scripts": {
    "migrate": "tsx node_modules/.bin/cascade migrate",
    "migrate:list": "tsx node_modules/.bin/cascade migrate:list"
  }
}
```

## Configure via `.env`

There's no `cascade.config.{ts,js}` to write. Connection and migration settings come from environment variables — `.env` is auto-loaded from the project root at CLI start:

```bash
# Connection — option A: single URL
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Connection — option B: discrete vars
DB_DIALECT=postgres       # or mongodb
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=secret

# Migration defaults — only set when you need to override Cascade's library defaults
CASCADE_PRIMARY_KEY=uuid       # uuid | int | bigInt    (default: int)
CASCADE_UUID_STRATEGY=v7       # v4 | v7                (default: v4)
```

If you're coming from a warlock project, the aliases `DB_URL`, `DB_DRIVER`, and `DB_USERNAME` are also accepted — your existing `.env` works as-is.

The `CASCADE_*` migration-defaults matter when your migrations declare foreign keys whose type depends on the primary key. Example: a migration that says `image_id: uuid().references(Upload.table)` only works if `uploads.id` was created as UUID — and that only happens when `migrationDefaults.primaryKey` is `"uuid"`. If your project uses UUID primary keys, set `CASCADE_PRIMARY_KEY=uuid`. For deeper background on migration column types, see the [migrations guide](../the-basics/migrations.md).

## Where Cascade looks for migration files

Default: `./migrations/**/*.{ts,js,mjs,cjs}` from the directory you run the binary in. Drop your migrations under `./migrations` and Cascade finds them.

Need a different layout? Pass `--path`:

```bash
npx cascade migrate -p "src/app/**/migrations/*.ts"
npx cascade migrate --path "db/schema/*.migration.ts"
```

> **Quote the glob.** On macOS / Linux, bash expands `**` and `*` *before* passing them to the binary, leaving Cascade with a single resolved filename instead of a glob. Always wrap the pattern in double quotes when it contains shell metacharacters.

Each file must `export default` a migration class — the same shape you'd write for `warlock migrate`. Cascade infers the migration name from the filename (`02-04-2026_06-31-48-organization.migration.ts` → `02-04-2026_06-31-48-organization`) and uses the timestamp prefix for ordering when present.

## Running migrations

```bash
npx cascade migrate                              # run all pending
npx cascade migrate -f                           # fresh: rollback all, then run all
npx cascade migrate --sql                        # export SQL files instead of executing
npx cascade migrate --sql --pending-only         # only pending migrations
npx cascade migrate --sql --compact              # strip comments + blank lines
```

`migrate:list` reads the `_migrations` tracking table directly — no files needed:

```bash
npx cascade migrate:list
```

```text
Total Executed Migrations: 5

  ✔ 11-12-2025_23-58-03-user
    Executed: 19-05-2026 13:34
    Created:  11-12-2025 23:58

  ✔ 02-04-2026_06-31-48-organization
    Executed: 19-05-2026 13:34
    Created:  04-02-2026 06:31
  ...
```

`migrate:rollback` undoes the last batch by default; pass `--all` to roll back everything, or `--batches N` for the last N batches:

```bash
npx cascade migrate:rollback              # last batch
npx cascade migrate:rollback --all        # nuclear
npx cascade migrate:rollback --batches 3  # last three batches
```

`migrate:export-sql` writes phase-ordered `.up.sql` and `.down.sql` files to `<cwd>/database/sql/` — useful for code review, reproducing schema changes in another environment, or feeding into a DBA workflow:

```bash
npx cascade migrate:export-sql
npx cascade migrate:export-sql --pending-only --compact
```

## Output and logging

Cascade routes progress through `@warlock.js/logger`'s `ConsoleLog` channel — the same channel a full warlock app uses, so the per-migration "Migrating: X successfully (12ms)" lines look identical between `cascade migrate` and `warlock migrate`. Each line carries an ISO timestamp and `[database] [migration]` tags.

## Programmatic use — the Operations API

`cascade` is a thin wrapper over the **Operations API**, which you can call from your own scripts (tests, container init, custom CLIs):

```ts
import {
  runMigrations,
  rollbackMigrations,
  freshMigrate,
  listExecutedMigrations,
  migrationRunner,
} from "@warlock.js/cascade";

// Register your migration classes first
import CreateUsersTable from "./migrations/create-users.migration";
migrationRunner.registerMany([CreateUsersTable /* … */]);

const results = await runMigrations();
console.log(`Ran ${results.length} migrations`);
```

See the [Operations API reference](../reference/operations-api.md) for every function's signature.

## Two CLIs, same migrations

If you're running both warlock and cascade-standalone against the same database (e.g. warlock for the main app, cascade for a one-off migration script), they share the `_migrations` tracking table — `warlock migrate` followed by `cascade migrate:list` shows the same entries. Make sure `CASCADE_PRIMARY_KEY` and `CASCADE_UUID_STRATEGY` match your warlock project's `src/config/database.ts` so the two surfaces generate identical SQL.
