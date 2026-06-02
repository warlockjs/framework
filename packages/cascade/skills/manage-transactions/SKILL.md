---
name: manage-transactions
description: 'Wrap multi-statement work in `transaction(async () => {...})` — rollback on throw, commit on resolve, optional `isolation` level (Postgres), per-`dataSource` scope. Postgres native; MongoDB requires replica set. Triggers: `transaction`, `isolation`, `SERIALIZABLE`, `READ COMMITTED`, nested savepoints; "wrap two writes atomically", "transfer balance between accounts", "rollback on error", "MongoDB replica set transactions"; typical import `import { transaction } from "@warlock.js/cascade"`. Skip: single-row atomic ops without a transaction — `@warlock.js/cascade/perform-atomic-ops/SKILL.md`; per-source scope — `@warlock.js/cascade/manage-data-sources/SKILL.md`; competing patterns `mongoose.startSession`, `pg` `BEGIN` manually, `prisma.$transaction`, `typeorm` `QueryRunner`.'
---

# Use transactions

A transaction is a sequence of database operations that succeed or fail as one unit. Cascade wraps the driver-level transaction with a function-shaped API — pass a callback, throw to roll back, return to commit.

## Shape

```ts
import { transaction } from "@warlock.js/cascade";

await transaction(async () => {
  const account = await Account.where("id", fromId).firstOrFail();
  const target = await Account.where("id", toId).firstOrFail();

  await account.merge({ balance: account.get<number>("balance") - amount }).save();
  await target.merge({ balance: target.get<number>("balance") + amount }).save();
});
```

If either `.save()` throws, both are rolled back. If the callback returns, both are committed atomically.

## Return values

The callback's resolved value becomes the transaction's resolved value:

```ts
const order = await transaction(async () => {
  const created = await Order.create({...});
  await OrderItem.createMany(items.map(item => ({ ...item, order_id: created.id })));
  return created;
});
// order is the created Order
```

## Rollback on throw

Any thrown error inside the callback rolls back the entire transaction and re-throws to the caller:

```ts
try {
  await transaction(async () => {
    await user.save();
    if (someInvariantFails) {
      throw new Error("invariant violated");
    }
    await audit.save();
  });
} catch (error) {
  // both user and audit writes are rolled back; error propagates here
}
```

## MongoDB requires a replica set

MongoDB transactions only work on replica sets — a single-node `mongod` without `--replSet` will throw. For local dev, run a single-node replica set:

```bash
mongod --replSet rs0 --port 27017
# then in mongo shell:
rs.initiate()
```

Postgres has no such requirement — transactions work out of the box.

## Nesting

The function-shaped `transaction(fn)` is **not** nestable — calling it inside an already-open transaction is not supported. For nested scope on Postgres, drop to the manual API (`driver.beginTransaction()`) and use savepoints explicitly. For most app code, keep a single top-level `transaction(fn)` and let any inner failure abort the whole flow.

## Explicit rollback

The callback receives a transaction context; call `ctx.rollback()` to roll back without throwing:

```ts
await transaction(async (ctx) => {
  await user.save();
  if (!isValid) {
    ctx.rollback("validation failed");
  }
});
```

Throwing works too (and re-throws to the caller); `ctx.rollback()` is the non-throwing path.

## Isolation level (Postgres)

Default is the driver's default (typically `READ COMMITTED`). Request a different level via `isolationLevel`:

```ts
await transaction(async () => {
  /* ... */
}, { isolationLevel: "SERIALIZABLE" });
```

On `SERIALIZABLE`, Postgres may abort with a serialization failure when concurrent transactions conflict — wrap in retry logic at the caller.

## Outside the transaction

Once the callback returns, the transaction is committed. Subsequent calls — including reads — see the committed state. Don't try to "share" a model instance between inside-transaction and outside contexts; reload outside if you need fresh state.

## Side effects after commit — the outbox pattern

For "side effects must only happen if the transaction succeeded" (publish to a queue, send an email, write to a search index), don't run them inside the transaction. Use the outbox pattern: write a row to an outbox table inside the transaction, dispatch from the outbox in a separate worker after commit.

## Things NOT to do

- Don't call external APIs (HTTP, queues, file writes) inside a transaction. Long-running side effects extend the lock; failures don't roll back the external call.
- Don't use a single-node mongod for transactions. Run a replica set even in dev.
- Don't `try/catch` and swallow inside a transaction — the catch defeats the rollback. If you must, re-throw after handling.
- Don't pass models loaded outside the transaction into it expecting fresh reads. Reload inside.

## See also

- [`@warlock.js/cascade/perform-atomic-ops/SKILL.md`](@warlock.js/cascade/perform-atomic-ops/SKILL.md) — atomic single-document ops without a full transaction
- [`@warlock.js/cascade/manage-data-sources/SKILL.md`](@warlock.js/cascade/manage-data-sources/SKILL.md) — transactions run on the default source
