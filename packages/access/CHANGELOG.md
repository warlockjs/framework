# Changelog — @warlock.js/access

All notable changes to `@warlock.js/access` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.2.0

### Added

- Initial release — authorization (RBAC + ABAC) for Warlock apps, composing with `@warlock.js/auth`.
- Permission checks: `can` / `cannot` / `canAll` / `canAny` (boolean), `authorize` / `authorizeAll` / `authorizeAny` (throw `ForbiddenError`, `AccessErrorCodes.Forbidden` = `EC100`), and `gate` / `gateAny` / `gateAll` route middleware. Wildcards (`orders.*`) and a `*` super-grant.
- Role checks: `hasRole` / `hasAnyRole` / `hasAllRoles`.
- `definePolicy` — ABAC conditions evaluated on instance checks (when a `resource` is supplied), AND-combined with the RBAC grant.
- A **required** `AccessResolver` config seam (the role→permission catalog lives inside it), with `DefaultAccessResolver` (inline role column → code map) for a fixed catalog. Storage is ejected into app-land via `npx warlock add access` (the DB-backed `DatabaseAccessResolver` + `Role` / `UserRole` tables). The framework's access connector wires `config/access.ts` at boot via `setAccessConfig`; a missing resolver throws `AccessConfigError` loudly **at startup** rather than silently denying.
- Resolver contract methods are `resolveRoles(user, tenant?)` and `resolvePermissions(user, tenant?)`.
- Optional `resolveTenant(user)` on the resolver for ambient tenant scoping (or pass an explicit `tenant` argument). It takes the authenticated user so the tenant is derived from the user (e.g. `user.get("organization_id")`) rather than from client-supplied request input.
- The ejected `UserRole.assign` / `UserRole.revoke` flush the affected user's cached set automatically — a manual `access.flush` is only needed for out-of-band changes (a role's permission set changing in the `Role` catalog, or a user's role column changing outside `UserRole`).
- Per-`(user, tenant)` cached resolution — best-effort cache that degrades to the resolver, with a fail-closed decision — `cache: { ttl }` config, plus `access.flush`.
