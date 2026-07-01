---
name: manage-transactions
description: 'Wrap multi-statement work in `transaction(async () => {...})` — rollback on throw, commit on resolve, optional `isolation` level (Postgres), per-`dataSource` scope. Also the home for transaction-aware raw SQL (`Model.raw` / `DataSource.raw` → `RawQueryResult`) and Postgres native-array column handling (`JSONB[]` / `TEXT[]` / `INTEGER[]` auto-detected via schema introspection on connect; `nativeArrayColumns` is an optional override). Postgres native; MongoDB requires replica set. Triggers: `transaction`, `isolation`, `SERIALIZABLE`, `READ COMMITTED`, nested transaction, flat nesting, nested savepoints, `Model.raw`, `DataSource.raw`, raw SQL, `RawQueryResult`, `nativeArrayColumns`, `JSONB[]`, `TEXT[]`; "wrap two writes atomically", "transfer balance between accounts", "rollback on error", "MongoDB replica set transactions", "run raw SQL", "native array column", "malformed array literal", "array column not saving", "nested transaction not visible", "foreign key violation on insert inside transaction", "service transaction inside seeder"; typical import `import { transaction } from "@warlock.js/cascade"`. Skip: single-row atomic ops without a transaction — `@warlock.js/cascade/perform-atomic-ops/SKILL.md`; per-source scope — `@warlock.js/cascade/manage-data-sources/SKILL.md`; competing patterns `mongoose.startSession`, `pg` `BEGIN` manually, `prisma.$transaction`, `typeorm` `QueryRunner`.'
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

`transaction(fn)` **flat-nests**: calling it inside an already-open transaction JOINS the outer one instead of opening a second, independent transaction. The inner block runs on the **same** session — so it sees the outer's uncommitted writes — and the **outermost** `transaction()` owns commit/rollback. A service that opens its own `transaction()` for standalone atomicity therefore also works unchanged when called inside a larger transaction — e.g. a seeder that creates a row, then calls a service that opens a transaction to insert a child referencing it (an independent inner transaction couldn't see the parent's uncommitted row, and the child insert would fail its foreign key).

A throw anywhere inside unwinds the **whole** outer transaction — Postgres aborts a transaction on the first error, so there is no automatic per-block savepoint. For independent partial rollback of an inner block, drop to the manual API (`driver.beginTransaction()`) and use savepoints explicitly.

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

## Raw SQL — `Model.raw` / `DataSource.raw` (transaction-aware)

When the query builder can't express something, drop to raw SQL. Both helpers are **transaction-aware**: called inside an active `transaction()` scope they auto-join that transaction's client/session, otherwise they run on the pool.

```ts
// Off a model — uses the model's driver
const { rows, rowCount } = await User.raw<{ id: number; total: number }>(
  "SELECT id, COUNT(*) AS total FROM orders WHERE user_id = $1 GROUP BY id",
  [userId],
);

// Inside a transaction — auto-joins the active scope
await transaction(async () => {
  await User.raw("UPDATE users SET active = true WHERE id = $1", [id]);
});

// Off a data source directly
const { rows: counts } = await dataSource.raw<{ count: number }>(
  "SELECT COUNT(*)::int AS count FROM users",
);
```

`Model.raw<T>(sql, params?)` and `DataSource.raw<T>(sql, params?)` both return `Promise<RawQueryResult<T>>` — `{ rows: T[]; rowCount: number }`, **not** hydrated model instances. MongoDB drivers **throw**: there is no raw SQL on Mongo.

### Native-array columns (`JSONB[]` / `TEXT[]` / `INTEGER[]`)

From a value alone the serializer can't tell a `json` / `jsonb` column (which needs JSON text) from a genuine **native-array** column (`arrayJson()` → `JSONB[]`, `arrayText()` → `TEXT[]`, …, which needs the raw JS array so node-pg emits a `{...}` literal). Guess wrong and Postgres rejects the insert with *"malformed array literal"*.

**This is handled automatically.** On connect the driver introspects `information_schema` once and remembers which columns are native arrays **per table**, so `arrayText()` / `arrayJson()` columns just work with **no configuration**. Because it's per-table, the same column name being `TEXT[]` in one table and `jsonb` in another is encoded correctly for each; the pgvector all-number array form is still preserved.

`nativeArrayColumns` remains as an optional, table-agnostic **override** — for a column created outside a migration, or an environment where `information_schema` can't be read:

```ts
connectToDatabase({
  name: "default",
  driver: "postgres",
  // ...
  nativeArrayColumns: ["tags", "category_ids"], // optional manual override
});
```

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
