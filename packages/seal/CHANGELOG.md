# Changelog — @warlock.js/seal

All notable changes to `@warlock.js/seal` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 4.15.0

### Dependencies

- Bumped `@mongez/supportive-is` to `^2.1.4` (no breaking changes) and `@mongez/reinforcements` to `^4.0.1`. The reinforcements major makes `Random.string/nanoid/id/token/uuid` CSPRNG-backed (WebCrypto) and removes `Random.seed()` support — audited this package's source and tests for `Random.seed(` and for seeded/reproducible use of `Random.*`; none found, so no code changes were needed.

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.9.2

### Fixed

- `v.literal("")` could never pass. Every validator is required by default and `required` rejects anything the empty-value check calls empty — which includes `""` — so a schema demanding an exact empty string reported "is required" for a field that was present. A literal set containing an empty value now uses `present` (the key must exist) instead of `required`, leaving the literal set to judge the value. Only the empty string was affected; `v.literal(0)` and `v.literal(false)` always worked
- `v.literal("").optional()` silently disabled the literal check rather than fixing it, accepting `""`, `null` **and** a missing key alike. The literal rule now runs on empty values (`requiresValue: false`) while treating absence as the required/present rule's question, so `.optional()` means optional again and a present value must still match
- a **failed** validation no longer returns the input it rejected. `object` returned the raw input — including the unknown keys it had just complained about — while `discriminatedUnion` returned `undefined`; the same call shape had two contracts. Validating an outbound DTO to keep internal fields out of a response, then reading `data` without branching on `isValid`, shipped every field the schema existed to exclude. `data` is now `undefined` whenever `isValid` is `false`
- `v.number().toFixed(n)` could never produce a valid result — the mutator returned `Number(value).toFixed(n)`, a *string*, which the validator's own `number` type rule then rejected. It now yields a number (`3.14159` → `3.14`), so the method works where it lives. No working code can have depended on the old output, since every such validation failed; for a fixed-point *string*, format at the presentation edge rather than asking a number schema to emit one

## 4.2.11

### Changed

- Bumped `@mongez/reinforcements` to 3.3.0

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
