---
title: "RBAC and ABAC"
description: How permissions (class-level grants) and policies (instance-level conditions) combine.
sidebar:
  order: 1
  label: "RBAC and ABAC"
---

Authorization in `access` has two layers that combine into one decision:

- **RBAC** (Role-Based Access Control) — permissions are grouped into roles, and roles are assigned to users. It's a **class-level** grant: "can this user update orders at all?"
- **ABAC** (Attribute-Based Access Control) — a rule that inspects the specific record's attributes (ownership, tenant, state) to decide. It's the **instance-level** condition: "can they update **this** order?"

## Permissions (RBAC) — the grant

A **permission** is a namespaced string — `orders.update`, `posts.publish`. Roles bundle them, and the engine matches a requested permission against the set a user holds, with wildcards:

- exact — `orders.update` covers `orders.update`
- prefix — `orders.*` covers `orders.update` and any nested `orders.update.status`, but **not** the bare `orders` (the prefix needs a trailing `.`)
- global — `*` covers everything (give a role `["*"]` to make a super-admin)

This is **class-level**: "can this user update orders at all?". It needs no specific record, so it's cheap, cacheable, and runs in middleware.

```ts
await can(user, "orders.update"); // true if any role grants orders.update (or orders.* or *)
```

## Policies (ABAC) — the condition

RBAC can't express "...but only **their own** order" — that depends on the specific record. A **policy** is the instance-level rule that reads the resource:

```ts
definePolicy("orders.update", (user, order, ctx) =>
  order.get("customer_id") === user.id || ctx.hasRole("manager"),
);
```

## The combined decision

```
can(user, "orders.update", { resource: order })
  = holds "orders.update"          (RBAC grant)
    AND (no policy OR policy passes) (ABAC condition)
```

A few consequences worth remembering:

- **No grant → denied**, and the policy never runs. A policy can't grant a permission the user doesn't hold — policies only *deny further*.
- **A policy runs only when you pass a `resource`.** `gate` (a route gate, no resource) checks the grant alone; `authorize(user, perm, { resource })` runs the policy too. That's the class-level / instance-level split.
- **The decision fails closed.** Any error resolving it — the resolver throws, a policy throws, the tenant can't be determined — denies and logs. A user with no roles is denied, never allowed by accident.

## When it's just RBAC

Plenty of permissions need no policy — `orders.create`, `reports.view`. Skip `definePolicy` for those; the grant is the whole decision. Add a policy only where the answer depends on the specific record.

## The litmus test

Same user, same action — could the answer differ between order #1 and order #2?

- **No** → it's pure RBAC. The record is just the target.
- **Yes** → you need a policy (ABAC). The record is an input to the decision.
