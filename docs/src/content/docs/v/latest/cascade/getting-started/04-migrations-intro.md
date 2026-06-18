---
title: "Migrations — make the table exist"
sidebar:
  order: 4
  label: "Migrations"
---

Before you can write a record, the database needs somewhere to put it. Cascade's migrations are TypeScript files that describe your table's columns and run against your driver. This page shows the smallest migration that works — enough to unblock the first model on the next page. Schema evolution, index types, rollbacks, raw statements, and the rest of the depth all live in the [migrations guide](../the-basics/migrations.md).

## Prerequisites

- [Cascade installed](./02-installation.md) and [configured](./03-configuration.md)
- A model you want a table for — we're about to build `User` on the next page, so this migration is for that

## Why migrations exist

Postgres has a strict schema: no table, no writes. MongoDB auto-creates collections, but indexes, field types, and shape parity across environments still want to be reproducible. Migrations are the path that works in dev, prod, CI, and on a fresh laptop without anyone remembering what `ALTER TABLE` they typed last Tuesday.

## Step 1 — Write the migration

Migrations live next to their model in a `migrations/` subfolder, named with a timestamp prefix so Cascade can order them. The prefix format is `MM-DD-YYYY_HH-MM-SS-name.migration.ts`:

```ts
// src/app/users/models/user/migrations/05-11-2026_10-00-00-user.migration.ts
import { Migration, text, uuid } from "@warlock.js/cascade";
import { User } from "../user.model";

export default Migration.create(User, {
  name: text().notNullable(),
  email: text().unique().notNullable(),
  status: text().notNullable(),
});
```

What's happening:

- `Migration.create(User, { ... })` is the factory. Cascade reads `User.table` for the table name and builds the column definitions from the object you pass.
- `text()`, `uuid()`, plus modifiers (`.notNullable()`, `.unique()`, `.nullable()`) are column helpers exported from `@warlock.js/cascade`. Each one returns a builder you can chain modifiers on.
- The `id` primary key and the `createdAt` / `updatedAt` timestamps are added automatically — you don't declare them here. Naming follows your data source's convention (snake_case for Postgres, camelCase for MongoDB by default), and the exact `id` shape (auto-increment integer, UUID, custom) is a configuration choice covered in the [configuration guide](../architecture-concepts/configuration.md).
- The soft-delete column (`deletedAt`) is added automatically too — but only when the model's delete strategy resolves to `"soft"`. See [delete strategies](../digging-deeper/delete-strategies.md).
- `export default` is required — the runner imports each migration file as its default export.

## Step 2 — Run the migration

One command:

```bash
npx cascade migrate
```

Cascade walks the default migrations path (`./migrations/**/*.{ts,js,mjs,cjs}` from the directory you ran the command in), sorts each file by its timestamp prefix, runs every migration it hasn't seen before, and records what it ran. Running twice doesn't double-apply.

If your migrations live somewhere else, pass `--path` — and always quote the glob, otherwise your shell expands `**` before Cascade ever sees it:

```bash
npx cascade migrate --path "src/**/migrations/*.migration.ts"
```

The other commands you'll reach for occasionally:

```bash
npx cascade migrate -f             # fresh: drop everything and re-run
npx cascade migrate --sql          # export .up.sql / .down.sql instead of running
npx cascade migrate:rollback       # roll back the last batch
npx cascade migrate:list           # show what's executed
```

Full reference — every flag, the `.env` configuration the standalone CLI reads, programmatic use — in the [standalone CLI guide](../cli/cli.md).

:::tip — TypeScript migrations?

`npx cascade migrate` loads `.js` / `.mjs` migrations directly. For `.ts` migrations, invoke through a TypeScript runtime — Cascade ships no transpiler:

```bash
npx tsx node_modules/.bin/cascade migrate
```

Wrap it in a `package.json` script (or your CI config) once you're tired of typing it. Full pattern in the [standalone CLI guide](../cli/cli.md).

:::

:::tip — Using Warlock.js?

`npx warlock migrate` does the same thing, with the framework's connector preload and logger integration on top. The underlying engine is identical — Warlock's CLI wraps Cascade's migration runner, same as the `cascade` bin does. Use whichever fits your project.

:::

## Step 3 — Verify (optional)

If you want eyes on the table before moving on, connect with your usual tool (`psql`, `mongosh`, your IDE's DB explorer) and check the columns are there. `\dt` lists tables in psql; `db.users.findOne()` shows the shape in mongosh. Not mandatory — Cascade tells you what it ran, and the next page's first `User.create(...)` is the real verification.

## Foreign keys — a brief taste

The relationships page will introduce a `Post.author_id` that points at `User.id`. Foreign keys are declared on the column with `.references(table).onDelete(...)`:

```ts
author_id: uuid().references(User.table).onDelete("cascade").notNullable(),
```

This says "the value lives in `User.id`, and if the user is deleted, delete dependent posts too." Other cascade options (`set null`, `restrict`, `no action`) and the full FK story — composite keys, deferred constraints, custom names — live in the migrations guide.

## Recap

- Migrations sit in `<model>/migrations/`, named with a timestamp prefix
- `Migration.create(Model, { columns })` is the entire API for a basic table
- `npx cascade migrate` runs whatever's pending; idempotent
- `id`, `createdAt`, and `updatedAt` are added for you — plus `deletedAt` when the model uses soft deletes

## Next

Continue to **[Your first model](./05-your-first-model.md)** to put your first record into the table you just created.

## Going further

The migration page is intentionally a kickoff. Once you need more:

- **Schema evolution** (add/drop/rename/modify columns, indexes, foreign keys at the right point in time), **rollbacks**, **driver-specific DDL**, and the full 30+ operation types: the [migrations guide](../the-basics/migrations.md).
- **Standalone CLI surface** (every flag, every subcommand, `.env` configuration): the [standalone CLI guide](../cli/cli.md).
- **Programmatic execution** for CI scripts, test setup, container init, or any embedded use case — call the Operations API directly:

  ```ts
  import {
    connectToDatabase,
    migrationRunner,
    runMigrations,
  } from "@warlock.js/cascade";
  import databaseConfig from "./config/database";
  import UserMigration from "./src/app/users/models/user/migrations/05-11-2026_10-00-00-user.migration";

  await connectToDatabase(databaseConfig);

  UserMigration.migrationName = "user";
  migrationRunner.register(UserMigration);

  await runMigrations();
  ```

  Every CLI command maps to an Operations API function — `runMigrations`, `rollbackMigrations`, `freshMigrate`, `exportMigrationsSQL`, `listExecutedMigrations`. Full signatures in the [Operations API reference](../reference/operations-api.md).
