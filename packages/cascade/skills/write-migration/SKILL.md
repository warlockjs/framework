---
name: write-migration
description: 'Write a Cascade migration — the declarative `Migration.create(Model, { columns })` / `Migration.alter(Model, { ... })` factory is the primary form (column helpers `string` / `text` / `uuid` / `integer` imported from cascade, chained with `.notNullable()` / `.unique()` / `.references()`); the `extends Migration` class form is the imperative escape hatch. Run with the `cascade migrate` CLI; pin a source via `public dataSource`. Triggers: `Migration.create`, `Migration.alter`, `string()`, `text()`, `uuid()`, `.references`, `extends Migration`, `cascade migrate`; "write a migration", "create the users table", "add a column", "rollback the last batch"; typical import `import { Migration, text, uuid } from "@warlock.js/cascade"`. Skip: running migrations programmatically — `@warlock.js/cascade/run-cascade-cli/SKILL.md`; per-source migrations — `@warlock.js/cascade/manage-data-sources/SKILL.md`; competing tools `knex migrate`, `prisma migrate`, `typeorm migration`.'
---

# Write a migration

The model class doesn't auto-create tables. Migrations declare the schema change in a versioned file; the CLI applies them in order for a reproducible DB shape across environments.

The primary form is **declarative**: `Migration.create(Model, { columns })` reads the table name from the model and builds the columns from the object you pass. Reach for the imperative `extends Migration` class form only when a migration is genuinely procedural.

## Minimal example — `Migration.create`

```ts title="src/app/users/models/user/migrations/05-11-2026_10-00-00-user.migration.ts"
import { Migration, text, uuid } from "@warlock.js/cascade";
import { User } from "../user.model";

export default Migration.create(User, {
  name: text().notNullable(),
  email: text().unique().notNullable(),
  status: text().notNullable(),
});
```

What happens:

- `Migration.create(Model, columns)` reads `User.table` for the table name and builds the DDL from the column map; it infers the rollback for you.
- Column helpers (`text`, `uuid`, `string`, `integer`, …) are imported from `@warlock.js/cascade`. Each returns a builder you chain modifiers onto (`.notNullable()`, `.unique()`, `.nullable()`, `.default(...)`, `.references(table)`).
- The `id` primary key and `createdAt` / `updatedAt` timestamps are added **automatically** — don't declare them. Naming follows the data source convention (snake_case on Postgres, camelCase on MongoDB).
- The soft-delete column is added **automatically when the model's delete strategy resolves to `"soft"`** — don't declare it. See below.
- `export default` is required — the runner imports each file's default export.

Evolve an existing table with `Migration.alter(Model, { ... })` (add / drop / rename / modify columns and indexes); it's declarative the same way.

## Soft-delete column is auto-wired

If the model uses soft deletes, `Migration.create` adds the `deletedAt` column for you — you don't declare it, the same way you don't declare `createdAt` / `updatedAt`. The strategy is resolved exactly as `destroy()` resolves it: model static `deleteStrategy` → data source `defaultDeleteStrategy` → `"permanent"`. Since soft delete is usually an app-wide policy set on the data source, every `Migration.create` then gets the column with zero extra config.

```ts
// User (or the data source) has deleteStrategy "soft" → deletedAt is added.
export default Migration.create(User, {
  name: text().notNullable(),
});
```

- The column name comes from the model's `deletedAtColumn` (default `"deletedAt"`), so it matches what `destroy()` writes at runtime.
- It only fires for the `"soft"` strategy — `"permanent"` and `"trash"` add nothing. No driver defaults to `"soft"`, so this never fires unless soft delete is opted into.
- Opt out for one table with `{ softDeletes: false }`; force it on with `{ softDeletes: true }`. A model with `deletedAtColumn = false` is never wired. An already-declared `deletedAt` in the map is not duplicated.

See [`@warlock.js/cascade/configure-delete-strategy/SKILL.md`](@warlock.js/cascade/configure-delete-strategy/SKILL.md) for the strategies themselves.

## Running migrations

```bash
yarn cascade migrate            # apply pending migrations
yarn cascade migrate:rollback   # undo the last batch
yarn cascade migrate:list       # which migrations have been executed
yarn cascade migrate:export-sql # write .up.sql / .down.sql instead of executing
```

`cascade migrate` discovers migration files via the `-p`/`--path` glob (default `./migrations/**`), runs them in order, and records each in the `_migrations` table / collection. See [`@warlock.js/cascade/run-cascade-cli/SKILL.md`](@warlock.js/cascade/run-cascade-cli/SKILL.md) for every flag and the programmatic Operations API.

## File naming convention

Name files with a timestamp prefix (`MM-DD-YYYY_HH-MM-SS-<name>.migration.ts`) so Cascade orders runs deterministically and infers the migration name from the filename. A timestamp prefix prevents the "two devs picked the same number" merge conflict.

## Column helpers — the building blocks

Every column in a `Migration.create` / `Migration.alter` map starts with a helper imported from `@warlock.js/cascade`; each returns a builder you chain modifiers onto (`.notNullable()`, `.nullable()`, `.unique()`, `.default(value)`, `.index()`, `.primary()`, `.references(table)`):

```ts
import { Migration, text, integer, json, timestamp, uuid } from "@warlock.js/cascade";
import { User } from "../user.model";

export default Migration.create(Post, {
  title: text().notNullable(),
  body: text().nullable(),
  author_id: uuid().references(User.table).onDelete("cascade").notNullable(),
  status: text().notNullable(),
  metadata: json(), // JSON / JSONB column
  published_at: timestamp().nullable(),
});
```

`references(table)` defaults to the referenced table's `id` column; chain `.on("custom_id")` for a different one, and `.onDelete(...)` / `.onUpdate(...)` for FK actions. `id`, `createdAt`, and `updatedAt` are still added for you. The full helper vocabulary (`string`, `char`, `integer`, `bigInteger`, `decimal`, `boolCol`, `date`, `dateTime`, `uuid`, `ulid`, `enumCol`, `vector`, the `array*` family, …) lives in the migrations guide.

## Imperative escape hatch — `extends Migration`

When a migration is genuinely procedural (a runtime `hasIndex` check, branching on existing schema, interleaving DDL and data), drop to the class form. Here the column types are methods on `this`:

```ts
import { Migration } from "@warlock.js/cascade";

export default class BackfillStatuses extends Migration {
  public readonly table = "posts";

  public async up(): Promise<void> {
    if (!(await this.hasColumn("status"))) {
      this.string("status").defaultString("draft");
    }

    this.raw(`UPDATE posts SET status = 'published' WHERE published_at IS NOT NULL`);
  }

  public down(): void {
    this.dropColumn("status");
  }
}
```

Class-form builders include `createTable()` / `createTableIfNotExists()`, `dropTable()` / `dropTableIfExists()`, `dropColumn(name)`, `renameTableTo(name)`, `timestamps()`, `index(...)`, `primaryUuid()`, and `raw(sql)` for a raw statement.

## Raw SQL migrations

For SQL-only changes (Postgres), `Migration.rawSql` builds a migration class for you:

```ts
export default Migration.rawSql({
  name: "2026-01-01-create-auth",
  up: [`CREATE TABLE sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id))`],
  down: [`DROP TABLE sessions`],
});
```

(Throws on MongoDB — use the declarative or class form there.)

## Reversibility

For the class form, `down()` should undo `up()` — the CLI calls it on rollback. (`Migration.create` infers the rollback automatically.) If a migration is genuinely one-way, throw inside `down()` so accidental rollbacks fail loudly:

```ts
public down(): void {
  throw new Error("This migration is irreversible — restore from backup if you need to undo it.");
}
```

## Data-source-aware migrations

A `Migration.create` / `Migration.alter` migration **inherits its data source from the model** — whatever `static dataSource = "analytics"` the model declares, the migration runs against. You don't pass it in the options.

```ts
// AnalyticsEvent has `static dataSource = "analytics"`, so this migration
// targets the analytics database automatically.
export default Migration.create(AnalyticsEvent, {
  type: text().notNullable(),
});
```

For a class-form migration not bound to a model, set `public readonly dataSource = "analytics"` directly. See [`@warlock.js/cascade/manage-data-sources/SKILL.md`](@warlock.js/cascade/manage-data-sources/SKILL.md) for the registry.

## Things NOT to do

- Don't reach for a `migration({ up(driver) {...} })` factory or `driver.createTable(name, (table) => {...})` — that API doesn't exist. Use `Migration.create(Model, { columns })`, or `extends Migration` with `this.createTable()` for the imperative case.
- Don't declare `id` / `createdAt` / `updatedAt` — they're added for you. Same for `deletedAt` when the model's strategy is `"soft"` — it's auto-wired (opt out with `{ softDeletes: false }`).
- Don't auto-run migrations from app code in production. Run them as a deploy step.
- Don't put irreversible data backfills in the same file as a schema change — split them so rollback only undoes the schema.
- Don't change a committed migration. Add a new one. Editing a migration that already ran in production puts environments out of sync.

## See also

- [`@warlock.js/cascade/run-cascade-cli/SKILL.md`](@warlock.js/cascade/run-cascade-cli/SKILL.md) — CLI flags + Operations API for programmatic runs
- [`@warlock.js/cascade/manage-data-sources/SKILL.md`](@warlock.js/cascade/manage-data-sources/SKILL.md) — multi-DB migrations
- [`@warlock.js/cascade/configure-delete-strategy/SKILL.md`](@warlock.js/cascade/configure-delete-strategy/SKILL.md) — soft / trash / permanent deletes and the `deletedAt` column
