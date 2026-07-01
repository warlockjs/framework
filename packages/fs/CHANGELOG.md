# Changelog — @warlock.js/fs

All notable changes to `@warlock.js/fs` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

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
