# Changelog — @warlock.js/context

All notable changes to `@warlock.js/context` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.9.0 - 2026-09-13

_Released in lockstep with the `@warlock.js/*` family; no package-specific changes in 5.9.0._

## 5.7.0 - 2026-09-11

### Changed

- Internal type-safety hardening; no behaviour change.

## 5.5.0 - 2026-09-07

### Fixed

- Documentation shipped in this package's `skills/` told users to run `pnpm`-specific commands. `pnpm <binary>` has no npm equivalent, so those instructions failed outright for anyone not using pnpm. Commands are now package-manager neutral.

## 5.2.3 - 2026-09-02

### Fixed

- Released in exact lockstep with Core's Web generator repairs so every family dependency remains installable at 5.2.3.

## 5.2.2

### Maintenance

- Restored the Warlock family to one exact, installable lockstep version.

## 5.1.0

No changes to `@warlock.js/context`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/context`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/context`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

### Security

- **`update()` and `set()` now drop `__proto__` / `constructor` / `prototype` keys instead of merging them.** `update()` merged with `Object.assign(store, updates)`, which does not create a `__proto__` property — it invokes the inherited setter and reparents the store. An app that forwards request-shaped data into a context (`tenantContext.update(req.body)`, or `set(key, value)` with a caller-supplied key — both close to patterns the README shows) therefore handed a body of `{"__proto__":{"isAdmin":true}}` a way to pollute `Object.prototype` for the whole process. Because the polluted object is a *shared* context store, that turns an app-level slip into a cross-request, cross-tenant authorization problem: every later lookup of a missing property anywhere in the process resolves through the attacker's object

  Dangerous keys are dropped rather than throwing — a request that trips this must not be able to take the process down — and the rest of the payload merges as before. Symbol keys and object identity for clean payloads are unchanged (the payload is only copied when a dangerous key is actually present). `run()` / `enter()`, where the caller supplies the whole store rather than merging into a shared one, are untouched

  This closes the prototype vector, not the broader one: merging unvalidated input into a context still lets an attacker choose what your context *says*. Validate before you merge

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

- Adds a `test` script. The package shipped a `tests/` directory with no way to run it, so the suite was reachable only by knowing to type `npx vitest` — which resolves whatever happens to exist in the tree rather than anything the manifest asked for

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
