---
title: "Define policies"
description: Add instance-level ABAC conditions on top of RBAC grants with definePolicy.
sidebar:
  order: 2
  label: "Define policies"
---

A policy is the "...but only **this** one" rule that RBAC can't express. Register one per permission, and keep each policy in the module that owns the resource.

## Register

Put policies in the owning module's `policies/` folder — an order policy lives with the orders module:

```ts title="src/app/orders/policies/index.ts"
import { definePolicy } from "@warlock.js/access";

definePolicy("orders.update", (user, order, ctx) =>
  order.get("organization_id") === ctx.tenant &&
  (order.get("customer_id") === user.id || ctx.hasRole("manager")),
);
```

Load it once from that module's `main.ts` so it's registered before any request (the module root stays just `routes.ts` + `main.ts`):

```ts title="src/app/orders/main.ts"
import "./policies";
```

## It runs only on an instance check

```ts
await authorize(user, "orders.update"); //                     policy SKIPPED (grant only)
await authorize(user, "orders.update", { resource: order }); // policy runs
```

So a route gate (`gate`, no resource) verifies the grant, and the per-record condition runs in your service after you load the order. Class-level and instance-level stay cleanly separated.

## The decision is an AND

- No grant → denied; the policy never runs.
- Grant, no policy registered → allowed.
- Grant + policy → the policy decides.

Policies **deny further** — they can never let a user past a permission they don't hold.

## The context argument

`(user, resource, ctx)`. `ctx` carries the resolved `tenant`, the engine helpers `hasRole(role)` / `hasPermission(perm)`, and any extra keys you passed on the check:

```ts
await authorize(user, "orders.refund", { resource: order, amount: 5000 });

definePolicy("orders.refund", (user, order, ctx) =>
  ctx.hasRole("manager") || (ctx.amount as number) <= 1000,
);
```

## Notes

- A policy that throws is treated as a **denial** (fail-closed) and logged.
- Policies are keyed by permission name — define each once.
- "Own resource" at graph scale (deep relationship chains) is ReBAC, which is out of scope; a policy covers the everyday ownership case.
