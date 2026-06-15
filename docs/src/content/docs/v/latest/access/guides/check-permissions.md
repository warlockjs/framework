---
title: "Check permissions"
description: can / cannot / canAll / canAny, the authorize family, and the gate* route middleware.
sidebar:
  order: 1
  label: "Check permissions"
---

Three flavors of check, one per layer: middleware gates routes, booleans branch logic, throwers guard services.

## Route middleware

```ts
import { gate, gateAny, gateAll } from "@warlock.js/access";

router.post("/orders", createOrder, {
  middleware: [authMiddleware([]), gate("orders.create")],
});

router.get("/reports", viewReports, {
  middleware: [authMiddleware([]), gateAny(["reports.view", "reports.admin"])],
});
```

Always stack these **after** `authMiddleware` — they read `request.user`. A denied check returns `403` before the controller runs.

## Booleans

```ts
import { can, cannot, canAll, canAny } from "@warlock.js/access";

if (await can(user, "orders.update")) { /* … */ }

await canAll(user, ["orders.update", "orders.viewCost"]); // needs BOTH
await canAny(user, ["orders.update", "orders.updateStatus"]); // needs EITHER
```

:::caution[Multi-permission checks are named, never defaulted]
Use `canAll` / `canAny` (and `gateAll` / `gateAny`). There is deliberately no `can(user, [array])` — a wrong implicit any/all default is a silent privilege-escalation or a lockout, and neither throws to tell you.
:::

## Throwers (services)

```ts
import { authorize, authorizeAll, authorizeAny } from "@warlock.js/access";

await authorize(user, "orders.update"); //          throws ForbiddenError (403, EC100) on deny
await authorizeAll(user, ["orders.update", "orders.viewCost"]);
```

## Class-level vs instance-level

Pass a `resource` and the permission's [policy](./define-policies.md) runs on top of the grant:

```ts
await authorize(user, "orders.update"); //                     class-level — grant only
await authorize(user, "orders.update", { resource: order }); // instance-level — grant AND policy
```

`gate` is class-level only (it runs before the controller, with no record to inspect). Instance checks belong in the service, after you load the row.

## Wildcards

`*` grants everything; `orders.*` covers `orders.update` and any nested `orders.update.status` — but **not** the bare `orders` (the prefix needs a trailing `.`, so granting `orders.*` and checking `orders` is silently denied).

## Good to know

- `can*` never throws; `authorize*` throws `ForbiddenError`. Gate controllers with middleware, assert in services with `authorize`.
- Everything **fails closed** — an error resolving the decision denies; a user with no roles is denied, not allowed. The one exception: a misconfig (`AccessConfigError`, e.g. no resolver) is re-thrown loudly instead of denied.
