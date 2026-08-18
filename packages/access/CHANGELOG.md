# Changelog — @warlock.js/access

All notable changes to `@warlock.js/access` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.15.0

### Security

- Instance-level checks (a `resource` supplied to `check`/`authorize`) that match an RBAC grant but have no registered ABAC policy now emit a one-time `log.warn` naming the permission, instead of silently falling back to the RBAC grant alone — a typo'd permission name or a forgotten `import "./policies"` side-effect previously degraded a resource-scoped check to a class-level one with no runtime signal, a silent IDOR footgun. Fail-closed/fail-open semantics are unchanged everywhere else; this is visibility only. Added an opt-in `strictPolicies: true` access config flag that throws `AccessConfigError` instead of warning, for apps that want the gap to fail the request/boot rather than just log.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.2.0

### New

- Shipped Warlock.js Access Package.
