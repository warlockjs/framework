---
title: "The outbox pattern — side effects after commit"
sidebar:
  order: 8
  label: "Outbox pattern — side effects after commit"
---

The classic bug: the order creation transaction fails and rolls back, but the confirmation email already went out. The outbox pattern fixes this by recording side effects **inside the transaction** in an `outbox` table — a separate process picks them up after the transaction commits. If the transaction rolls back, the outbox row rolls back with it.

## When to reach for it

Use the outbox when:

- The side effect is **irreversible** (sending email, charging a card, firing a webhook).
- You need **at-least-once delivery** of the event regardless of process restarts.

Skip the outbox for idempotent in-process work (cache invalidation, in-memory subscribers) — those are fine in `onSaved` listeners directly.

## The outbox model

```ts
import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";

export const outboxSchema = v.object({
  topic: v.string(),
  payload: v.any(),
  attempts: v.number().default(0),
  lastError: v.string().optional(),
  dispatchedAt: v.date().optional(),
  nextAttemptAt: v.date().optional(),
});

type OutboxSchema = Infer<typeof outboxSchema>;

@RegisterModel()
export class Outbox extends Model<OutboxSchema> {
  public static table = "outbox";
  public static schema = outboxSchema;
}
```

Index on `(dispatchedAt, nextAttemptAt)` — the dispatcher polls "pending and ready" rows, so that pair is the hot read.

## The `enqueue` helper

```ts
import { Outbox } from "./models/outbox/outbox.model";

export async function enqueue(topic: string, payload: unknown) {
  await Outbox.create({ topic, payload });
}
```

Three lines. The trick is that you call it **inside the same transaction** as the business write — if the transaction rolls back, the outbox row rolls back too.

## Using it from a service

```ts
import { transaction } from "@warlock.js/cascade";
import { Order } from "../models/order/order.model";
import { OrderLine } from "../models/order-line/order-line.model";
import { enqueue } from "app/outbox/enqueue";

export async function placeOrder(input: PlaceOrderInput) {
  return transaction(async () => {
    const order = await Order.create({ userId: input.userId, total: input.total });

    for (const item of input.items) {
      await OrderLine.create({ orderId: order.id, ...item });
    }

    await enqueue("order.created", { orderId: order.id });
    await enqueue("inventory.decrement", { items: input.items });

    return order;
  });
}
```

If `Order.create` or any `OrderLine.create` fails, the transaction rolls back and the outbox rows disappear with it. If everything succeeds, the outbox has the two rows waiting for the dispatcher.

## The dispatcher

The other half — pulling rows out of the outbox and running the handlers:

```ts
import { Outbox } from "./models/outbox/outbox.model";
import { handlers } from "./handlers";

const BATCH_SIZE = 50;

export async function dispatchOutbox() {
  const rows = await Outbox.query()
    .whereNull("dispatchedAt")
    .where((query) => {
      query.whereNull("nextAttemptAt").orWhere("nextAttemptAt", "<=", new Date());
    })
    .orderBy("createdAt", "asc")
    .limit(BATCH_SIZE)
    .get();

  for (const row of rows) {
    await dispatchRow(row);
  }
}

async function dispatchRow(row: Outbox) {
  const topic = row.get("topic");
  const handler = handlers[topic];

  if (!handler) {
    console.warn(`No handler for outbox topic: ${topic}`);
    return;
  }

  try {
    await handler(row.get("payload"));

    row.set("dispatchedAt", new Date());
    await row.save();
  } catch (error) {
    const attempts = (row.get("attempts") as number) + 1;
    const message = error instanceof Error ? error.message : String(error);

    row.merge({
      attempts,
      lastError: message,
      nextAttemptAt: scheduleRetry(attempts),
    });

    await row.save();
  }
}

function scheduleRetry(attempts: number): Date {
  const seconds = Math.min(60 * 60, 2 ** attempts);
  return new Date(Date.now() + seconds * 1000);
}
```

The handlers map dispatches each topic to its concrete action:

```ts
import { sendOrderConfirmationEmail } from "app/notifications/services/...";
import { decrementInventory } from "app/inventory/services/...";

export const handlers: Record<string, (payload: unknown) => Promise<void>> = {
  "order.created": (payload) => sendOrderConfirmationEmail(payload),
  "inventory.decrement": (payload) => decrementInventory(payload),
};
```

The dispatcher runs on a schedule — a setInterval, a scheduled job, a sidecar process. Polling every ~5 seconds is fine for most apps.

## At-least-once delivery — handlers must be idempotent

If the handler succeeds but the row-save that marks it dispatched fails, the next poll re-runs the handler. So handlers must be safe to replay:

- **Email** — include a deterministic message id so the provider dedupes.
- **Stripe** — use idempotency keys.
- **Internal writes** — use upserts keyed on a deterministic id.

Don't try to solve exactly-once. Design handlers to tolerate replays.

## Going further

- **Transactions** — the foundation this builds on: [Transactions guide](../digging-deeper/transactions.md)
- **Lifecycle events** that enqueue rows: [Events and hooks guide](../architecture-concepts/events-and-hooks.md)
- **Audit trail** — a related "write through events" pattern: [Audit trail recipe](./audit-trail.md)
