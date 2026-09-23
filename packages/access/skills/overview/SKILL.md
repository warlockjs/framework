---
name: overview
description: "@warlock.js/access overview for orientation and choosing the focused skill for the task."
---

# `@warlock.js/access` — overview

Authorization for Warlock apps. `@warlock.js/auth` answers _who you are_; `access` answers _what you can do_.

Server-only: `package.json` declares `"warlock": { "environment": "server" }`. `@warlock.js/web`'s build refuses app client code that value-imports this package; type-only imports are allowed, and server loaders/controllers/modules are unaffected.

## The mental model in one paragraph

The package owns the **engine** — wildcard matching, caching, ABAC policies, fail-closed decisions. You hand it **one required adapter**, an `AccessResolver`, that reads a user's roles + permissions from however YOUR app stores them (the role→permission catalog lives inside the resolver). Then `can(user, "orders.update")` and `gate("orders.update")` just work. The two concepts inside are **permissions** (RBAC grants) and **policies** (ABAC conditions) — which is why the package is called `access`, not either half.

## When to reach for it

- A Warlock app (already on `@warlock.js/auth`) that needs per-action / per-resource authorization beyond auth's user-type gate.
- **Multi-tenant** role scoping — `editor` in tenant A, `viewer` in tenant B.
- "Only their own / only in their tenant / only while pending" conditions → ABAC policies.

Skip if you only need "is the user an admin" — `authMiddleware("admin")` from `@warlock.js/auth` already covers coarse type gating.

## The two-stage model (important)

- **Class-level** (no resource): _"can this user update orders at all?"_ → `gate("orders.update")` in middleware, `can(user, "orders.update")` in code. Cheap, cached, runs before the controller.
- **Instance-level** (a resource): _"can they update THIS order?"_ → `authorize(user, "orders.update", { resource: order })` in the service, after you load the row. Runs the registered policy on top of the grant.

## Skills index

- [`configure-access`](@warlock.js/access/configure-access/SKILL.md) — the required resolver (`DefaultAccessResolver` vs the ejected `DatabaseAccessResolver`), cache + tenant.
- [`check-permissions`](@warlock.js/access/check-permissions/SKILL.md) — `can` / `cannot` / `canAll` / `canAny` / `authorize*` + the `gate*` middleware.
- [`define-policies`](@warlock.js/access/define-policies/SKILL.md) — `definePolicy` for ownership / tenant / state conditions (ABAC).
- [`manage-roles`](@warlock.js/access/manage-roles/SKILL.md) — assign / revoke via the ejected `UserRole` + `access.flush`, `hasRole` / `hasAnyRole` / `hasAllRoles`.
- [`implement-resolver`](@warlock.js/access/implement-resolver/SKILL.md) — connect the engine to your storage (a DB catalog, a column, a pivot, a token claim).

## What it deliberately doesn't do

- **Authentication.** Use `@warlock.js/auth`; `access` reads `request.locals.user`.
- **Ship a permission admin UI.** The engine reads permission strings; whether the catalog is code-defined (`DefaultAccessResolver`) or DB-managed (the ejected `DatabaseAccessResolver`) is your resolver's choice — the package ships no admin screens.
- **ReBAC graphs / row-level query scoping.** Use a policy for "own resource"; graph-scale relationships are out of scope.

## See also

- [`@warlock.js/auth/overview/SKILL.md`](@warlock.js/auth/overview/SKILL.md) — authentication, the layer below.
- [`@warlock.js/auth/protect-routes/SKILL.md`](@warlock.js/auth/protect-routes/SKILL.md) — `authMiddleware`; stack `gate` after it.
