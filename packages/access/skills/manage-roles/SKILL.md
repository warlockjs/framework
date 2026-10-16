---
name: manage-roles
description: 'Assign and read roles in `@warlock.js/access` — the ejected `UserRole.assign` / `UserRole.revoke` (the `user_roles` table) followed by `access.flush`, plus `hasRole` / `hasAnyRole` / `hasAllRoles`. The role→permission catalog is the ejected `Role` table (dynamic). TRIGGER: `UserRole.assign`, `UserRole.revoke`, `access.flush`, `hasRole`, `hasAnyRole`, `hasAllRoles`, `Role` table, "give a user a role", "assign role", "check a user role", "roles per tenant". Skip: permission checks — the `check-permissions` topic; resolver choice — the `configure-access` topic.'
---

# Manage roles

Role storage is **ejected into your app** (`npx warlock add access`): a `UserRole` table (who holds which role) and a `Role` catalog table (role → permissions). Both are dynamic — admins manage them at runtime. The package itself only reads them through the `DatabaseAccessResolver`.

## Assign / revoke

Assign and revoke with the ejected `UserRole` model. Both **flush the affected user's cached set for you** — no manual `access.flush` after a role change:

```ts
import { UserRole } from "app/access/models/user-role";

await UserRole.assign(user, "editor", "tenant-1"); // editor in tenant-1 (auto-flushes that user)
await UserRole.assign(user, "viewer", "tenant-2"); // viewer in tenant-2 — same user, different role

await UserRole.revoke(user, "editor", "tenant-1"); // auto-flushes too
```

The `tenant` arg is optional — omit it for single-tenant apps (roles are stored globally). In a **multi-tenant** app, always pass the tenant: an omitted or unresolved tenant scopes to _global_ roles only, never the union across tenants.

### When you still need `access.flush`

`assign` / `revoke` cover the common case. The cache keys off `(user, tenant)`, so flush manually only for **out-of-band** changes those two methods can't see:

```ts
import { access } from "@warlock.js/access";

// A role's permission set changed in the `Role` catalog — every holder's cached
// permissions are now stale, so flush each affected user:
await access.flush(user, "tenant-1");

// You changed a user's role membership WITHOUT UserRole (e.g. wrote the user's
// `role` column directly, or a bulk SQL update):
await access.flush(user, "tenant-1");
```

`access.flush(user, tenant)` is per-user — it has no "drop everything" form. For a sweeping catalog change with many holders, flush each affected user, or let the entries expire on their own (`cache.ttl`, default `10m`).

## Read roles

```ts
import { hasAllRoles, hasAnyRole, hasRole } from "@warlock.js/access";

await hasRole(user, "editor"); //              tenant is an optional 3rd arg
await hasAnyRole(user, ["admin", "manager"]);
await hasAllRoles(user, ["staff", "verified"]);
```

> **Prefer permission checks over role checks.** Role checks couple your code to the role taxonomy; `can(user, "orders.update")` survives a role rename. Reach for `hasRole` only for coarse UI gating.

## The catalog (the `Role` table)

A role's permissions live in the ejected `Role` table — `{ name, permissions }`. Add a role, or change what it grants, by writing rows; the `DatabaseAccessResolver` joins `user_roles` through it. No redeploy needed.

## The model (overridable)

The ejected `UserRole` is a thin cascade model — `{ user_id, user_type, role, tenant }`. `user_id` defaults to `uuid` — edit the ejected migration in `src/app/access/models/user-role/migrations/` if your user ids are integers.

## Roles stored elsewhere?

If roles live on the user (a `roles` column) or in a token claim, you don't use `UserRole` — you manage assignment your way and a resolver reads them. See the `implement-resolver` topic.

## See also

- The `configure-access` topic — choosing the resolver.
- The `implement-resolver` topic — non-table role storage.

```

```
