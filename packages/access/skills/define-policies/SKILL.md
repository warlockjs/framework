---
name: define-policies
description: 'ABAC conditions in `@warlock.js/access` — `definePolicy(permission, (user, resource, ctx) => boolean)` adds an instance-level rule (ownership / tenant / state) on top of the RBAC grant, evaluated when an authorization check carries a `resource`. TRIGGER: `definePolicy`, "ownership check", "only their own", "can edit this specific record", "ABAC", "policy", "resource-level permission", `authorize(user, perm, { resource })`. Skip: plain grant checks — the `check-permissions` topic.'
---

# Define policies (ABAC)

RBAC says "can update orders". A **policy** adds "...but only THIS order" — the instance-level condition.

## Register a condition

Policies live **per module**, in `src/app/<module>/policies/`, and are loaded by an `import "./policies";` side-effect in that module's `main.ts` — a policy defined in an unimported file silently never registers.

```ts title="src/app/orders/policies/index.ts"
import { definePolicy } from "@warlock.js/access";

definePolicy("orders.update", (user, order, ctx) =>
  order.get("organization_id") === ctx.tenant &&
  (order.get("customer_id") === user.id || ctx.hasRole("manager")),
);
```

```ts title="src/app/orders/main.ts"
import "./policies"; // register this module's policies at boot
```

## It runs ONLY on an instance check

```ts
await authorize(user, "orders.update"); //                     class-level → grant only, policy SKIPPED
await authorize(user, "orders.update", { resource: order }); // instance → grant AND policy
```

So `gate("orders.update")` (a route gate, no resource) checks the grant; the per-order rule runs in your service, after you load the order.

## The decision = grant AND policy

- No grant → denied (the policy never runs).
- Grant + no policy registered → **denied by default** (`strictPolicies: true`, the 5.13+ default) — a typo'd permission or a forgotten `import "./policies"` must never silently degrade an instance check to a class-level one. Logs a one-time `log.warn` naming the permission either way. Set `strictPolicies: false` in the access config (see the `configure-access` topic) to explicitly restore the pre-5.13 RBAC-only fallback (allowed).
- Grant + policy → the policy decides.

Policies **deny**, they don't grant — a policy can't let a user past a permission they don't hold.

## The policy context

`(user, resource, ctx)`, where `ctx` carries:

- `tenant` — the resolved tenant.
- `hasRole(role)` / `hasPermission(perm)` — engine-injected helpers.
- any extra keys you passed on the check:

```ts
await authorize(user, "orders.refund", { resource: order, amount: 5000 });

definePolicy("orders.refund", (user, order, ctx) =>
  ctx.hasRole("manager") || (ctx.amount as number) <= 1000,
);
```

## Gotchas

- Policies are global by permission name — define each once at boot.
- A throwing policy is treated as a **denial** (fail-closed) and logged.
- Need "own resource" at graph scale (deep relationships)? That's ReBAC — out of scope; a policy covers the common ownership case.

## See also

- The `check-permissions` topic — `authorize(…, { resource })`.
