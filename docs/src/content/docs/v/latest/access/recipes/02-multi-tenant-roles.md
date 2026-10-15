---
title: "Per-tenant roles"
description: One user, different roles in different organizations — the SaaS pattern.
sidebar:
  order: 2
  label: "Per-tenant roles"
---

In a multi-tenant SaaS, a user is `admin` in their own organization and `viewer` in one they were invited to. The ejected `user_roles` table scopes each assignment to a tenant.

## Setup

`npx warlock add access` already ejects the DB-backed resolver and the role tables — that's all you need for per-tenant roles. To resolve the active organization so checks don't have to pass it, add `resolveTenant(user)` to the resolver. It receives the user, so derive the tenant from there — safer than trusting client-supplied request input:

```ts title="src/app/access/services/access-resolver.ts"
public resolveTenant(user: Auth): string | undefined {
  return user.get("organization_id");
}
```

Seed the catalog as `Role` rows (admins can edit these at runtime):

```ts
import { Role } from "app/access/models/role";

await Role.create({ name: "admin", permissions: ["*"] });
await Role.create({ name: "member", permissions: ["orders.*", "members.view"] });
await Role.create({ name: "viewer", permissions: ["orders.view"] });
```

## Assign per tenant

Assign through `UserRole` — each call auto-flushes that user's cached set for the tenant, so the next check is current with no manual `access.flush`:

```ts
import { UserRole } from "app/access/models/user-role";

await UserRole.assign(user, "admin", "org-acme"); //  admin in Acme
await UserRole.assign(user, "viewer", "org-globex"); // viewer in Globex
```

## Checks are automatically tenant-scoped

With `resolveTenant` implemented, an ordinary check resolves against the caller's active organization:

```ts
// inside a request for org-acme → uses the admin grant
await can(user, "orders.delete"); // true

// the same user, inside a request for org-globex → uses the viewer grant
await can(user, "orders.delete"); // false
```

Need to check against a specific tenant explicitly (a background job, a cross-org admin screen)? Pass it:

```ts
await can(user, "orders.delete", { tenant: "org-acme" });
```

## Combine with a tenant-isolation policy

For defense in depth, add a policy that confirms the record belongs to the active tenant — so even a misconfigured role can't reach across organizations:

```ts title="src/app/orders/policies/index.ts"
definePolicy("orders.update", (user, order, ctx) =>
  order.get("organization_id") === ctx.tenant,
);
```
