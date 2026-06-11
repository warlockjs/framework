---
name: manage-roles
description: 'Assign and read roles in `@warlock.js/access` — `access.assign` / `access.revoke` (backed by the `user_roles` table) and `hasRole` / `hasAnyRole` / `hasAllRoles`. Covers the overridable `UserRole` model + migration and why to prefer permission checks. TRIGGER: `access.assign`, `access.revoke`, `hasRole`, `hasAnyRole`, `hasAllRoles`, `UserRole`, `UserRoleMigration`, "give a user a role", "assign role", "check a user role", "roles per tenant". Skip: permission checks — `@warlock.js/access/check-permissions/SKILL.md`; resolver choice — `@warlock.js/access/configure-access/SKILL.md`.'
---

# Manage roles

## Assign / revoke (with the `user_roles` table)

Use `ModelAccessResolver` (see [`configure-access`](@warlock.js/access/configure-access/SKILL.md)) and wire `UserRoleMigration` into `warlock.config.ts`. Then:

```ts
import { access } from "@warlock.js/access";

await access.assign(user, "editor", "tenant-1"); // editor in tenant-1
await access.assign(user, "viewer", "tenant-2"); // viewer in tenant-2 — same user, different role
await access.revoke(user, "editor", "tenant-1");
```

Both invalidate the user's cached set. The `tenant` arg is optional — omit it for single-tenant apps (roles are stored globally). In a **multi-tenant** app, always pass the tenant: an omitted or unresolved tenant scopes to *global* roles only, never the union across tenants.

## Read roles

```ts
import { hasAllRoles, hasAnyRole, hasRole } from "@warlock.js/access";

await hasRole(user, "editor"); //              tenant is an optional 3rd arg
await hasAnyRole(user, ["admin", "manager"]);
await hasAllRoles(user, ["staff", "verified"]);
```

> **Prefer permission checks over role checks.** Role checks couple your code to the role taxonomy; `can(user, "orders.update")` survives a role rename. Reach for `hasRole` only for coarse UI gating.

## The model (overridable)

`UserRole` is a thin cascade model — `{ user_id, user_type, role, tenant }`. Extend + swap it to add columns:

```ts
export class AppUserRole extends UserRole {
  public static schema = userRoleSchema.extend({ granted_by: v.scalar().optional() });
}
// then: new ModelAccessResolver(roles, AppUserRole)
```

`user_id` defaults to `uuid` — override `UserRoleMigration` if your user ids are integers.

## Roles stored elsewhere?

If roles live on the user (a `roles` column) or in a token claim, you don't use `access.assign` — you manage assignment your way and a resolver reads them. See [`implement-resolver`](@warlock.js/access/implement-resolver/SKILL.md).

## See also

- [`@warlock.js/access/configure-access/SKILL.md`](@warlock.js/access/configure-access/SKILL.md) — choosing the resolver.
- [`@warlock.js/access/implement-resolver/SKILL.md`](@warlock.js/access/implement-resolver/SKILL.md) — non-table role storage.
