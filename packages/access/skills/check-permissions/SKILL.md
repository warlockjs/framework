---
name: check-permissions
description: 'Check permissions in `@warlock.js/access` — `can` / `cannot` / `canAll` / `canAny` (boolean), `authorize` / `authorizeAll` / `authorizeAny` (throw 403), and the `requirePermission` / `requireAny` / `requireAll` route middleware. Class-level vs instance-level (pass a `resource` to run its policy). TRIGGER: `can(`, `authorize(`, `canAll`, `canAny`, `requirePermission`, `requireAny`, `requireAll`, "check a permission", "protect route by permission", "403 forbidden", "any vs all permissions". Skip: ownership / tenant conditions — `@warlock.js/access/define-policies/SKILL.md`; role checks — `@warlock.js/access/manage-roles/SKILL.md`.'
---

# Check permissions

## In a route — class-level gate

Stack it AFTER `authMiddleware` (which sets `request.user`):

```ts
import { authMiddleware } from "@warlock.js/auth";
import { requirePermission } from "@warlock.js/access";

router.post("/orders", createOrder, {
  middleware: [authMiddleware([]), requirePermission("orders.create")],
});
```

A missing permission → `403` before your controller runs. Use `requireAny([...])` / `requireAll([...])` for sets.

## In code — boolean

```ts
import { can, cannot, canAll, canAny } from "@warlock.js/access";

if (await can(user, "orders.update")) { /* … */ }

await canAll(user, ["orders.update", "orders.viewCost"]); // needs BOTH
await canAny(user, ["orders.update", "orders.updateStatus"]); // needs EITHER
```

> **Multi-permission checks are named, never defaulted.** Use `canAll` / `canAny` (and `requireAll` / `requireAny`). There is no `can(user, [array])` — a wrong implicit any/all default is a silent privilege-escalation or a lockout.

## In a service — throw

```ts
import { authorize, authorizeAll } from "@warlock.js/access";

await authorize(user, "orders.update"); //              throws ForbiddenError (403, EC100) on deny
await authorizeAll(user, ["orders.update", "orders.viewCost"]);
```

## Instance-level — "this resource"

Pass a `resource` and the permission's policy runs on top of the grant (see [`define-policies`](@warlock.js/access/define-policies/SKILL.md)):

```ts
const order = await Order.find(orderId);

await authorize(user, "orders.update", { resource: order, tenant }); // grant AND policy
```

- `requirePermission` is **class-level only** — no resource, runs before the controller ("can they update orders at all?").
- `authorize(…, { resource })` is **instance-level** — after you load the row ("can they update THIS order?").

## Wildcards

`*` grants everything; `orders.*` covers `orders.update` and any nested `orders.update.status`. Give a role `["*"]` to make it a super-admin.

## Gotchas

- **Fails closed.** Any error resolving the decision → denied (and logged). A user with no roles is denied, never allowed by accident.
- Stack `requirePermission` **after** `authMiddleware` — it reads `request.user`; without an authenticated user it `403`s.
- The boolean `can*` family never throws; the `authorize*` family throws `ForbiddenError`. Pick per layer (controllers gate with middleware, services assert with `authorize`).

## See also

- [`@warlock.js/access/define-policies/SKILL.md`](@warlock.js/access/define-policies/SKILL.md) — the `{ resource }` conditions.
- [`@warlock.js/auth/protect-routes/SKILL.md`](@warlock.js/auth/protect-routes/SKILL.md) — `authMiddleware`, which runs first.
