# Changelog — @warlock.js/fs

All notable changes to `@warlock.js/fs` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.1.0

No changes to `@warlock.js/fs`. Released in lockstep with the `@warlock.js/web`
React-execution fix and the `@warlock.js/core` CLI additions — see those packages'
changelogs.

## 5.0.2 - 2026-08-25

No changes to `@warlock.js/fs`. Released in lockstep with the `@warlock.js/web` SSR
fix (`ssr.noExternal`) — see that package's changelog.

## 5.0.1 - 2026-08-25

No changes to `@warlock.js/fs`. Released in lockstep with the `create-warlock` vite
resolution pin and the `@warlock.js/web` peer narrowing — see those packages'
changelogs.

## 5.0.0 - 2026-08-25

### Changed

- This package is unchanged in 5.0.0; its version moved only because the Warlock family releases in lockstep.

## 4.16.0 - 2026-08-18

### Security

- **`fs.files.mergeJson()` / `File#mergeJson()` now drop `__proto__` / `constructor` / `prototype` keys from both sides of the merge, at every depth.** The deep-merge path assigned with `output[key] = value`, and for a key of `__proto__` that is not a property write — it invokes the inherited setter and reparents the merged object. `JSON.parse` is itself safe but happily produces an own property with that name, so `mergeJson(configPath, requestBody)` — the natural shape for a "PATCH this JSON config" endpoint — let a partial of `{"__proto__":{"isAdmin":true}}` poison the object being written, and any property lookup against the in-memory result resolved through the attacker's data

  The filter also runs on the shallow path and on the object read from disk. Object spread never triggered the setter, so the shallow path was not a live pollution primitive — but both paths persisted the key verbatim, leaving a file that becomes one the moment anything else merges it. Non-literal values (dates, class instances) still pass through untouched and serialize as before

## 4.12.0

### Changed

- Declares its own test runner and pins it to an exact version (`vitest@4.1.10`). The package is its own repository, so a runner resolved from a workspace root it may not be cloned with is a runner it cannot rely on. The pin is exact rather than a range because the version moved underneath the suite mid-development on an unrelated install — a suite whose runner can change without anyone choosing it proves less than it appears to

## 4.7.0

### Added

- `fs` shorthand facade — an async, ergonomic surface over the primitives: `fs.files.*` (file ops), `fs.dirs.*` (directory ops), lazy `fs.file(path)` / `fs.dir(path)` handles (`File` / `Directory` classes), and `fs.exists(path)` (type-agnostic). Delegates to the existing `*Async` primitives; synchronous callers keep using the bare primitives (the `bare = sync` / `*Async = async` charter is unchanged)
- New file ops on the facade: `append` / `prepend` / `appendLine` / `appendJsonLine` (NDJSON), `size`, `isEmpty`, `ensure` (create-if-missing, never truncates), `touch`, `edit` (read → transform → write), `editJson`, `mergeJson` (shallow, or `{ deep: true }`), `ensureJson` (get-or-create), `checksumMatches`, `readLines` (streaming async iterator), and an EXDEV-safe `move` (creates the destination parent, falls back to copy+unlink across devices)
- New directory ops on the facade: `empty` (emptyDir), `size` (recursive byte sum), `count`, `isEmpty`, `walk` (constant-memory async iterator of `{ path, name, type }`), a `recursive` option on `list` / `listFiles` / `listDirs`, and `hash` (stable directory fingerprint)
- `fs.files.getJson(path, { schema })` — validate parsed JSON against any [Standard Schema](https://standardschema.dev) validator (seal / zod / valibot) with **zero dependency** (calls the schema's own `~standard.validate`); throws `JsonSchemaValidationError` on failure. `{ default }` returns a fallback when the file is missing
- `File` / `Directory` handles are lazy (no IO in the constructor) and immutable (`copy` / `move` / `rename` / `copyTo` / `moveTo` return a NEW handle); pure-path helpers `name` / `basename` / `extension` / `parent()` and child `file(...)` / `dir(...)`; `Directory.listFiles()` / `listDirs()` return `File[]` / `Directory[]`
- `fs.hash` namespace — `fs.hash.string` / `fs.hash.buffer` (sync, pure/in-memory) and `fs.hash.file` / `fs.hash.dir` (async, read from disk)
- `fs.files.get()` is overloaded: a text read returns `string` (no cast); pass `{ encoding: null }` for a `Buffer`

## 4.1.15

- Baseline — per-package changelog tracking starts at this version.
