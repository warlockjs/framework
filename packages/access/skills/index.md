---
description: 'Authorization with RBAC and ABAC: `can`, `cannot`, `canAll`, `canAny`, `authorize`, `gate`, `gateAny`, `definePolicy`, `hasRole`, `access`, `setAccessConfig` and `AccessResolver`. Use for "check a permission", "only the owner can edit", "403 forbidden", route policies, tenant roles or custom permission storage. Not this package → @warlock.js/auth for login, tokens and user-type guards; @warlock.js/seal for request validation.'
---

# @warlock.js/access

Access is the authorization engine. You supply one adapter, an `AccessResolver`, that reads a user's roles and permissions from your storage; then `can(user, "orders.update")` and `gate("orders.update")` work. Two halves: permissions (RBAC grants) and policies (ABAC conditions). Server-only; reads `request.locals.user`, so it sits beside `@warlock.js/auth`.

## The 80% path

1. Use this index for orientation and choose a task below.
2. Configure the required resolver: `configure-access.md` (`DefaultAccessResolver` for a code-defined catalog, or the ejected DB one); custom storage in `implement-resolver.md`.
3. Gate routes and check in code: `check-permissions.md`.
4. Add "only their own / only while pending" rules: `define-policies.md`.
5. Assign and revoke roles: `manage-roles.md`.

## Conventions and pitfalls

- Two stages: class-level (`gate`, `can`) asks "can they at all?"; instance-level (`authorize` with a `resource`) runs the policy on the loaded row.
- Decisions fail closed; a missing resolver is a config error, not a default allow.
- Stack `gate` after `authMiddleware`; access does not authenticate.
- After changing a user's roles, flush the cache (`access.flush`) or old grants linger.
- Only need "is admin"? `authMiddleware("admin")` from auth is enough.
- Do not value-import from client code; type-only imports are fine.

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

## What it deliberately doesn't do

- **Authentication.** Use `@warlock.js/auth`; `access` reads `request.locals.user`.
- **Ship a permission admin UI.** The engine reads permission strings; whether the catalog is code-defined (`DefaultAccessResolver`) or DB-managed (the ejected `DatabaseAccessResolver`) is your resolver's choice — the package ships no admin screens.
- **ReBAC graphs / row-level query scoping.** Use a policy for "own resource"; graph-scale relationships are out of scope.

## See also

- The `warlock-js-auth` skill index — authentication, the layer below.
- The `protect-routes` topic of the `warlock-js-auth` skill — `authMiddleware`; stack `gate` after it.
