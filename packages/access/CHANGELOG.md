# Changelog — @warlock.js/access

All notable changes to `@warlock.js/access` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## [Unreleased]

## 4.2.0

### Added

- Initial release — authorization (RBAC + ABAC) for Warlock apps, composing with `@warlock.js/auth`.
- Permission checks: `can` / `cannot` / `canAll` / `canAny` (boolean), `authorize` / `authorizeAll` / `authorizeAny` (throw `ForbiddenError`, `AccessErrorCodes.Forbidden` = `EC100`), and `requirePermission` / `requireAny` / `requireAll` route middleware. Wildcards (`orders.*`) and a `*` super-grant.
- Role checks: `hasRole` / `hasAnyRole` / `hasAllRoles`, plus `access.assign` / `access.revoke`.
- `definePolicy` — ABAC conditions evaluated on instance checks (when a `resource` is supplied), AND-combined with the RBAC grant.
- Pluggable `AccessResolver` contract with two built-ins: `DefaultAccessResolver` (inline role column → code map) and `ModelAccessResolver` (the overridable `UserRole` table → code map).
- Per-`(user, tenant)` cached resolution — best-effort cache that degrades to the resolver, with a fail-closed decision — plus `access.flush`.
- Tenant scoping via an explicit `tenant` argument or the `config.access.tenant.resolve` hook.
