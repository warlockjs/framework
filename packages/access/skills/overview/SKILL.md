---
name: overview
description: 'Front-door for `@warlock.js/access` — authorization (RBAC + ABAC) for Warlock apps: `can` / `authorize` / `requirePermission` permission checks, `definePolicy` attribute conditions, role management, and a pluggable `AccessResolver` that connects the engine to however you store roles. Depends on `@warlock.js/auth` (reads `request.user`). TRIGGER when: importing from `@warlock.js/access`; "permissions in Warlock", "RBAC", "can this user do X", "protect a route by permission", "role-based access", "ownership / policy check". Skip: authentication / login (that is `@warlock.js/auth`); a known task — load the matching skill (`check-permissions`, `define-policies`, `manage-roles`, `implement-resolver`, `configure-access`).'
---

# `@warlock.js/access` — overview

Authorization for Warlock apps. `@warlock.js/auth` answers _who you are_; `access` answers _what you can do_.

## The mental model in one paragraph

The package owns the **engine** — wildcard matching, caching, ABAC policies, fail-closed decisions. You hand it **one adapter**, an `AccessResolver`, that reads a user's roles from however YOUR app stores them. Roles map to permissions in your code (the `roles` map). Then `can(user, "orders.update")` and `requirePermission("orders.update")` just work. The two concepts inside are **permissions** (RBAC grants) and **policies** (ABAC conditions) — which is why the package is called `access`, not either half.

## When to reach for it

- A Warlock app (already on `@warlock.js/auth`) that needs per-action / per-resource authorization beyond auth's user-type gate.
- **Multi-tenant** role scoping — `editor` in tenant A, `viewer` in tenant B.
- "Only their own / only in their tenant / only while pending" conditions → ABAC policies.

Skip if you only need "is the user an admin" — `authMiddleware("admin")` from `@warlock.js/auth` already covers coarse type gating.

## The two-stage model (important)

- **Class-level** (no resource): _"can this user update orders at all?"_ → `requirePermission("orders.update")` in middleware, `can(user, "orders.update")` in code. Cheap, cached, runs before the controller.
- **Instance-level** (a resource): _"can they update THIS order?"_ → `authorize(user, "orders.update", { resource: order })` in the service, after you load the row. Runs the registered policy on top of the grant.

## Skills index

- [`configure-access`](@warlock.js/access/configure-access/SKILL.md) — the `roles` map, the resolver, `tenant` + cache config.
- [`check-permissions`](@warlock.js/access/check-permissions/SKILL.md) — `can` / `cannot` / `canAll` / `canAny` / `authorize*` + the `require*Permission(s)` middleware.
- [`define-policies`](@warlock.js/access/define-policies/SKILL.md) — `definePolicy` for ownership / tenant / state conditions (ABAC).
- [`manage-roles`](@warlock.js/access/manage-roles/SKILL.md) — assign / revoke roles + `hasRole` / `hasAnyRole` / `hasAllRoles` + the `UserRole` table.
- [`implement-resolver`](@warlock.js/access/implement-resolver/SKILL.md) — connect the engine to your storage (a column, a pivot, a token claim).

## What it deliberately doesn't do

- **Authentication.** Use `@warlock.js/auth`; `access` reads `request.user`.
- **A runtime permission admin UI.** Permissions are code-defined strings (your catalog).
- **ReBAC graphs / row-level query scoping.** Use a policy for "own resource"; graph-scale relationships are out of scope.

## See also

- [`@warlock.js/auth/overview/SKILL.md`](@warlock.js/auth/overview/SKILL.md) — authentication, the layer below.
- [`@warlock.js/auth/protect-routes/SKILL.md`](@warlock.js/auth/protect-routes/SKILL.md) — `authMiddleware`; stack `requirePermission` after it.
