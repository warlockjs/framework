---
title: "Atomic operations"
sidebar:
  order: 2
  label: "Atomic operations"
---

When two requests want to change the same row at the same time, you need atomicity — a guarantee that one operation completes before the other reads. Cascade exposes two distinct increment/decrement APIs, and they have **different concurrency stories** that are easy to confuse.

This guide is short and direct: it explains the two APIs, when to reach for each, and the patterns for race-safe counters, rate limits, and similar high-write hot paths.

## The two APIs side-by-side

```ts
// 1. Instance form — read-modify-write on the model
user.increment("loginCount");
await user.save();

// 2. Query-builder form — single atomic UPDATE
await User.whereId(user.id).increment("loginCount");
```

They look almost identical. They behave very differently under concurrency:

| Aspect | Instance form | Query-builder form |
| ------ | ------------- | ------------------ |
| **Mechanics** | reads current value into memory, adds, calls `.save()` | single `UPDATE ... SET col = col + 1` statement |
| **Round-trips** | 2 (read + write) | 1 (write only) |
| **Race-safe** | ❌ Lost-update window if another writer modifies the row between read and save | ✅ Atomic at the database level |
| **Fires lifecycle events** | ✅ `saving`/`updating`/`saved` etc. | ❌ Bypasses model events |
| **Best for** | Single-writer flows where the model is already loaded | Multi-writer counters, rate limits, view counts |

## The lost-update problem (instance form)

```ts
// Process A
const user = await User.find(123);     // loginCount = 5
user.increment("loginCount");          // user.data.loginCount becomes 6 in memory
                                        // (Process B does the same thing here)
await user.save();                     // writes 6

// Process B
const user = await User.find(123);     // loginCount = 5 (still!)
user.increment("loginCount");          // user.data.loginCount becomes 6 in memory
await user.save();                     // writes 6 — A's increment is lost
```

Two increments, one survived. Classic concurrency bug, expensive to detect (the counter just *runs a bit slow*), expensive to reproduce. The instance form is fine when only one process ever writes to the row in a given window — validated user profile edits, single-writer flows — but **wrong for counters under load**.

## The atomic form (query builder)

```ts
await User.whereId(123).increment("loginCount");
// → UPDATE users SET loginCount = loginCount + 1 WHERE id = 123
```

One statement. The database serializes concurrent updates. Two processes both calling this against the same row produce **two increments**, not one. The cost is one round-trip and zero events.

This is the form you want for:

- **Counters** — page views, login counts, request counts, anything that climbs.
- **Rate limits** — increment a counter per (user, minute), reject if over threshold.
- **Inventory decrements** — `Product.whereId(id).decrement("stock")` (combine with a `.where("stock", ">", 0)` guard if you need to refuse oversells).
- **Bulk atomic adjustments** — `User.where("status", "active").incrementMany("score", 1)` adjusts every matching row atomically.

## Variants — `increment`, `decrement`, `incrementMany`, `decrementMany`

```ts
// Single row, amount defaults to 1
await User.whereId(id).increment("loginCount");
await Product.whereId(id).decrement("stock", 1);

// Many rows
await User.where("status", "active").incrementMany("score", 5);
await Product.where("expired", true).decrementMany("stock", 1);
```

The "many" variants return the **count of rows modified**, not the new value. The single-row variants return the **new value**:

```ts
const newCount = await User.whereId(id).increment("loginCount");
const updatedRows = await User.where("status", "active").incrementMany("score", 5);
```

## Patterns

### Race-safe counter

```ts
async function recordPageView(pageId: string) {
  return Page.whereId(pageId).increment("viewCount");
}
```

Single statement. No race. Don't reach for transactions or instance loads for this — they're slower and not needed.

### Rate limiter

```ts
async function tryConsume(userId: string, limit: number): Promise<boolean> {
  const newCount = await RateLimit
    .where({ userId, window: currentMinute() })
    .increment("requests");
  return newCount <= limit;
}
```

The increment is atomic; the check happens on the returned value. If the row didn't exist yet, you need an upsert step before the increment — that's the recipe in the rate-limit pattern (typically `findOrCreate` + `increment`).

### Inventory decrement with guard

```ts
async function reserveStock(productId: string, qty: number): Promise<boolean> {
  const rows = await Product
    .where("id", productId)
    .where("stock", ">=", qty)
    .decrementMany("stock", qty);
  return rows > 0; // true = reserved; false = insufficient stock
}
```

The `where("stock", ">=", qty)` is part of the same UPDATE. If two processes both try to reserve the last unit, only one row matches the `stock >= 1` predicate when the row gets locked. The other gets back zero rows modified.

This is much cheaper than a transaction with read-then-write — the database does the check-and-update atomically in one statement.

### Bulk score adjustment

```ts
// Give every active user a daily login bonus
await User.where("status", "active").incrementMany("score", 10);
```

One statement updates every matching row. No N+1, no loop. Returns the number of rows modified.

## When the instance form is the right answer

The instance form isn't wrong — it just has a narrower use case. Reach for it when:

- **You already have the model loaded** and want to update a few fields atomically together. `user.increment("loginCount")`, `user.merge({ lastLoginAt: new Date() })`, then one `.save()` writes both.
- **You need lifecycle events to fire** — audit listeners, cache invalidators. The query-builder form bypasses them; the instance form fires `saving`/`updating`/`saved`.
- **The model is in a single-writer context** — request-scoped, only one process can edit this row in this window.

```ts
// Reasonable instance use
const user = await User.find(123);

user.increment("loginCount");
user.merge({
  lastLoginAt: new Date(),
  lastLoginIp: request.ip,
});

await user.save();
// fires saving/updating/saved with all dirty fields visible to listeners
```

For *just* the counter under load, prefer the query-builder form.

## Atomicity beyond increments

The query-builder atomic story extends to other shapes too:

- **Atomic upsert** — `Model.upsert(...)` (where supported) — single-statement insert-or-update.
- **`whereColumn` updates** — `Product.whereColumn("stock", ">", "reserved").update({...})` — update only when a row-level invariant holds.
- **Transactions** — wrap multiple atomic operations as one unit. See [Transactions guide](./transactions.md).

Atomicity composes: a transaction wrapping several query-builder increments is **race-safe and event-firing** (events still fire for any `Model.create` / `instance.save()` inside; the bare `.increment()` calls remain event-free regardless of transaction wrapping).

## Going further

- **Lifecycle events** that fire (or don't) per API: [Events and hooks guide](../architecture-concepts/events-and-hooks.md)
- **Transactions** for multi-step atomicity: [Transactions guide](./transactions.md)
- **Race-free upserts** and conditional updates: [Querying essentials](../the-basics/02-querying.md) + [Query Builder API reference](../reference/query-builder-api.md)
- **Inventory / rate-limit recipes** *(planned)* — the productionised patterns for these
