---
title: "Configuration — the full surface"
sidebar:
  order: 1
  label: "Configuration (deep)"
---

The [Configuration page in getting-started](../getting-started/03-configuration.md) covers the fast-kickoff: minimum config + `connectToDatabase`. This page picks up where that ends. It covers every option `ConnectionOptions` accepts, the model-defaults hierarchy, multi-data-source registration, and the migration-level knobs.

If you've gotten this far through the docs, you've already configured a database. This page is for when you need to _tune_ — performance pools, custom column conventions, multi-tenant routing, migration table naming, the works.

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

| Bucket              | What it configures                                          | Lives on               |
| ------------------- | ----------------------------------------------------------- | ---------------------- |
| **Shared**          | driver, connection details, logging                         | top-level fields       |
| **`driverOptions`** | Cascade-side driver knobs (id generation, sessions, ...)    | `driverOptions: {...}` |
| **`clientOptions`** | The native database client (mongodb / pg packages)          | `clientOptions: {...}` |
| **`modelOptions`**  | Default model behaviour for every model on this data source | `modelOptions: {...}`  |

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
await connectToDatabase({ name: "primary", database: "main", isDefault: true });
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

Logs every query and its execution time. Useful in development; **disabled by default and recommended OFF in production** — query logs saturate your log shipper at scale. Values are kept out of the log: PostgreSQL logs the SQL with the count and types of its bound values, and MongoDB logs the command, the collection and the shape of the command (field names and value types, never the documents or filter values). A failed MongoDB command logs its error name and code, with the duplicate-key value removed from the message.

### `queryEvents`

```ts
connectToDatabase({ driver: "mongodb", database: "myapp", queryEvents: true });
```

Emits the `query` event (`dataSourceRegistry.on("query", …)`) for every database command — what the request log's query capture and devtools read. On MongoDB this turns on the client's command monitoring, which decodes every reply a second time, so it costs on each query.

| Value           | MongoDB `query` events                                        |
| --------------- | ------------------------------------------------------------- |
| unset (default) | on outside production, off when `NODE_ENV` is `production`    |
| `true`          | always on                                                     |
| `false`         | off (unless `logging: true`, which needs the same monitoring) |

When something subscribes to `query` events while a MongoDB data source has them off (the request log's query capture in production, for example), the registry logs one warning per data source naming `queryEvents: true`, instead of the listener silently receiving nothing. `driver.queryEventsEnabled` reports the resolved setting.

An explicit `clientOptions.monitorCommands` wins over all of these. PostgreSQL emits the event whenever something listens, at no cost otherwise, and ignores this option.

## Driver-specific options — `driverOptions`

Cascade-level driver knobs go here. The shape depends on the driver.

### MongoDB driver options

```ts
import type { MongoDriverOptions } from "@warlock.js/cascade";

await connectToDatabase<MongoDriverOptions>({
  driver: "mongodb",
  database: "myapp",
  driverOptions: {
    autoGenerateId: true, // assign numeric ids via counters
    counterCollection: "counters", // where the counters live
    transactionOptions: {
      // defaults for transactions
      readPreference: "primary",
      readConcern: { level: "majority" },
      writeConcern: { w: "majority" },
    },
    like: { maxWildcards: 2, maxLength: 256 }, // caps on whereLike patterns (the defaults)
  },
});
```

**`like`** caps string `whereLike` / `whereNotLike` patterns (and the `like` / `notLike` operators of `where()`). MongoDB runs a LIKE pattern as a regex, and each `%` wildcard multiplies how long one long value can take to match, so a pattern over a cap is refused with an `UnsafeFilterError` before it reaches the database.

| Option         | Default | Meaning                                                                      |
| -------------- | ------- | ---------------------------------------------------------------------------- |
| `maxWildcards` | `2`     | Most `%` wildcards per pattern (`%%%` counts once). `%term%`, `prefix%` fit. |
| `maxLength`    | `256`   | Longest pattern, in characters.                                              |

An explicit `RegExp` argument is code you wrote, not request input, and is not capped.

### Postgres driver options

Most Postgres options flow through `clientOptions` (which maps to `pg`'s `PoolConfig`). Schema selection lives here when it matters.

**`naming: "snake_case"`** maps your camelCase model keys to snake_case columns everywhere Cascade writes SQL (inserts, updates, `where`, `orderBy`, `select`, `groupBy`, joins), and maps result rows back to camelCase. The default, `"preserve"`, uses keys verbatim as column names. Table names and raw SQL (`whereRaw`, `raw`) are never rewritten.

```ts title="src/config/database.ts"
connectToDatabase({
  driver: "postgres",
  uri: process.env.DATABASE_URL,
  driverOptions: { naming: "snake_case" },
});

// model.set("createdAt", …) writes "created_at"; Order.where("tenantId", id) queries "tenant_id"
```

This is separate from [`namingConvention`](#namingconvention), which only names the columns Cascade generates for you (timestamps, foreign keys).

**Session time zone.** Every Postgres connection starts with its session `TimeZone` pinned to `UTC`, because Cascade stores timestamps in UTC. Without this, date helpers (`groupByDate`, `whereDate`, `whereDateBetween`, `date_trunc`) and raw SQL such as `now()::date` follow the database server's own zone and can put rows near a month boundary in the wrong bucket. MongoDB's date helpers already default to UTC, so they need no option.

Choose another zone with `clientOptions.timezone` (or `driverOptions.timezone`), or pass `false` to keep the server's zone:

```ts
connectToDatabase({
  driver: "postgres",
  database: "myapp",
  clientOptions: { timezone: "Africa/Cairo" }, // IANA name; default "UTC"; false = server zone
});
```

An explicit `-c TimeZone=…` in `clientOptions.options` (or in the connection string's `options` parameter) always wins over `timezone`; other `options` such as `-c statement_timeout=5000` are kept and the zone is appended.

`bigint` / `int8` columns come back as numbers when they fit in a safe integer; larger values stay strings, so no precision is lost.

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
    max: 20, // max connections in the pool
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000, // SQL-level statement timeout (ms)
    ssl: { rejectUnauthorized: true },
  },
});
```

On Postgres every key you pass in `clientOptions` is forwarded to `pg.Pool` (and on to each `pg.Client`): `statement_timeout`, `query_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `keepAliveInitialDelayMillis`, `allowExitOnIdle`, `client_encoding`, `types` and anything else `pg` accepts. Only Cascade's own keys (`naming`, `timezone`, `nativeArrayColumns`, `logging`) are kept out of the pool config; Cascade's pool defaults (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `keepAlive`, `application_name`) still apply when you don't set them.

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

#### `idReservationBlockSize` (model static, MongoDB)

Each generated id costs one round-trip to the counter collection, and every insert into a collection updates the same counter document. Set `idReservationBlockSize` on a write-heavy model to reserve a block of ids in one round-trip and hand them out from memory:

```ts
class PageView extends Model {
  public static idReservationBlockSize = 100; // default: 1 (one round-trip per id)
}
```

Ids stay unique, but are no longer strictly increasing across processes, and ids left in a block when the process stops are never used. It has no effect with `randomInitialId` / `randomIncrement` or on drivers with native ids.

### `strictMode`

What a save does with a field the model's schema doesn't declare, on insert and update, nested objects included: `"strip"` (default) drops it, `"fail"` rejects the save, `"allow"` writes it. Set it per model with `static strictMode`, or for every model here. See [Unknown fields](../the-basics/validation.md#unknown-fields--strictmode).

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
    transactional: true, // wrap each migration in a transaction
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
