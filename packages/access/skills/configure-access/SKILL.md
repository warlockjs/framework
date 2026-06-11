---
name: configure-access
description: 'Configure `@warlock.js/access` — the `roles` → permissions map, the resolver (built-in `DefaultAccessResolver` for an inline role column vs `ModelAccessResolver` for the `user_roles` table), `cacheTtl`, and the ambient `tenant.resolve` hook. TRIGGER: `AccessConfigurations`, `config.access`, `src/config/access.ts`, "set up permissions", "roles map", "DefaultAccessResolver", "ModelAccessResolver", "access cache ttl", "access tenant". Skip: checking permissions — `@warlock.js/access/check-permissions/SKILL.md`; custom storage — `@warlock.js/access/implement-resolver/SKILL.md`.'
---

# Configure access

## Zero-config — roles in code, roles on the user

Define what each role grants and tell the package nothing else. The built-in `DefaultAccessResolver` reads `user.get("roles")` (or a single `user.get("role")`).

```ts title="src/config/access.ts"
import { type AccessConfigurations } from "@warlock.js/access";

const access: AccessConfigurations = {
  roles: {
    owner: ["*"], //                                 `*` is the super-grant
    editor: ["orders.*", "posts.create"], //         `orders.*` covers orders.update, orders.view, …
    viewer: ["orders.view"],
  },
};

export default access;
```

`can(user, "orders.update")` now works for any user whose `roles` column includes `editor`.

> `DefaultAccessResolver` is **not tenant-aware** — it returns the same roles in every tenant. For per-tenant roles (a user who is `editor` in one tenant and `viewer` in another), use `ModelAccessResolver` below.

## Roles in a table (multi-role / per-tenant)

Switch the resolver to the `user_roles` table — this is what multi-tenant apps want (a user can hold different roles per tenant):

```ts
import { ModelAccessResolver } from "@warlock.js/access";

const roles = { editor: ["orders.*"], viewer: ["orders.view"] };

const access: AccessConfigurations = {
  roles,
  resolver: new ModelAccessResolver(roles),
};
```

Wire `UserRoleMigration` into `warlock.config.ts` `database.migrations`, then assign roles via `access.assign(user, "editor", tenant)` (see [`manage-roles`](@warlock.js/access/manage-roles/SKILL.md)).

## The full shape

```ts
type AccessConfigurations = {
  roles?: Record<string, string[]>; //               role → permissions
  resolver?: AccessResolver; //                       default: DefaultAccessResolver(roles)
  cacheTtl?: string | number; //                      resolved-set TTL, default "10m"
  tenant?: { resolve?: () => string | undefined }; // ambient tenant
};
```

## Tenant

Checks accept an explicit tenant (`can(user, "x", { tenant })`), but set an ambient default so you never pass it on the happy path:

```ts
tenant: { resolve: () => currentRequest().input("organizationId") },
```

## Caching

The engine caches each user's resolved set (`cacheTtl`, default `10m`). Roles changed out of band? Call `access.flush(user, tenant)` — `assign` / `revoke` already do. The cache is **best-effort**: an outage degrades to the resolver, it never denies.

## See also

- [`@warlock.js/access/implement-resolver/SKILL.md`](@warlock.js/access/implement-resolver/SKILL.md) — when neither built-in resolver fits.
- [`@warlock.js/access/manage-roles/SKILL.md`](@warlock.js/access/manage-roles/SKILL.md) — assign / revoke with the table.
