---
title: "Multiple databases"
sidebar:
  order: 9
  label: "Multiple databases"
---

Most apps run against a single database, and Cascade's defaults assume that. But some apps split data across two or more — a primary OLTP database plus a read-only analytics warehouse, a per-tenant database for multi-tenant SaaS, or a separate cache-shaped database for ephemeral state.

This guide covers Cascade's **data source registry** model: registering multiple data sources, routing models, and the limits of cross-data-source operations.

## Mental model — the data source registry

When you call `connectToDatabase(...)`, two things happen:

1. A `DataSource` instance is created from your config.
2. It's registered with the **global `dataSourceRegistry`** under the `name` you provided (default `"default"`).

Models reach their data source through the registry. By default, they look up the *default* data source. Override per model when you need a different one.

```
                ┌─────────────────────────────┐
                │   dataSourceRegistry        │
                │   ───────────────────       │
                │   "primary"   → DS<pg>   ◀──┼── isDefault: true
                │   "analytics" → DS<pg>      │
                │   "cache"     → DS<mongo>   │
                └─────────────────────────────┘
                          ▲          ▲          ▲
                          │          │          │
                ┌─────────┴───┐ ┌────┴────┐ ┌──┴──────┐
                │ User        │ │ Event   │ │ Session │
                │ (default)   │ │ ("...")  │ │ ("...")  │
                └─────────────┘ └─────────┘ └─────────┘
```

## Registering multiple data sources

Call `connectToDatabase` once per source, each with a unique `name`:

```ts
import { connectToDatabase } from "@warlock.js/cascade";

await connectToDatabase({
  name: "primary",
  driver: "postgres",
  database: "myapp",
  isDefault: true,                 // models without `static dataSource` use this
});

await connectToDatabase({
  name: "analytics",
  driver: "postgres",
  database: "warehouse",
  isDefault: false,
  clientOptions: { max: 5 },       // smaller pool — analytics is bursty + low-frequency
});

await connectToDatabase({
  name: "cache",
  driver: "mongodb",
  database: "cache",
  isDefault: false,
});
```

The first call with `isDefault: true` wins as the registry's default. Subsequent calls don't dethrone it unless you pass `isDefault: true` again — keep it explicit so the precedence is obvious in code review.

## Routing a model — `static dataSource`

Point a model at a non-default data source with the `static dataSource` property:

```ts
@RegisterModel()
export class AnalyticsEvent extends Model<EventSchema> {
  public static table = "events";
  public static schema = eventSchema;
  public static dataSource = "analytics"; // <- routes every query through "analytics"
}

@RegisterModel()
export class Session extends Model<SessionSchema> {
  public static table = "sessions";
  public static schema = sessionSchema;
  public static dataSource = "cache";
}
```

Every `AnalyticsEvent.query()`, `.find()`, `.create()` now runs against the `"analytics"` data source. Same query API, different physical database. `User` (no `static dataSource`) keeps using the registry default (`"primary"`).

## Reaching a non-default data source explicitly

For one-off queries against a non-default data source without changing the model:

```ts
import { dataSourceRegistry } from "@warlock.js/cascade";

const analyticsDs = dataSourceRegistry.get("analytics");
const driver      = analyticsDs.driver;

const result = await driver.find("events", { type: "page_view" });
```

This drops below the model API to the raw driver. Useful for diagnostic scripts, custom DDL, or migrations that need to touch a specific data source. For everyday queries, route the model with `static dataSource` and use the structured API.

## What works across data sources — and what doesn't

The honest constraints:

| Operation | Works across data sources? | Notes |
| --------- | ------------------------- | ----- |
| Models on different sources | ✅ Yes | Each model uses its registered source |
| `Model.find()` / `.query()` / `.create()` | ✅ Yes | Always within the model's own source |
| **Joins** (`.join()`, `.with()`, `.joinWith()`) across sources | ❌ No | A join is a single-source operation by definition |
| **Transactions** across sources | ❌ No | Each transaction belongs to one driver/connection |
| **Sync system** across sources | ⚠️ Partial | Sync events propagate, but the bulk update is single-source — embedding `User` (cache) into `Comment` (primary) requires the target source to handle the update |
| **Cross-source consistency** | ❌ Not guaranteed | Two writes to two sources are independent — no two-phase commit |

The pattern that scales: **keep related data on the same data source**. Cross-source references are *fine* as long as you don't expect joins, transactions, or atomic consistency. Treat the second data source as a separate system you happen to be calling.

## Multi-tenant — one database per tenant

A common ask: *every tenant gets their own physical database, register one per tenant.* Cascade supports this — the registry can hold N data sources — but the model surface gets tricky because `static dataSource` is fixed at class-definition time.

Two practical shapes:

### Shape 1 — Many data sources, one model class

Register a data source per tenant; resolve the right one per request:

```ts
// At boot — register all known tenants
for (const tenant of await loadTenantConfigs()) {
  await connectToDatabase({
    name: `tenant:${tenant.id}`,
    driver: "postgres",
    database: tenant.databaseName,
    isDefault: false,
  });
}
```

…then per request, use the explicit-driver path against the right source:

```ts
const ds = dataSourceRegistry.get(`tenant:${currentTenantId()}`);
const users = await ds.driver.find("users", { active: true });
```

You lose the high-level model API for the per-tenant queries (since `static dataSource` is fixed), but you get strict physical isolation. Use this when tenant data must live in different physical databases for compliance, latency, or scale reasons.

### Shape 2 — One database, tenant-scoped via global scope

Most multi-tenant apps don't need per-tenant databases. A `tenantId` column plus a global scope is dramatically simpler:

```ts
User.addGlobalScope("tenant", q => q.where("tenantId", currentTenantId()));
```

Every query is automatically filtered to the current tenant. See the [Scopes guide](./scopes.md#tenant-scoping-with-async-context) for the full pattern.

Shape 2 is the default; reach for Shape 1 only when physical isolation is a hard requirement.

## Per-data-source defaults

Each data source's config (`connectToDatabase`) has its own `modelOptions`, `migrationOptions`, `defaultDeleteStrategy`, etc. — independent of every other data source's settings:

```ts
await connectToDatabase({
  name: "primary",
  driver: "postgres",
  database: "main",
  modelOptions: {
    namingConvention: "snake_case",
    deleteStrategy: "soft",
  },
});

await connectToDatabase({
  name: "cache",
  driver: "mongodb",
  database: "cache",
  modelOptions: {
    namingConvention: "camelCase",
    deleteStrategy: "permanent", // cache doesn't soft-delete
  },
});
```

Models routed to `"cache"` get the camelCase + permanent-delete defaults; models on `"primary"` get snake_case + soft-delete. Per-model statics still win over their data source's defaults.

## Reaching the right driver helpers

The top-level helpers (`getDatabaseDriver()`, `transaction()`) target the **default** data source. For non-default sources, go through the registry:

```ts
import { dataSourceRegistry } from "@warlock.js/cascade";

const analyticsDriver = dataSourceRegistry.get("analytics").driver;
await analyticsDriver.transaction(async ctx => { ... });
```

The transaction is scoped to that data source — operations against `"primary"` inside the callback are *not* part of this transaction.

## Migrations across data sources

Migrations live per-data-source — each source has its own `_migrations` tracking table (configurable via the `migrations.table` connection option). The CLI runs migrations against the default source by default; targeting a specific source requires either a flag or a separate config-loading entry point depending on your CI setup.

For now, the simplest pattern is: keep migrations folders per data source (`migrations/primary/`, `migrations/analytics/`) and run the migrate command per source at deploy time, pointing at the right folder + config.

## Going further

- **The full `connectToDatabase` option surface** for any single data source: [Configuration guide](../architecture-concepts/configuration.md)
- **Tenant scoping via global scopes** (the lower-overhead alternative to per-tenant databases): [Scopes guide](./scopes.md)
- **Single-source transactions** (which don't cross data sources): [Transactions guide](./transactions.md)
- **Migrations intro** for the per-source `_migrations` story: [Migrations intro](../getting-started/04-migrations-intro.md)
