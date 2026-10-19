# Changelog — @warlock.js/fs

All notable changes to `@warlock.js/fs` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). `@warlock.js/*` packages are released in lockstep — every package shares the same version number, so a version below may list only the changes that affected this package.

## 5.34.0

### Added

- `fs.transaction` and `fs.openTransactions`: root-scoped multi-file staging with read-your-writes, content-hash/root-epoch preconditions, process ownership, durable intent journals, automatic roll-forward recovery and operation-id result replay.
- Read-only `fs.inspectTransactions`, bounded epoch-checked `fs.read`, and root-bound `read` / `readMany` for consistent snapshots. Document single-host cooperating-process limits and explicit file-only durability on Windows.
- Optional `atomicWriteAsync(path, content, { durability: "file" | "full" })` flushes file bytes before rename and, with full durability, directory entries afterward. Existing unflushed defaults remain unchanged.

## 5.32.0 - 2026-10-18

### Changed

- Pin the package development compiler to TypeScript 7.0.2 and use explicit Node types and source roots with supported module resolution.

## 5.31.0 - 2026-10-18

### Added

- `fs.confined(root, options)` / `createConfinedReader(root, options)`: a reader confined to one folder, for folders you do not control (a user-chosen import folder, an extracted upload). `readText`, `readBuffer`, `readJson` (optional Standard Schema), `stat`, `exists`, `list` and `walk` (async, depth-first) take root-relative paths. The root is canonicalised once and refused when it is itself a symlink (unless `allowSymlinkedRoot`); absolute paths and `..` that climb above the root throw `FsPathEscapeError`; every path component is checked with `lstat` and a symlink or Windows junction anywhere throws `FsLinkRefusedError`; files are opened with `O_NOFOLLOW` where available and the opened handle's device/inode must match the checked entry, so a file or parent folder swapped between check and open is refused. `maxFileBytes` (default 16 MiB) is enforced while reading, `maxEntries` (default 100 000) and `maxDepth` (default 64) bound `list`/`walk`, with `FsLimitExceededError`. `followLinks: true` follows only links whose target stays inside the root.
- `FsPathEscapeError`, `FsLinkRefusedError`, `FsLimitExceededError` (each with a `type` discriminator, `path` and the reason or limit), the `ConfinedReader` / `ConfinedEntry` / `ConfinedStats` types, and `isPathInside(child, root)`.

### Changed

- Clarify the concurrency contract of `moveDirectoryNoReplaceAsync` / `fs.dirs.moveNoReplace` at the call-site documentation: the exclusive destination claim protects cooperating writers, while an empty placeholder swapped before its first identity read or after its last check can still be replaced. `expectedSource` and `syncParents` do not eliminate those windows. Deterministic interleaving tests preserve these documented limits.

## 5.30.0 - 2026-10-16

### Added

- `moveDirectoryNoReplaceAsync(from, to, { expectedSource?, syncParents? })` (also `fs.dirs.moveNoReplace`): moves a directory only when nothing holds the destination, refusing atomically instead of replacing an empty directory the way `rename()` does. It claims the name with an exclusive `mkdir`, renames over that placeholder, verifies the moved `(dev, ino)` and never falls back to copy + delete.
- `DirectoryMoveError` with `outcome` (`not-moved`: this call moved and replaced nothing / `moved` / `uncertain`), `reason`, and `placeholderCleanupError` when the empty placeholder it claimed could not be removed; `directoryIdentityAsync()` and the `DirectoryIdentity` type. When the source vanishes just before the rename the claim is released and the error is `not-moved` / `source-identity-mismatch`. The destination parent may be a symlink to a directory (macOS `/tmp`, a deploy `current` link). POSIX only: refuses explicitly on Windows and across filesystems.

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

## 5.16.0 - 2026-09-18

### Fixed

- Skill code samples are now self-contained and type-check as written.

## 5.13.0 - 2026-09-17

### Changed

- Portable `typecheck` script: runs against this package's own `typescript` devDependency instead of relying on a hoisted binary from elsewhere in the workspace.

## 5.12.0 - 2026-09-16

### Fixed

- Atomic writes on Windows no longer fail intermittently with `EPERM` / `EBUSY` when another process briefly holds the target; the rename is retried with a short backoff, and a clear `AtomicWriteError` is thrown if it never succeeds.

## 5.5.0 - 2026-09-07

### Fixed

- Documentation shipped in this package's `skills/` told users to run `pnpm`-specific commands. `pnpm <binary>` has no npm equivalent, so those instructions failed outright for anyone not using pnpm. Commands are now package-manager neutral.

## 5.2.2

- Documented: the README, CHANGELOG, and `overview` skill now describe the
  already-shipped `package.json` `"warlock": { "environment": "server" }`
  marker — `@warlock.js/fs`'s entire runtime surface is server-only. The
  marker is build-boundary metadata read by `@warlock.js/web`'s Gate A
  (import resolution) and Gate C (emitted-bundle verification); app client
  code must not value-import this package, type-only imports are allowed, and
  server loaders/controllers/modules may import it freely. No source change.

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
