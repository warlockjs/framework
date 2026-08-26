# Changelog — @warlock.js/access

All notable changes to `@warlock.js/access` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.1.0

No changes to `@warlock.js/access`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/access`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/access`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

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
