---
name: configure-access
description: 'Configure `@warlock.js/access` — the REQUIRED `resolver` (the quickstart `DefaultAccessResolver` over a fixed code map vs the ejected, DB-backed `DatabaseAccessResolver`), `cache: { ttl }`, and the ambient tenant via the resolver''s optional `resolveTenant()`. TRIGGER: `AccessConfigurations`, `config.access`, `src/config/access.ts`, "set up permissions", "DefaultAccessResolver", "DatabaseAccessResolver", "access cache ttl", "access tenant". Skip: checking permissions — the `check-permissions` topic; custom storage — the `implement-resolver` topic.'
---

# Configure access

The resolver is the **one required piece**. It tells the engine how to read a user's roles + permissions. There is no separate `roles` config map — the role→permission catalog lives INSIDE the resolver.

## Quickstart — a fixed, code-defined catalog

`DefaultAccessResolver` reads a user's roles from `user.get("roles")` (or a single `user.get("role")`) and maps them to permissions through a code map. No tables, no migrations.

```ts title="src/config/access.ts"
import { type AccessConfigurations, DefaultAccessResolver } from "@warlock.js/access";

const access: AccessConfigurations = {
  resolver: new DefaultAccessResolver({
    owner: ["*"], //                                 `*` is the super-grant
    editor: ["orders.*", "posts.create"], //         `orders.*` covers orders.update, orders.view, …
    viewer: ["orders.view"],
  }),
};

export default access;
```

`can(user, "orders.update")` now works for any user whose `roles` column includes `editor`.

> `DefaultAccessResolver` is **not tenant-aware** — it returns the same roles in every tenant. For per-tenant roles, use the dynamic resolver below.

## Real apps — dynamic, DB-backed roles

`npx warlock add access` ejects a `DatabaseAccessResolver` (plus the `Role` + `UserRole` tables) into `src/app/access/`. Roles come from the `user_roles` table (multi-role, tenant-aware); permissions are joined through the `roles` catalog table — so admins manage both at runtime, in the DB.

```ts title="src/config/access.ts"
import { type AccessConfigurations } from "@warlock.js/access";
import { DatabaseAccessResolver } from "app/access/services/access-resolver";

const access: AccessConfigurations = {
  resolver: new DatabaseAccessResolver(),
};

export default access;
```

Assign roles via the ejected `UserRole.assign(user, "editor", tenant)` — it flushes that user's cached set for you (see the `manage-roles` topic).

## The full shape

```ts
type AccessConfigurations = {
  resolver: AccessResolver; //          REQUIRED — reads roles + permissions (+ optional tenant)
  cache?: {
    ttl?: string | number; //           resolved-set TTL, default "10m"
  };
  strictPolicies?: boolean; //          default true — see below
};
```

### `strictPolicies`

An instance check (`{ resource }`) for a permission with no registered ABAC policy **denies by default** (`strictPolicies: true`) — a forgotten policy must never fail open. The miss is logged once per permission (`log.warn`) either way.

Set `strictPolicies: false` to explicitly restore the pre-5.13 behavior: fall back to the RBAC grant alone (ALLOWS — any holder of the permission can act on ANY resource, a plausible IDOR). See the `define-policies` topic for the full decision table.

> **Breaking in 5.13:** `strictPolicies` now defaults to `true` and DENIES (it used to default to `false` and ALLOW). Set `strictPolicies: false` to keep the old fail-open fallback.

A missing resolver throws `AccessConfigError` **at boot** — the framework's access connector wires `src/config/access.ts` (the same way the notifications connector wires `config/notifications.ts`), so a misconfig fails at startup, never a silent deny.

## Tenant

Checks accept an explicit tenant (`can(user, "x", { tenant })`), but add a `resolveTenant(user)` to your resolver so you never pass it on the happy path. Derive the tenant from the **user**, not from request input — a client-supplied `organizationId` is attacker-controlled and would let a user check (or act) across tenant boundaries:

```ts
public resolveTenant(user: Auth): string | undefined {
  return user.get("organization_id");
}
```

## Caching

The engine caches each user's resolved set (`cache.ttl`, default `10m`). Roles changed out of band? Call `access.flush(user, tenant)`. The cache is **best-effort**: an outage degrades to the resolver, it never denies.

## See also

- The `implement-resolver` topic — write a resolver for your own storage.
- The `manage-roles` topic — assign / revoke with the ejected table.
```
