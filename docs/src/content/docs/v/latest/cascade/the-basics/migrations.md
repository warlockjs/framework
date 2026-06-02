---
title: "Migrations — the full surface"
sidebar:
  order: 7
  label: "Migrations (deep)"
---

The [Migrations intro](../getting-started/04-migrations-intro.md) covers the smallest migration that works: `Migration.create(Model, { columns })` + `npx cascade migrate`. This page picks up where that ends — every column type, every modifier, compound indexes, schema evolution with `Migration.alter`, foreign keys, specialized indexes, and the programmatic runner.

The guiding principle: **`Migration.create` and `Migration.alter` are declarative and cover almost everything.** You pass an object describing the end state; Cascade emits the DDL and infers the rollback. The `extends Migration` class form is a narrow escape hatch for genuinely imperative migrations — reach for it last, not first.

## Column helpers — the full vocabulary

Every column starts with a helper imported from `@warlock.js/cascade`. Each returns a builder you chain modifiers onto.

**Strings**

```ts
import { string, char, text, mediumText, longText } from "@warlock.js/cascade";

string(50)   // VARCHAR(50), default length 255
char(3)      // fixed-length CHAR(3)
text()       // unlimited TEXT
mediumText() // MEDIUMTEXT
longText()   // LONGTEXT
```

**Numbers**

```ts
import { integer, int, bigInteger, bigInt, smallInteger, tinyInteger, float, double, decimal } from "@warlock.js/cascade";

integer()       // INTEGER (alias: int)
bigInteger()    // BIGINT (alias: bigInt)
smallInteger()  // SMALLINT (alias: smallInt)
tinyInteger()   // TINYINT (alias: tinyInt)
float()         // FLOAT
double()        // DOUBLE
decimal(10, 2)  // DECIMAL(10,2) — precision, scale (default 8, 2)
```

**Booleans, dates, times**

```ts
import { bool, boolCol, date, dateTime, timestamp, time, year } from "@warlock.js/cascade";

boolCol()    // BOOLEAN (alias: bool — named to avoid the JS `boolean` clash)
date()       // DATE
dateTime()   // DATETIME
timestamp()  // TIMESTAMP
time()       // TIME
year()       // YEAR
```

**JSON, binary, identifiers**

```ts
import { json, objectCol, binary, blobCol, uuid, ulid } from "@warlock.js/cascade";

json()      // JSON / JSONB (alias: objectCol)
binary()    // BINARY / BLOB (alias: blobCol)
uuid()      // UUID
ulid()      // ULID
```

**Network, spatial, AI**

```ts
import { ipAddress, macAddress, point, polygon, lineString, geometry, vector } from "@warlock.js/cascade";

ipAddress()    // IP address column
macAddress()   // MAC address column
point()        // geo point
polygon()      // polygon
geometry()     // generic geometry
vector(1536)   // fixed-dimension vector for AI embeddings
```

**Enums, sets, Postgres arrays**

```ts
import { enumCol, setCol, arrayText, arrayInt, arrayUuid, arrayJson } from "@warlock.js/cascade";

enumCol(["active", "inactive", "pending"])  // ENUM
setCol(["read", "write", "admin"])          // SET (multi-value)
arrayText()                                  // TEXT[]   (Postgres)
arrayInt()                                   // INTEGER[]
arrayUuid()                                  // UUID[]
arrayJson()                                  // JSONB[]
```

The array helpers (`arrayInt`, `arrayBigInt`, `arrayFloat`, `arrayDecimal`, `arrayBoolean`, `arrayText`, `arrayDate`, `arrayTimestamp`, `arrayUuid`, `arrayJson`) are Postgres-native array columns. On MongoDB, an embedded array is just a `json()` field.

## Column modifiers

Chain modifiers to shape each column:

```ts
import { Migration, string, integer, decimal, text, timestamp } from "@warlock.js/cascade";
import { Product } from "../product.model";

export default Migration.create(Product, {
  sku: string(40).notNullable().unique(),
  name: string().notNullable().index(),
  description: text().nullable(),
  stock: integer().unsigned().default(0),
  price: decimal(10, 2).notNullable(),
  released_at: timestamp().nullable().comment("null until the product ships"),
});
```

Grouped by what they do:

**Nullability and defaults**

- `.nullable()` — column accepts NULL.
- `.notNullable()` — column rejects NULL.
- `.default(value)` — default applied when the column isn't set on insert (string, number, or boolean).

**Single-column keys and constraints**

- `.primary()` — primary key. (Rarely needed — `id` is auto-managed.)
- `.unique()` — unique index on **this one column**.
- `.index()` — non-unique index on **this one column**.
- `.autoIncrement()` — auto-incrementing integer.
- `.unsigned()` — unsigned numeric (SQL).

**Metadata and placement**

- `.comment(text)` — column comment (SQL).
- `.after(columnName)` — order this column after another (SQL).

**Foreign keys**

- `.references(tableOrModel)` — declares an FK. Accepts a model class (Cascade reads `.table`) or a table-name string.
- `.onDelete(action)` / `.onUpdate(action)` — `"cascade"`, `"restrict"`, `"setNull"`, `"noAction"`.

**Vector index**

- `.vectorIndex(options)` — similarity index inline on a `vector()` column. Options: `similarity` (`"cosine"` | `"euclidean"` | `"dotProduct"`), `name`, `lists`.

`.index()` and `.unique()` on a column builder are **single-column only**. Multi-column (compound) indexes are declared in the migration options — see next.

## Compound indexes and unique constraints

Multi-column indexes don't go on a column — they go in the `index` / `unique` arrays in `Migration.create`'s options (third argument):

```ts
import { Migration, uuid, text, timestamp } from "@warlock.js/cascade";
import { Summary } from "../summary.model";

export default Migration.create(
  Summary,
  {
    organization_id: uuid().notNullable(),
    content_type: text().notNullable(),
    content_id: uuid().notNullable(),
    content_language: text().notNullable(),
    body: text().notNullable(),
    generated_at: timestamp().notNullable(),
  },
  {
    index: [
      { columns: ["organization_id", "content_type", "content_id"] },
      { columns: ["organization_id", "generated_at"], name: "idx_org_recent" },
    ],
    unique: [
      {
        columns: ["organization_id", "content_id", "content_language"],
        name: "uq_summary_idempotency",
      },
    ],
  },
);
```

Each `index` / `unique` entry is `{ columns, name?, using?, include?, concurrently? }`:

- **`columns`** — a single column or an array. Arrays make it compound; column order matters (leftmost-prefix rule applies the same as raw SQL).
- **`name`** — explicit index/constraint name. Auto-generated when omitted. Name it when a later `Migration.alter` needs to reference it for a drop.
- **`using`** — Postgres access method: `"btree"` (default), `"hash"`, `"gin"`, `"gist"`, `"brin"`, `"ivfflat"`, `"hnsw"`. This is where JSON/array GIN indexes and pgvector tuning live: `{ columns: ["metadata"], using: "gin" }`.
- **`include`** — covering-index extra columns (Postgres `INCLUDE`).
- **`concurrently`** — build without locking the table (Postgres). Essential for adding an index to a large live table.

The rule of thumb: single column → `.index()` / `.unique()` on the column. Two or more columns → the `index` / `unique` options array.

## Foreign keys

The common shape — a child column pointing at a parent:

```ts
import { Migration, uuid, text } from "@warlock.js/cascade";
import { User } from "app/users/models/user/user.model";
import { Post } from "../post.model";

export default Migration.create(Post, {
  author_id: uuid().references(User).onDelete("cascade").notNullable(),
  title: text().notNullable(),
  body: text().notNullable(),
});
```

`.references(User)` takes the model class directly — Cascade reads `User.table`. Pass the string `"users"` instead when the class would cause an import cycle.

Referential actions:

- **`"cascade"`** — delete/update the child rows when the parent goes.
- **`"setNull"`** — null out the FK column (the column must be `.nullable()`).
- **`"restrict"`** — block the parent delete/update while children exist.
- **`"noAction"`** — defer the check; database-dependent.

## Schema evolution — `Migration.alter`

New tables use `Migration.create`. Changing an existing table uses `Migration.alter` — and it's **fully declarative**. You don't write an imperative `up()`; you describe the change as a schema object. Each change is its own migration file with its own timestamp; you never edit a migration that's already run in production.

```ts
import { Migration, text, string, boolCol } from "@warlock.js/cascade";
import { Team } from "app/teams/models/team/team.model";
import { User } from "../user.model";

export default Migration.alter(User, {
  add: {
    phone: text().nullable(),
    email_verified: boolCol().default(false),
  },
  drop: ["legacy_token"],
  rename: { fname: "first_name" },
  modify: { email: string(320).notNullable() },

  addIndex: [{ columns: ["first_name", "last_name"], name: "idx_full_name" }],
  addUnique: [{ columns: ["email"] }],
  addForeign: [{ column: "team_id", references: Team, onDelete: "cascade" }],

  dropIndex: ["idx_old_lookup"],
  dropUnique: [["phone"]],
  dropForeign: [{ columnOrConstraint: "old_owner_id", referencesTable: "users" }],
});
```

Every key is optional — include only what the migration changes. The `AlterSchema` surface, grouped by intent:

**Columns**

- `add` — `ColumnMap`; new columns. Keys become column names.
- `drop` — string array of column names to drop.
- `rename` — `{ oldName: newName }`.
- `modify` — `ColumnMap`; redefine existing columns.

**Indexes and constraints**

- `addIndex` — `[{ columns, name?, options?: { include?, concurrently? } }]`.
- `dropIndex` — `[name | columnsArray]`.
- `addUnique` / `dropUnique` — same shape as index; drop by columns array.
- `addExpressionIndex` — `[{ expressions, name?, options? }]` (Postgres functional indexes like `lower(email)`).
- `addForeign` — `[{ column, references, on?, onDelete?, onUpdate? }]`; `references` takes a model class or table string.
- `dropForeign` — `[{ columnOrConstraint, referencesTable? }]`.
- `addCheck` / `dropCheck` — `[{ name, expression }]` / `[name]`.

**Specialized indexes**

- `addFullText` / `dropFullText` — full-text search indexes.
- `addGeoIndex` / `dropGeoIndex` — geo-spatial.
- `addVectorIndex` / `dropVectorIndex` — `[{ column, options: { dimensions, similarity } }]`.
- `addTTLIndex` / `dropTTLIndex` — `[{ column, expireAfterSeconds }]` (MongoDB-primary; auto-expire documents).

**Raw**

- `raw` — string or string array of SQL to run as part of the alter.

### Rollback for `alter`

`Migration.create` auto-infers its rollback (drop the table). **`Migration.alter` does not** — it can't always know the inverse of a `modify`. Provide a `down` in the options when the rollback matters:

```ts
export default Migration.alter(
  User,
  {
    add: { phone: text().nullable() },
  },
  {
    down() {
      this.dropColumn("phone");
    },
  },
);
```

For purely additive alters in environments where you never roll back, omitting `down` is fine — but be explicit about that choice rather than discovering it during an incident.

## The `up` / `raw` / `down` option hooks

Both `Migration.create` and `Migration.alter` accept `up`, `raw`, and `down` in their options. This is how you attach imperative logic (data backfills, trigger creation, custom SQL) **without** dropping to the class form:

```ts
import { Migration, text } from "@warlock.js/cascade";
import { User } from "../user.model";

export default Migration.alter(
  User,
  {
    add: { full_name: text().nullable() },
  },
  {
    raw: "UPDATE users SET full_name = first_name || ' ' || last_name",
    down() {
      this.dropColumn("full_name");
    },
  },
);
```

`raw` runs before the `up` hook. `up` runs after the declarative definitions are applied. This covers the overwhelming majority of "I need a bit of custom logic" cases — reach for the class form only when the migration is *primarily* imperative.

## The class form — the narrow escape hatch

When a migration is genuinely imperative — multi-step orchestration, conditional DDL, logic the declarative schema and option hooks can't express — extend `Migration`:

```ts
import { Migration } from "@warlock.js/cascade";

export default class extends Migration {
  public async up() {
    if (await this.hasIndex("idx_legacy")) {
      this.dropIndex("idx_legacy");
    }

    this.index(["status", "created_at"], "idx_status_recent", { concurrently: true });
  }

  public async down() {
    this.dropIndex("idx_status_recent");
  }
}
```

Use this only when the declarative form genuinely can't express the migration — a runtime `hasIndex` check, branching on existing schema, a sequence that has to interleave DDL and data in a specific order. If you find yourself writing a class-form migration that's just `add column` / `drop column`, it should have been `Migration.alter`.

There's also a lighter `migrate(Model, { up, down, name })` helper if you want the imperative hooks without a class declaration — same capability, less ceremony.

## Raw SQL — the lowest level

For DDL the structured API can't express at all (a stored procedure, a database-specific statement), the raw-statement form takes plain SQL with no model:

```ts
import { Migration } from "@warlock.js/cascade";

export default Migration.create({
  name: "add_price_check_constraint",
  up: "ALTER TABLE products ADD CONSTRAINT price_positive CHECK (price >= 0)",
  down: "ALTER TABLE products DROP CONSTRAINT price_positive",
});
```

`up` / `down` accept a single SQL string or an array of statements. You own the SQL and its rollback. Reserve this for what the structured methods genuinely can't reach — the structured form survives driver differences; raw does not.

(For a CHECK constraint specifically, `Migration.alter`'s `addCheck` is the structured path — prefer it. The raw form is the example here only because it's the clearest illustration of the escape hatch.)

## Transactions per migration

Postgres wraps each migration in a transaction by default (DDL is transactional in PG), so a mid-migration failure rolls back cleanly. MongoDB can't run DDL in a transaction — its migrations are non-transactional by nature.

Override per migration when an operation can't be transactional (Postgres `CREATE INDEX CONCURRENTLY` cannot run inside a transaction):

```ts
export default Migration.create(
  Product,
  { /* columns */ },
  {
    transactional: false,
    index: [{ columns: ["sku"], concurrently: true }],
  },
);
```

The data-source-wide default lives in the `migrations.transactional` connection option (see the [Configuration guide](../architecture-concepts/configuration.md)).

## Ordering and the timestamp prefix

Cascade runs migrations sorted by `createdAt`, extracted from the filename's timestamp prefix (`MM-DD-YYYY_HH-MM-SS-name.migration.ts`). Two migrations with the same timestamp have undefined relative order — keep them unique. Override explicitly when generating migrations outside the filename convention:

```ts
export default Migration.create(User, { /* ... */ }, { createdAt: "2026-05-16T10:00:00Z" });
```

## Programmatic use — the Operations API

`npx cascade migrate` is a thin wrapper over Cascade's **Operations API** — a small set of named functions over the migration runner. For CI scripts, test setup, container init, or any embedded use case, call the API directly:

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

Every CLI command maps to one Operations API function:

| CLI | Operations API | What it does |
| --- | -------------- | ------------ |
| `npx cascade migrate` | `runMigrations()` | Run every pending migration |
| `npx cascade migrate:rollback` | `rollbackMigrations()` | Roll back the last batch |
| `npx cascade migrate:rollback --batches 3` | `rollbackMigrations({ batches: 3 })` | Roll back the last `n` batches |
| `npx cascade migrate:rollback --all` | `rollbackMigrations({ all: true })` | Roll back everything |
| `npx cascade migrate -f` | `freshMigrate()` | Roll back everything, then re-run |
| `npx cascade migrate:list` | `listExecutedMigrations()` | Read the `_migrations` tracking table |
| `npx cascade migrate --sql` | `exportMigrationsSQL()` | Write `.up.sql` / `.down.sql` files; no DB writes |

Both the standalone `cascade` binary and warlock-core's CLI consume the same Operations API — one code path, two surfaces. Full signatures, options, and return types: [Operations API reference](../reference/operations-api.md). Standalone-CLI installation and `.env` configuration: [CLI guide](../cli/cli.md).

## Patterns

### Backfilling a non-nullable column

A new `notNullable` column with no default fails against a populated table. Add nullable, backfill via `raw`, then tighten — all in one `Migration.alter`, no class form:

```ts
export default Migration.alter(
  User,
  {
    add: { full_name: text().nullable() },
  },
  {
    raw: [
      "UPDATE users SET full_name = first_name || ' ' || last_name",
      "ALTER TABLE users ALTER COLUMN full_name SET NOT NULL",
    ],
    down() {
      this.dropColumn("full_name");
    },
  },
);
```

### Compound index on a large live table (Postgres)

```ts
export default Migration.create(
  Order,
  { /* columns */ },
  {
    transactional: false, // CONCURRENTLY can't run in a transaction
    index: [
      { columns: ["customer_id", "status"], name: "idx_orders_customer_status", concurrently: true },
    ],
  },
);
```

### GIN index on a JSON column

```ts
export default Migration.create(
  Event,
  {
    metadata: json().notNullable(),
  },
  {
    index: [{ columns: ["metadata"], using: "gin" }],
  },
);
```

### Vector column with a deferred index

For large initial seeds, declare the `vector()` column without an inline `.vectorIndex(...)`, bulk-load, then add the index in a follow-up `Migration.alter` with `addVectorIndex` — the build cost is amortised instead of paid per insert. See the [Vector search guide](../digging-deeper/vector-search.md).

## Going further

- **The kickoff version** — [Migrations intro](../getting-started/04-migrations-intro.md)
- **Connection-level migration config** (`transactional`, tracking table name): [Configuration guide](../architecture-concepts/configuration.md)
- **Vector index tuning** (`lists`, similarity metrics, `using: "hnsw"`): [Vector search guide](../digging-deeper/vector-search.md)
- **Multi-data-source migrations**: [Multi-database guide](../digging-deeper/multi-database.md)
