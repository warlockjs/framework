---
title: "Operations API"
sidebar:
  order: 1
  label: "Operations API"
---

This page documents every function in Cascade's Operations API — the public seam that both warlock-core's CLI and Cascade's standalone `cascade` binary call into. Each function is a thin, named entry over the underlying `migrationRunner` singleton or `dataSourceRegistry` lookup, picked to expose stable verbs that survive runner-internal refactors.

For the *why* and when to use this vs the raw runner, see the [CLI guide](../cli/cli.md).

:::info — How method blocks are organised

Each function shows:
- **Signature** — the TypeScript signature
- **What it does** — one paragraph
- **Returns** — the resolved value shape
- **Example** — minimal snippet

:::

---

## Migration operations

### `runMigrations()`

```ts
runMigrations(): Promise<MigrationResult[]>
```

**What it does.** Runs every pending migration registered on `migrationRunner`. The caller is responsible for registering migration classes first — either via `migrationRunner.register(MigrationClass)` / `registerMany([…])`, or by loading them through Cascade's `loadMigrations()` helper in the standalone CLI path.

**Returns.** One `MigrationResult` per executed migration (`{ name, table, direction: "up", success, error?, durationMs, executedAt }`). Empty array when nothing was pending.

```ts
import { migrationRunner, runMigrations } from "@warlock.js/cascade";

migrationRunner.registerMany([CreateUsersTable, AddEmailIndex]);
const results = await runMigrations();
```

### `rollbackMigrations(options?)`

```ts
rollbackMigrations(options?: {
  all?: boolean;
  batches?: number;
}): Promise<MigrationResult[]>
```

**What it does.** Rolls back executed migrations. Default: the most recent batch. Pass `all: true` to undo every executed migration, or `batches: N` to undo the last N batches. `all` overrides `batches` when both are set.

**Returns.** `MigrationResult[]` with `direction: "down"`.

```ts
await rollbackMigrations();                  // last batch
await rollbackMigrations({ batches: 3 });    // last three batches
await rollbackMigrations({ all: true });     // everything
```

### `freshMigrate()`

```ts
freshMigrate(): Promise<MigrationResult[]>
```

**What it does.** Rolls back every executed migration, then runs every registered migration. Equivalent to `rollbackMigrations({ all: true })` followed by `runMigrations()`, returned as one concatenated array.

**Returns.** `MigrationResult[]` — rollback results first, then run results.

```ts
const results = await freshMigrate();
// results.length === executed.length * 2 when everything succeeds
```

### `exportMigrationsSQL(options?)`

```ts
exportMigrationsSQL(options?: {
  pendingOnly?: boolean;
  compact?: boolean;
}): Promise<void>
```

**What it does.** Writes phase-ordered `.up.sql` and `.down.sql` files for the registered migrations under `<cwd>/database/sql/`. Default exports every registered migration. Pass `pendingOnly: true` to skip migrations already in `_migrations`; pass `compact: true` to strip block comments and blank lines from the output.

**Returns.** Nothing — purely a file-system operation, no DB writes occur.

```ts
await exportMigrationsSQL();
await exportMigrationsSQL({ pendingOnly: true, compact: true });
```

### `listExecutedMigrations()`

```ts
listExecutedMigrations(): Promise<MigrationRecord[]>
```

**What it does.** Returns migration records persisted in the `_migrations` tracking table — one entry per migration that has ever been executed against the configured data source. The caller doesn't need to register any classes first; this only reads from the DB.

**Returns.** `MigrationRecord[]` — `{ name, batch, executedAt, createdAt }`.

```ts
const executed = await listExecutedMigrations();
console.log(executed.map((record) => record.name));
```

---

## Database operations

### `createDatabase(name, options?)`

```ts
createDatabase(
  name: string,
  options?: { connection?: string },
): Promise<CreateDatabaseResult>
```

**What it does.** Creates a database on the configured data source. Returns `created: false` when the database already exists — drivers handle the idempotency check internally. Pass `options.connection` to target a non-default named data source from the registry; omit for the default.

**Returns.** `{ created: boolean; name: string }`.

```ts
const { created } = await createDatabase("analytics");
if (created) {
  console.log("New database created");
}
```

### `dropAllTables(options?)`

```ts
dropAllTables(
  options?: { connection?: string },
): Promise<DropAllTablesResult>
```

**What it does.** Drops every table on the configured data source. Lists tables first so the caller receives the names that were affected — useful for printing, audit logging, or rendering a confirmation prompt at the call site.

**Returns.** `{ tables: string[]; dropped: number }`.

```ts
const { tables, dropped } = await dropAllTables();
console.log(`Dropped ${dropped} tables: ${tables.join(", ")}`);
```

---

## Result types

All importable from `@warlock.js/cascade`:

```ts
type MigrationResult = {
  readonly name: string;
  readonly table: string;
  readonly direction: "up" | "down";
  readonly success: boolean;
  readonly error?: string;
  readonly durationMs: number;
  readonly executedAt: Date;
};

type MigrationRecord = {
  name: string;
  batch: number;
  executedAt: Date;
  createdAt: Date;
};

type CreateDatabaseResult = {
  readonly created: boolean;
  readonly name: string;
};

type DropAllTablesResult = {
  readonly tables: string[];
  readonly dropped: number;
};
```

## See also

- [Standalone CLI guide](../cli/cli.md) — `cascade migrate` and friends.
- [Migrations (deep)](../the-basics/migrations.md) — writing migration classes.
