# Changelog — @warlock.js/context

All notable changes to `@warlock.js/context` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

- Adds a `test` script. The package shipped a `tests/` directory with no way to run it, so the suite was reachable only by knowing to type `npx vitest` — which resolves whatever happens to exist in the tree rather than anything the manifest asked for

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
