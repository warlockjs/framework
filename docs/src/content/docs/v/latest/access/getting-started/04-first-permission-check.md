---
title: "Your first check"
description: Gate a route by permission and assert ownership in a service.
sidebar:
  order: 4
  label: "Your first check"
---

Two checks, one for each stage of the model.

## 1. Gate a route (class-level)

Stack `gate` after `authMiddleware` — the auth middleware hydrates `request.user`, then the access middleware checks the grant:

```ts title="src/app/orders/routes.ts"
import { authMiddleware } from "@warlock.js/auth";
import { gate } from "@warlock.js/access";
import { router } from "@warlock.js/core";

router.post("/orders", createOrderController, {
  middleware: [authMiddleware([]), gate("orders.create")],
});
```

A user whose roles don't grant `orders.create` gets a `403` before `createOrderController` ever runs.

## 2. Assert on a specific record (instance-level)

A route gate can only ask "can they create orders at all?". To enforce "can they update **this** order?", register a policy in the orders module and assert in the service after loading the row:

```ts title="src/app/orders/policies/index.ts"
import { definePolicy } from "@warlock.js/access";

definePolicy("orders.update", (user, order) => order.get("customer_id") === user.id);
```

Load it from the orders module's `main.ts` (`import "./policies";`) so it registers at boot.

```ts title="src/app/orders/services/update-order.service.ts"
import { authorize } from "@warlock.js/access";

export async function updateOrder(user: Auth, orderId: string, changes: OrderChanges) {
  const order = await Order.find(orderId);

  // passes only if the user holds `orders.update` AND owns this order
  await authorize(user, "orders.update", { resource: order });

  return order.merge(changes).save();
}
```

## 3. Branch in code

For UI hints — which buttons to show — use the boolean `can`:

```ts
return {
  ...order.toJSON(),
  canEdit: await can(user, "orders.update", { resource: order }),
  canDelete: await can(user, "orders.delete", { resource: order }),
};
```

That's the whole loop: **middleware gates the action class, the service authorizes the specific resource.** Everything else in these docs builds on it.

## Next

- [RBAC and ABAC](../essentials/01-rbac-and-abac.md) — the two-stage model in depth.
- [Check permissions](../guides/check-permissions.md) — the full check API.
