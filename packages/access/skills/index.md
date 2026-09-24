---
description: "Authorization (RBAC + ABAC) for Warlock apps: what a signed-in user is allowed to do. Exports `can`, `authorize`, `gate`, `gateAny`, `definePolicy`, `hasRole`, `access`, `DefaultAccessResolver`, `AccessResolver`, `AccessErrorCodes`. Use for: \"check a permission\", \"restrict this route to users who can update orders\", \"only the owner can edit\", \"roles and permissions\", \"per-tenant roles\", \"custom role storage\". Not this package: login, tokens, user-type gating → @warlock.js/auth; request validation → @warlock.js/seal."
---
# @warlock.js/access

Access is the authorization engine. You supply one adapter, an `AccessResolver`, that reads a user's roles and permissions from your storage; then `can(user, "orders.update")` and `gate("orders.update")` work. Two halves: permissions (RBAC grants) and policies (ABAC conditions). Server-only; reads `request.user`, so it sits beside `@warlock.js/auth`.

## The 80% path
1. Orient with `overview.md`.
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
