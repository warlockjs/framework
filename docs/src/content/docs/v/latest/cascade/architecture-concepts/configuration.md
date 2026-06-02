---
title: "Configuration — the full surface"
sidebar:
  order: 1
  label: "Configuration (deep)"
---

The [Configuration page in getting-started](../getting-started/03-configuration.md) covers the fast-kickoff: minimum config + `connectToDatabase`. This page picks up where that ends. It covers every option `ConnectionOptions` accepts, the model-defaults hierarchy, multi-data-source registration, and the migration-level knobs.

If you've gotten this far through the docs, you've already configured a database. This page is for when you need to *tune* — performance pools, custom column conventions, multi-tenant routing, migration table naming, the works.

## The shape of `connectToDatabase`

```ts
import { connectToDatabase } from "@warlock.js/cascade";

const dataSource = await connectToDatabase({
  driver: "postgres",
  database: "myapp",
  // ... everything else is optional
});
```

`connectToDatabase` returns a `DataSource` instance and registers it with the global `dataSourceRegistry`. Most apps call it once at boot and never touch the return value — models reach their data source through the registry.

The full option surface organizes into four buckets, each with its own concern:

| Bucket | What it configures | Lives on |
| ------ | ------------------ | -------- |
| **Shared** | driver, connection details, logging | top-level fields |
| **`driverOptions`** | Cascade-side driver knobs (id generation, sessions, ...) | `driverOptions: {...}` |
| **`clientOptions`** | The native database client (mongodb / pg packages) | `clientOptions: {...}` |
| **`modelOptions`** | Default model behaviour for every model on this data source | `modelOptions: {...}` |

The split is intentional: shared config is portable across drivers, `clientOptions` punches through to the native library when you need its specific knob, and `modelOptions` is where you set cross-cutting model behaviour without touching each model.

## Shared connection config

```ts
const ds = await connectToDatabase({
  // Identity
  driver: "postgres", // "mongodb" | "postgres" | "mysql" (coming)
  name: "primary", // unique identifier in the registry (default: "default")
  isDefault: true, // mark as the default data source (default: true)

  // What database
  database: "myapp", // required

  // Where it lives
  uri: "postgres://...", // OR
  host: "localhost",
  port: 5432,
  username: "myapp",
  password: process.env.DB_PASSWORD,
  authSource: "admin", // MongoDB-specific

  // Operations
  logging: false, // log every query? Leave OFF in production.
});
```

A few of these earn their own callouts:

### `name` and `isDefault`

The registry can hold multiple data sources, keyed by `name`. Without a name, you get `"default"`. The first call to `connectToDatabase` becomes the default; subsequent calls override unless you pass `isDefault: false`:

```ts
await connectToDatabase({ name: "primary",  database: "main",      isDefault: true });
await connectToDatabase({ name: "analytics", database: "warehouse", isDefault: false });
```

Per-model routing (`static dataSource = "analytics"`) and the multi-database story are covered in the [Multi-database guide](../digging-deeper/multi-database.md).

### `uri` vs `host`/`port`

Pick one. URIs are convenient for `.env`-driven config; the split form is convenient when host/port come from different secrets:

```ts
// URI form
connectToDatabase({ driver: "postgres", database: "myapp", uri: process.env.DATABASE_URL });

// Split form
connectToDatabase({
  driver: "postgres",
  database: "myapp",
  host: process.env.DB_HOST,
  port: 5432,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
```

Both work on both drivers.

### `logging`

```ts
connectToDatabase({ logging: true });
```

Logs every query, its bindings, and execution time. Useful in development; **disabled by default and recommended OFF in production** — query logs can contain sensitive data and saturate your log shipper at scale.

## Driver-specific options — `driverOptions`

Cascade-level driver knobs go here. The shape depends on the driver.

### MongoDB driver options

```ts
import type { MongoDriverOptions } from "@warlock.js/cascade";

await connectToDatabase<MongoDriverOptions>({
  driver: "mongodb",
  database: "myapp",
  driverOptions: {
    autoGenerateId: true,                     // assign numeric ids via counters
    counterCollection: "counters",            // where the counters live
    transactionOptions: {                     // defaults for transactions
      readPreference: "primary",
      readConcern: { level: "majority" },
      writeConcern: { w: "majority" },
    },
  },
});
```

### Postgres driver options

Postgres has fewer Cascade-side knobs today — most options flow through `clientOptions` (which maps to `pg`'s `PoolConfig`). Schema selection lives here when it matters.

## Native client options — `clientOptions`

`clientOptions` punches through to the native database client library:

- **MongoDB** — `MongoClientOptions` from the `mongodb` package (pool sizes, timeouts, SSL, replica set config, ...)
- **Postgres** — `PoolConfig` from the `pg` package (pool sizes, statement timeouts, SSL, ...)

```ts
import type { MongoClientOptions } from "mongodb";
import type { MongoDriverOptions } from "@warlock.js/cascade";

await connectToDatabase<MongoDriverOptions, MongoClientOptions>({
  driver: "mongodb",
  database: "myapp",
  clientOptions: {
    minPoolSize: 5,
    maxPoolSize: 50,
    serverSelectionTimeoutMS: 5_000,
    retryWrites: true,
  },
});
```

```ts
await connectToDatabase({
  driver: "postgres",
  database: "myapp",
  clientOptions: {
    max: 20,                    // max connections in the pool
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,  // SQL-level statement timeout (ms)
    ssl: { rejectUnauthorized: true },
  },
});
```

When in doubt about which option is Cascade's vs the native library's: Cascade-side options are documented in the `MongoDriverOptions` / Postgres types; everything else is the native library. The split keeps the API portable — same Cascade options on every driver, native escape hatch when you specifically need it.

## Model defaults — `modelOptions`

`modelOptions` sets behaviour for every model on this data source unless the individual model overrides. The hierarchy, highest priority first:

1. **Model static property** — `User.deletedAtColumn = "archived_at"`
2. **`modelOptions`** — database-wide override
3. **Driver default** — Postgres: snake_case, MongoDB: camelCase
4. **Framework default** — fallback values

```ts
await connectToDatabase({
  driver: "postgres",
  database: "myapp",
  modelOptions: {
    // Override Postgres default (snake_case) — use camelCase
    namingConvention: "camelCase",

    // Timestamp columns
    createdAtColumn: "createdAt",
    updatedAtColumn: "updatedAt",
    deletedAtColumn: "deletedAt",
    timestamps: true,

    // ID generation (mostly MongoDB-relevant)
    autoGenerateId: false,
    randomIncrement: true,
    initialId: 1000,

    // Default delete strategy for every model
    deleteStrategy: "soft",
    trashTable: "archive", // shared trash table for all models
  },
});
```

Pick the keys you actually need to override — leave the rest to the driver defaults.

A few of these worth a closer look:

### `namingConvention`

The default differs per driver: Postgres treats columns as `snake_case`, MongoDB treats them as `camelCase`. The convention controls how Cascade reads/writes things like `createdAt` vs `created_at`. Override when your schema diverges from the driver convention.

### `timestamps`

When `true`, Cascade auto-stamps `createdAtColumn` and `updatedAtColumn` on insert/update. Default: `true`. Disable per model with `static timestamps = false` or globally here.

### `autoGenerateId` (MongoDB)

MongoDB doesn't ship with auto-increment ids. When `autoGenerateId: true`, Cascade uses a counter collection to issue sequential numeric ids. Combine with `randomIncrement` and `initialId` for non-predictable id ranges. For Postgres, the database handles this natively — leave the option off.

### `deleteStrategy` / `trashTable`

The data-source-wide defaults for the delete strategy precedence chain (see [Delete strategies guide](../digging-deeper/delete-strategies.md)). Set once here to make every model on this data source use soft-delete (or trash) by default; override per model when needed.

## Migration defaults — `migrationOptions`

UUID strategy and other migration-time defaults:

```ts
await connectToDatabase({
  driver: "postgres",
  database: "myapp",
  migrationOptions: {
    uuidStrategy: "v7", // default UUID version for new migrations
  },
});
```

These override driver migration defaults but can be overridden by individual migration calls.

## Migration runtime config — `migrations`

The `migrations` object configures the migration runner itself:

```ts
await connectToDatabase({
  driver: "postgres",
  database: "myapp",
  migrations: {
    transactional: true,    // wrap each migration in a transaction
    table: "_migrations", // tracking table name
  },
});
```

- **`transactional`** — Postgres default is `true` (DDL is transactional in PG); MongoDB default is `false` (Mongo DDL can't run in a transaction). Override per migration with the migration's `static transactional` property.
- **`table`** — the bookkeeping table name. Default `"_migrations"`. Change if your project already uses that name for something else.

## Data-source-wide delete defaults

Two separate keys exist at the top level of `ConnectionOptions` for the soft-delete story:

```ts
await connectToDatabase({
  defaultDeleteStrategy: "soft", // or "trash" / "permanent"
  defaultTrashTable: "RecycleBin",
});
```

These are the **fallbacks** in the strategy resolution chain (see [Delete strategies guide](../digging-deeper/delete-strategies.md#strategy-resolution)) — they apply when neither the per-call options nor the per-model static set anything. The `modelOptions.deleteStrategy` / `modelOptions.trashTable` keys cover the same ground; either works.

## Multiple data sources

Register several:

```ts
await connectToDatabase({
  name: "primary",
  driver: "postgres",
  database: "main",
});

await connectToDatabase({
  name: "analytics",
  driver: "postgres",
  database: "warehouse",
  isDefault: false,
});
```

Models default to the registry's default data source. Override per model:

```ts
@RegisterModel()
export class AnalyticsEvent extends Model<EventSchema> {
  public static table = "events";
  public static schema = eventSchema;
  public static dataSource = "analytics";
}
```

See the [Multi-database guide](../digging-deeper/multi-database.md) for the full multi-data-source story (cross-source joins, transaction limits, separate schemas).

## Reaching the driver directly

For diagnostic queries, custom DDL, or driver-specific features outside the structured API:

```ts
import { getDatabaseDriver, transaction } from "@warlock.js/cascade";

const driver = getDatabaseDriver();
// driver is typed as DriverContract; cast to a specific driver type when needed
```

`getDatabaseDriver<PostgresDriver>()` accepts a type parameter when you want the concrete driver's full API surface (e.g., Postgres-specific advisory locks).

## A complete example — production Postgres config

```ts
import { connectToDatabase } from "@warlock.js/cascade";

await connectToDatabase({
  driver: "postgres",
  name: "primary",
  database: "myapp",

  uri: process.env.DATABASE_URL,

  clientOptions: {
    max: 20,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    ssl: { rejectUnauthorized: true },
  },

  modelOptions: {
    namingConvention: "snake_case",
    timestamps: true,
    deleteStrategy: "soft",
  },

  migrationOptions: {
    uuidStrategy: "v7",
  },

  migrations: {
    transactional: true,
    table: "_migrations",
  },

  defaultDeleteStrategy: "soft",
  logging: false, // OFF in production
});
```

That's roughly what a real production config looks like — 20 connections, hard 10-second statement timeout, SSL on, soft-delete throughout, UUIDv7 for new tables, transactional migrations, no query logging. Adjust the numbers for your scale; the shape is the same.

## Going further

- **Per-model data-source routing and multi-tenant patterns:** [Multi-database guide](../digging-deeper/multi-database.md)
- **Delete strategy resolution and trash-table semantics:** [Delete strategies guide](../digging-deeper/delete-strategies.md)
- **The Operations API** (programmatic migration runs for tooling, CI, embedded use): [Operations API reference](../reference/operations-api.md); standalone binary: [CLI guide](../cli/cli.md)
- **Transactions** (the `transaction()` utility, Mongo replica-set requirement): [Transactions guide](../digging-deeper/transactions.md)
