---
name: manage-data-sources
description: 'Configure multiple databases — register each via `connectToDatabase({ name, driver, database, isDefault })`, assign a model with `static dataSource = "name"`, route a migration with `dataSource` on the migration class, inspect via `dataSourceRegistry.get(name)` / `getAllDataSources()`. The first (or `isDefault: true`) source is the default. Triggers: `connectToDatabase`, `dataSourceRegistry`, `dataSourceRegistry.get`, `getAllDataSources`, `static dataSource`; "multi-database app", "per-tenant DB", "analytics on separate DB"; typical import `import { connectToDatabase, dataSourceRegistry } from "@warlock.js/cascade"`. Skip: per-source migrations — `@warlock.js/cascade/write-migration/SKILL.md`; transaction scope — `@warlock.js/cascade/manage-transactions/SKILL.md`; competing patterns `mongoose.createConnection`, `typeorm` `DataSource`, `prisma` multi-schema.'
---

# Manage data sources

Most apps run against a single database, and Cascade's defaults assume that. When you need multiple — analytics on a separate DB, per-tenant DBs — register each one and bind models to the right source.

## Register sources at boot

`connectToDatabase()` builds the driver, registers the data source, and connects. Call it once per database:

```ts
import { connectToDatabase } from "@warlock.js/cascade";

await connectToDatabase({
  name: "primary",
  driver: "postgres",
  database: "app",
  host: "localhost",
  port: 5432,
  username: "app",
  password: "secret",
  isDefault: true, // the default source for models that don't pin one
});

await connectToDatabase({
  name: "analytics",
  driver: "postgres",
  database: "analytics",
  host: "analytics-host",
});

await connectToDatabase({
  name: "logs",
  driver: "mongodb",
  database: "logs",
  uri: "mongodb://localhost:27017",
});
```

The first source registered becomes the default unless another passes `isDefault: true`. (Lower-level: `dataSourceRegistry.register({ name, driver, isDefault })` if you build the driver yourself — `register` takes a `DataSourceOptions` object whose `driver` is a `DriverContract` instance, and constructs the `DataSource` for you.)

## Assign a model to a source

```ts
@RegisterModel()
export class AnalyticsEvent extends Model<AnalyticsEventSchema> {
  public static table = "analytics_events";
  public static schema = analyticsEventSchema;
  public static dataSource = "analytics"; // ← goes to the analytics DB
}

@RegisterModel()
export class LogEntry extends Model<LogEntrySchema> {
  public static table = "logs";
  public static schema = logEntrySchema;
  public static dataSource = "logs"; // ← goes to MongoDB
}
```

`static dataSource` takes the registered name (or a `DataSource` instance). Models without it use the default. Same query API; different storage. There is no per-query `Model.using(name)` override — the binding lives on the class.

## Migrations per data source

A migration class can pin its target source:

```ts
import { Migration } from "@warlock.js/cascade";

export default class CreateEventsTable extends Migration {
  public readonly table = "analytics_events";
  public readonly dataSource = "analytics";

  public up(): void {
    this.createTable();
    this.id();
    this.string("type");
    this.timestamps();
  }

  public down(): void {
    this.dropTable();
  }
}
```

See [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md) for the migration shape.

## Transactions and data sources

The top-level `transaction(fn)` helper runs on the **default** source's driver — it does not take a source name. To transact against a non-default source, reach for that source's driver directly (`dataSourceRegistry.get("analytics").driver.transaction(...)`). Transactions can't span two sources; coordinate at the application level (saga / outbox) if you need that.

```ts
await transaction(async () => {
  // runs on the default source
  await Order.create({ ... });
  await OrderItem.createMany(items);
});
```

## Multi-tenant per-tenant database

For strict tenant isolation, register a source per tenant once, then bind at the model layer (or resolve the model class per tenant):

```ts
async function ensureTenantSource(tenantId: string) {
  try {
    dataSourceRegistry.get(tenantId); // throws if not registered
  } catch {
    const config = await loadTenantConfig(tenantId);
    await connectToDatabase({ name: tenantId, ...config, isDefault: false });
  }
}
```

Register each tenant source once and reuse it — re-registering the same name re-creates the source.

## Inspection

```ts
dataSourceRegistry.get("analytics"); // the DataSource instance (throws if missing)
dataSourceRegistry.get(); // the default DataSource
dataSourceRegistry.getAllDataSources(); // DataSource[] — every registered source
```

There is no `has(name)` / `list()` / `setDefault()` — guard with a `try/catch` around `get(name)`, iterate `getAllDataSources()`, and set the default via `isDefault` at registration.

## Things NOT to do

- Don't call `dataSourceRegistry.register("name", config)` — `register` takes a single `DataSourceOptions` object (`{ name, driver, isDefault }`, `driver` being a built `DriverContract`); for the common case use `connectToDatabase({ name, ... })`.
- Don't reach for `Model.using(name)` / `setDefault` / `has` / `list` — they don't exist. Bind via `static dataSource`, inspect via `get` / `getAllDataSources`.
- Don't span a transaction across two data sources. Use a saga / outbox pattern.
- Don't write to a read replica. Most replicas reject writes; the data is overwritten on the next replication.

## See also

- [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md) — per-source migrations
- [`@warlock.js/cascade/manage-transactions/SKILL.md`](@warlock.js/cascade/manage-transactions/SKILL.md) — transactions run on the default source
