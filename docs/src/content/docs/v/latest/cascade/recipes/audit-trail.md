---
title: "Audit trail via events"
sidebar:
  order: 1
  label: "Audit trail via events"
---

Capture every change to audited models in a single audit-log table — who, when, what changed. Wires up via Cascade's `onCreated` / `onUpdated` / `onDeleted` events.

## The audit log model

```ts
import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";

export const auditLogSchema = v.object({
  table: v.string(),
  recordId: v.string(),
  event: v.enum(["created", "updated", "deleted"]),
  changes: v.any().optional(),
  actorId: v.string().optional(),
});

type AuditLogSchema = Infer<typeof auditLogSchema>;

@RegisterModel()
export class AuditLog extends Model<AuditLogSchema> {
  public static table = "audit_logs";
  public static schema = auditLogSchema;
}
```

`changes` holds the diff for updates, the full new row for creates, and the delete strategy for deletes. Index on `(table, recordId)` for "show me the history of row X" queries.

## The `auditModel` helper

```ts
import type { ChildModel, Model } from "@warlock.js/cascade";
import { AuditLog } from "./models/audit-log/audit-log.model";

type AuditOptions = {
  exclude?: string[];
  getActor?: () => string | undefined;
};

export function auditModel<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  options: AuditOptions = {},
) {
  const exclude = options.exclude ?? [];

  ModelClass.events().onCreated(async (model) => {
    const data = { ...model.data };

    for (const field of exclude) {
      delete data[field];
    }

    await AuditLog.create({
      table: ModelClass.table,
      recordId: String(model.id),
      event: "created",
      changes: data,
      actorId: options.getActor?.(),
    });
  });

  ModelClass.events().onUpdated(async (model) => {
    const changes = model.getDirtyColumnsWithValues();

    for (const field of exclude) {
      delete changes[field];
    }

    if (Object.keys(changes).length === 0) {
      return;
    }

    await AuditLog.create({
      table: ModelClass.table,
      recordId: String(model.id),
      event: "updated",
      changes,
      actorId: options.getActor?.(),
    });
  });

  ModelClass.events().onDeleted(async (model, context) => {
    await AuditLog.create({
      table: ModelClass.table,
      recordId: String(model.id),
      event: "deleted",
      changes: { strategy: context.strategy },
      actorId: options.getActor?.(),
    });
  });
}
```

A few things worth noting:

- **`onUpdated`** reads `getDirtyColumnsWithValues()` — the dirty tracker still has the diff because the event fires right after the save.
- **`exclude`** drops sensitive columns (passwords, tokens) before the audit row is written. Otherwise every password change would replicate the new hash into the audit log.
- **`onDeleted`** records the delete strategy (`"permanent"` / `"soft"` / `"trash"`) so you can tell soft-deletes apart from hard.

## Wiring it up

```ts
import { auditModel } from "./audit-model";
import { User } from "app/users/models/user/user.model";
import { Order } from "app/orders/models/order/order.model";

export function setupAudit() {
  auditModel(User, {
    exclude: ["password"],
    getActor: () => currentRequestContext().userId,
  });

  auditModel(Order, {
    getActor: () => currentRequestContext().userId,
  });
}
```

Call `setupAudit()` once at boot. Models opt in by being listed here.

## Querying the trail

```ts
const history = await AuditLog.query()
  .where("table", "users")
  .where("recordId", userId)
  .orderBy("createdAt", "asc")
  .get();
```

The audit table is just another Cascade model. Same query API, same hydration, same everything.

## Skipping audits for bulk operations

A data migration that touches 10M rows would write 10M audit entries. Two escape hatches:

```ts
await user.save({ skipEvents: true });
await user.destroy({ skipEvents: true });
```

For bulk writes, prefer query-builder operations — they bypass model events entirely:

```ts
await User.where("status", "pending").update({ status: "active" });
```

## Don't put side effects in audit listeners

The audit listener should write to the audit table and nothing else. External calls (Slack, email, webhooks) belong in their own listeners or in the [outbox pattern](./outbox-pattern.md) — if Slack is down, your data should still save, and the audit row shouldn't be a phantom.

## Going further

- **Lifecycle events** in full: [Events and hooks guide](../architecture-concepts/events-and-hooks.md)
- **Dirty tracking** — what `getDirtyColumnsWithValues` returns: [Dirty tracking guide](../architecture-concepts/dirty-tracking.md)
- **External side effects after commit**: [Outbox pattern recipe](./outbox-pattern.md)
