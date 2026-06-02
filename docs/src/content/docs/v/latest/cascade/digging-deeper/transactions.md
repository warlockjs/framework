---
title: "Transactions"
sidebar:
  order: 3
  label: "Transactions"
---

A transaction is a sequence of database operations that succeed or fail as one unit. Either everything happens, or nothing does. Cascade exposes transactions through a single utility: `transaction(async ctx => {...})`. Same callback shape across Postgres and MongoDB; the driver differences are handled underneath.

The recommended pattern is the **callback form**: wrap your work in `transaction(...)` and let Cascade handle commit, rollback, and cleanup.

## The callback pattern (recommended)

```ts
import { transaction } from "@warlock.js/cascade";

const order = await transaction(async ctx => {
  const newOrder = await Order.create({ userId, total });

  for (const item of items) {
    await OrderLine.create({ orderId: newOrder.id, ...item });
  }

  await User.whereId(userId).increment("orderCount");

  return newOrder;
});
```

`transaction` is a thin shorthand over the current data source's driver. If you have multiple data sources (rare), you can still reach the driver directly via `getDatabaseDriver().transaction(...)`.

What happens:

- **Auto-commit on success.** If the callback returns normally, the transaction commits and the return value flows back out.
- **Auto-rollback on error.** Any thrown error rolls back and re-throws to the caller.
- **Cleanup guaranteed.** Session / connection cleanup happens whether you committed or rolled back.

This is the right shape for ~95% of transaction use. You don't manage the session, you don't remember to commit, you don't need a try/finally.

## Explicit rollback

If the work inside the callback decides the transaction shouldn't commit (validation failure, business-rule veto), call `ctx.rollback(reason?)`:

```ts
await transaction(async ctx => {
  const balance = await Account.whereId(accountId).value<number>("balance");
  if (balance < amount) {
    ctx.rollback("Insufficient funds");
  }

  await Account.whereId(accountId).decrement("balance", amount);
  await Transfer.create({ accountId, amount, type: "withdrawal" });
});
```

`ctx.rollback()` throws a `TransactionRollbackError` immediately — the callback exits, Cascade rolls back, and the error is re-thrown to the outer caller. Catch it explicitly if you want to handle the rollback case without a hard failure:

```ts
try {
  await transaction(async ctx => { ... });
} catch (err) {
  if (err instanceof TransactionRollbackError) {
    // soft-fail UX
  } else {
    throw err;
  }
}
```

## Driver caveats

**MongoDB requires a replica set.** A single-node MongoDB (`mongod` with no replica set config) doesn't support transactions at all — the driver throws when you try. For local dev, run a single-node replica set (`mongod --replSet rs0` + initial `rs.initiate()`). Production clusters are usually replica sets by default.

**Postgres just works.** No setup needed beyond a regular connection.

**Nested transactions are not supported.** A `transaction()` inside another `transaction()` will throw. If you need nested-savepoint semantics, drop to the manual form (`beginTransaction`) and use the driver's native savepoint API. Most apps don't need this.

## The manual pattern (rare)

When you need control that the callback form doesn't give — multi-step orchestration across services that each manage part of the work — drop to the driver's manual API:

```ts
import { getDatabaseDriver } from "@warlock.js/cascade";

const driver = getDatabaseDriver();
const tx = await driver.beginTransaction();
try {
  await driver.insert("users", { name: "Alice" });
  await driver.insert("audit_logs", { ... });
  await tx.commit();
} catch (err) {
  await tx.rollback();
  throw err;
}
```

You own commit, rollback, and cleanup. The pattern is more error-prone (forget to commit in one branch and you've leaked a session); reach for it only when the callback form genuinely can't express your flow.

## What runs inside the transaction

Anything that goes through the driver during the callback is part of the transaction. That includes:

- `Model.create()` / `model.save()` / `model.destroy()` — all driver writes.
- Query builder reads — `User.where(...).first()`, etc.
- Direct driver calls — `driver.insert(...)`, `driver.update(...)`, etc.

Operations *outside* the driver — file writes, HTTP calls, cache invalidations — are **not** transactional. If you need them to roll back on transaction failure, do the irreversible work *after* the transaction completes:

```ts
const order = await driver.transaction(async ctx => {
  const o = await Order.create({ ... });
  await OrderLine.create({ orderId: o.id, ... });
  return o;
});

// Only runs if the transaction committed
await sendOrderConfirmationEmail(order);
```

The pattern: transaction owns the database; external side effects fire after commit.

```ts
import { transaction } from "@warlock.js/cascade";

const order = await transaction(async ctx => {
  const o = await Order.create({ ... });
  await OrderLine.create({ orderId: o.id, ... });
  return o;
});

// Only runs if the transaction committed
await sendOrderConfirmationEmail(order);
```

## Events inside transactions

Model lifecycle events (`onSaving`, `onCreated`, `onDeleted`, ...) fire as they normally would inside a transaction. If you have an `onCreated` listener that emails the user, **the email goes out even if the transaction later rolls back**.

For that reason, side effects that should respect transaction outcome belong **after** the transaction, not in lifecycle listeners. Or queue them inside the transaction and dispatch on commit:

```ts
const tasks: Array<() => Promise<void>> = [];

User.events().onCreated(async user => {
  tasks.push(() => sendWelcomeEmail(user.get("email")));
});

await transaction(async ctx => {
  await User.create({ ... });
  // tasks accumulates here, but doesn't execute yet
});

// After commit, drain the queue
for (const task of tasks) await task();
```

A proper outbox / job queue is the production-quality version of this pattern; in-memory closures work for simple cases.

## Patterns

### Try-with-fallback

```ts
async function transferFunds(from: string, to: string, amount: number) {
  return transaction(async ctx => {
    const fromBalance = await Account.whereId(from).value<number>("balance");
    if (fromBalance < amount) ctx.rollback("Insufficient funds");

    await Account.whereId(from).decrement("balance", amount);
    await Account.whereId(to).increment("balance", amount);
    await Transfer.create({ from, to, amount });
  });
}
```

### Bulk operations with all-or-nothing semantics

```ts
await transaction(async ctx => {
  for (const row of csvRows) {
    await User.create(row); // any one failure rolls everything back
  }
});
```

For large bulk imports, consider chunking the transactions — one giant transaction holding a million inserts will tie up locks and replication far longer than ten smaller transactions of 100k each.

### Reading-then-writing safely

```ts
await transaction(async ctx => {
  const post = await Post.whereId(id).first();
  if (!post) ctx.rollback("Post not found");

  // Inside the transaction, the read and write happen with consistent locking
  post.increment("viewCount");
  await post.save();
});
```

For pure counter-style increments, prefer the **query-builder** form — `Post.whereId(id).increment("viewCount")` is a single statement with no read race, no transaction needed.

## Going further

- **Atomic increments / decrements** (race-safe without a transaction): [Querying essentials](../the-basics/02-querying.md) + [Query Builder API reference](../reference/query-builder-api.md#incrementfield-amount--decrementfield-amount)
- **Outbox pattern for side-effects-after-commit** — recipe
- **MongoDB replica-set setup for local dev** — recipe
