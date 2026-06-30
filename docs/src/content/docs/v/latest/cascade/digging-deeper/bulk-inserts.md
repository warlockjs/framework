---
title: "Bulk inserts"
sidebar:
  order: 13
  label: "Bulk inserts"
---

When you need to insert hundreds or thousands of rows at once — importing a CSV, seeding fixtures, back-filling a table — calling `Model.create(...)` in a loop is the wrong tool. Each `create` is its own round-trip, and `await`-ing them sequentially is slow while firing them all in parallel can open thousands of concurrent inserts and exhaust the connection pool.

`Model.createMany(data, options?)` is the bulk-insert primitive. It chunks the work so a huge array can't overwhelm the driver, and offers two strategies depending on whether you need per-row lifecycle hooks or raw throughput.

## The signature

```ts
Model.createMany(
  data: Partial<Schema>[],
  options?: { batchSize?: number; bulk?: boolean },
): Promise<Model[]>
```

```ts
import { User } from "../models/user";

// Default: per-row save(), chunked in batches of 500
const users = await User.createMany(rows);

// Bulk: one multi-row INSERT per chunk, 10–100× faster
const users = await User.createMany(rows, { bulk: true, batchSize: 1000 });
```

Both strategies return the created model instances. An empty array is a no-op that never touches the driver.

The second `options` argument is new — the old `createMany(data)` call still works unchanged (it's the default path with `batchSize: 500`).

## The two strategies

### Default — per-row `save()` (preserves the full lifecycle)

With no `bulk` option (or `bulk: false`), every row is persisted through the normal `save()` path, so the **complete model lifecycle runs for each row**:

- lifecycle events: `saving` / `creating` / `created` / `saved`
- instance hooks (`onCreating`, `onCreated`, …)
- casts, timestamps, defaults, generated ids
- sync operations

Rows are processed in **sequential chunks of `batchSize`** (default 500), and each chunk runs under a single `Promise.all`. So an array of millions of rows is inserted a chunk at a time — never opening millions of concurrent inserts at once — while still firing every hook and event you'd get from calling `create()` row by row.

```ts
// Hooks, events, casts, sync all fire — just chunked so the pool stays sane
const users = await User.createMany(importedRows, { batchSize: 200 });
```

This is the right default whenever your model relies on lifecycle behaviour: slugging in `onCreating`, search-index updates in `onCreated`, computed columns via casts, and so on.

### Bulk — native `insertMany` (maximum throughput)

Pass `bulk: true` and each chunk is routed to the driver's **native multi-row insert** (`insertMany`) — one `INSERT ... VALUES (...),(...)` per chunk on SQL, one `insertMany` on MongoDB — for **10–100× the throughput** of the default path.

The tradeoff is that the bulk path **skips the per-row save lifecycle**:

- **NOT emitted:** `saving` / `creating` / `created` / `saved` events, instance hooks, and sync operations.
- **Still applied:** casts, timestamps, defaults, and id-generation. Each row is still prepped through the same writer pipeline, so the persisted columns match the default path exactly.

Driver-returned values (the generated `_id`, timestamps, SQL `RETURNING *`) are merged back onto the returned models, so the instances you get back reflect the persisted state.

```ts
// 10k rows as 10 multi-row INSERTs — no per-row hooks, but cast/timestamp/id still applied
const products = await Product.createMany(rows, { bulk: true, batchSize: 1000 });
```

Reach for `bulk: true` when the rows don't need lifecycle behaviour — flat reference data, fixtures, an import where you'll re-index in one pass afterwards — and you care about speed.

## `batchSize` — chunk size on both paths

`batchSize` controls the chunk size on **both** strategies; it defaults to **500** (`DEFAULT_CREATE_MANY_BATCH_SIZE`). A value `<= 0` falls back to the default.

- On the **default path**, `batchSize` caps how many rows run concurrently under one `Promise.all` — keeping the connection pool from being flooded.
- On the **bulk path**, `batchSize` caps how many rows go into a single multi-row `INSERT`, keeping the generated statement under the database's bind-parameter ceiling (Postgres caps at 65535 parameters, so `batchSize × columns` must stay under it).

Tune it down for wide tables (many columns per row) and up for narrow ones.

## MongoDB: one id reservation per chunk

On MongoDB, auto-increment ids come from a counter collection (`MasterMind`). A naive multi-row insert would hit that counter once **per row** — N round-trips. `createMany` instead reserves a **contiguous block of ids in a single atomic operation per chunk** and hands them out locally, so a 500-row chunk is one counter op, not 500. This applies to **both** the default and bulk paths.

The block path engages automatically when the model uses plain auto-increment. It steps aside (back to per-row generation) when:

- the model disables auto-generation (`autoGenerateId = false`) — e.g. SQL, which uses native `SERIAL`/`AUTO_INCREMENT` and never touches the counter;
- the model uses a **random** `initialId` / `increment` — a random stride can't form a contiguous block;
- a row already carries a caller-supplied `id` — those rows are skipped, so the block is sized to exactly the rows that need one (no gaps).

:::caution — id reservation is not transactional
Like SQL `SERIAL`, the counter advance is a standalone, immediately-durable write — it does **not** roll back with a surrounding transaction. If a `createMany` inside a transaction aborts, the inserted rows are undone but the reserved id block is consumed and left as a **gap** in the sequence. Gaps are normal for a sequence; don't assume ids are contiguous across failed transactions.
:::

## Choosing a strategy

| Need                                              | Use                          |
| ------------------------------------------------- | ---------------------------- |
| Per-row hooks / events / sync                     | default (`createMany(rows)`) |
| Casts, timestamps, defaults, generated ids        | either — both apply them     |
| Maximum throughput, no per-row lifecycle          | `{ bulk: true }`             |
| Cap concurrency / statement size                  | `{ batchSize: n }` on either |

## Use from a seeder

A seeder receives a `batchSize` in its run context (from the seeder's own `batchSize` field), so you can forward it straight through:

```ts title="src/app/products/seeds/dev-products.seed.ts"
import { seeder } from "@warlock.js/core";
import { Product } from "../models/product";

export default seeder({
  name: "dev-products",
  batchSize: 1000,
  async run({ track, batchSize }) {
    const rows = buildManyRows();
    track(await Product.createMany(rows, { batchSize }));
  },
});
```

See the [Seeding guide](/v/latest/core/digging-deeper/seeding/) in the Core docs for the full seeder context.

## Gotchas

- **`bulk: true` skips hooks and events.** If your model slugs in `onCreating` or indexes in `onCreated`, those won't run on the bulk path. Either use the default path or run the side effects in one pass after the insert.
- **The bulk path still validates and casts.** Don't reach for it to skip validation — it runs the same writer prep per row; only the lifecycle *events/hooks/sync* are skipped.
- **Mind the bind-parameter ceiling.** On Postgres, `batchSize × columns` must stay under 65535. The 500 default is safe for typical tables; lower it for very wide rows.
- **An empty array is a no-op.** `createMany([])` returns `[]` without touching the driver.

## See also

- **[CRUD basics](../the-basics/01-crud-basics.md)** — single-record create / update / delete.
- **[Transactions](./transactions.md)** — wrap a multi-step bulk import so it commits or rolls back as a unit.
- **[Events and hooks](../architecture-concepts/events-and-hooks.md)** — the lifecycle the default path fires (and the bulk path skips).
- **[Seeding guide](/v/latest/core/digging-deeper/seeding/)** — forwarding `batchSize` from a seeder into `createMany`.
