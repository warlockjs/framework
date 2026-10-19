# Changelog — @warlock.js/access

All notable changes to `@warlock.js/access` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.34.2

### Fixed

- Merge package orientation into the grouped skill index and remove the duplicate overview topic; preserve that orientation in generated LLM projections.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Fixed

- Access skills no longer end in stray code fences, and the cache configuration recipe is an object expression rather than a labelled statement.

## 5.29.0 - 2026-10-01

### Changed

- Skills refer to other topics by name instead of file paths, so cross-references keep working after `agent-kit` copies them into an app.

## 5.28.0 - 2026-10-01

### Changed

- `llms.txt` now lists every skill topic with its description (frontmatter in CRLF files was skipped).

## 5.20.0 - 2026-09-24

### Changed

- Added a package-level skill index and clearer discovery descriptions for grouped agent guidance.

## 5.19.0 - 2026-09-23

### Changed

- Refined package skill-discovery descriptions and regenerated the llms projections.

## 5.13.0 - 2026-09-17

### Upgrading

- Access checks are now deny-by-default: an instance-level check for a permission with no registered ABAC policy DENIES instead of falling back to the RBAC grant alone. If you rely on the old fail-open fallback, set `strictPolicies: false` in `src/config/access.ts`; otherwise register the `definePolicy(...)` calls the new log warnings name.

### Breaking

- **BREAKING:** `strictPolicies` now defaults to `true`. An instance-level check (`{ resource }`) for a permission with no registered ABAC policy now DENIES by default instead of silently falling back to the RBAC grant alone. Set `strictPolicies: false` in `src/config/access.ts` to restore the old fallback, or register the missing `definePolicy(...)` calls the log warnings point to.

### Fixed

- Restored the portable `typecheck` script and compile access as ESM so workspace source imports using `import.meta` are valid.
- An unpoliced instance-level check was fail-open (allowed via the RBAC grant alone) unless `strictPolicies` was explicitly enabled, which could silently reach a resource-scoped IDOR for a forgotten `definePolicy` call. It now fails CLOSED by default; `strictPolicies: false` still restores the old fallback and warns once per permission naming the missing policy and the config key.

## 5.12.0 - 2026-09-16

### Changed

- Follows `@warlock.js/core` and `@warlock.js/auth`'s 5.12.0 move of the authenticated user from `request.user` to `request.locals.user`: `gate()` / `gateAny()` / `gateAll()` now read `request.locals.user` instead of the removed `request.user`. No change to `can()` / `canAny()` / `canAll()` themselves, and no change to the app-side contract — an app still augments `RequestUser` (now declared by `@warlock.js/auth`) to its own `Auth`-derived model.

## 5.7.0 - 2026-09-11

### Fixed

- `resolvePermissions` could push `undefined` into a role's permission list when the role's stored value was missing, instead of granting that role no permissions. A role that cannot be read now grants nothing, rather than risking an `undefined` entry reaching a permission check downstream.

## 5.2.2

- `package.json` now declares `"warlock": { "environment": "server" }` — build-boundary metadata `@warlock.js/web` uses to refuse value-imports of this package from app client code (type-only imports are still allowed; server loaders/controllers/modules are unaffected).

## 5.0.0 - 2026-08-25

### Upgrading

- **BREAKING — access no longer augments `RequestUser`.** The package previously declared `interface RequestUser extends Auth<ModelSchema>` globally, which typed `request.user` for every consumer — and, because an interface has exactly one class-extends slot, made it impossible for an app to augment `RequestUser` to its OWN auth model (the app's `interface RequestUser extends User {}` failed with TS2320 whenever access was installed). The contract is now explicit: **an app using gates augments `RequestUser` to its own `Auth`-derived model**; access asserts that contract once, internally (`authUserOf`), instead of claiming the type. If your app relied on access's blanket typing, add the augmentation yourself, in the module that writes `request.user`:

  ```typescript
  declare module "@warlock.js/core" {
    interface RequestUser extends User {}
  }
  ```

## 4.16.0 - 2026-08-18

### Security

- Instance-level checks (a `resource` supplied to `check`/`authorize`) that match an RBAC grant but have no registered ABAC policy now emit a one-time `log.warn` naming the permission, instead of silently falling back to the RBAC grant alone — a typo'd permission name or a forgotten `import "./policies"` side-effect previously degraded a resource-scoped check to a class-level one with no runtime signal, a silent IDOR footgun. Fail-closed/fail-open semantics are unchanged everywhere else; this is visibility only. Added an opt-in `strictPolicies: true` access config flag that throws `AccessConfigError` instead of warning, for apps that want the gap to fail the request/boot rather than just log.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.2.0

### New

- Shipped Warlock.js Access Package.
