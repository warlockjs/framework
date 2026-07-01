---
name: overview
description: 'Front-door orientation for `@warlock.js/fs` — filesystem primitives (read/write/JSON, dirs, copy/rename/delete, atomic writes, hashing, existence + stats). Two-suffix convention: `*Async` returns Promise, bare name is sync. Single canonical name per operation — no aliases. TRIGGER when: code imports anything from `@warlock.js/fs`; user asks "what does @warlock.js/fs do", "is fs the right package for X", "list all fs helpers", "fs sync vs async convention"; package.json adds `@warlock.js/fs`; user is choosing between fs vs `node:fs/promises`/`fs-extra`/`graceful-fs`. Skip: specific task already known — load the matching task skill directly (`@warlock.js/fs/read-and-write-files/SKILL.md`, `@warlock.js/fs/manage-directories/SKILL.md`, `@warlock.js/fs/write-atomically/SKILL.md`, `@warlock.js/fs/hash-files/SKILL.md`), or the ergonomic async facade (`fs.files.*` / `fs.dirs.*` / `fs.file()` / `fs.dir()`) — `@warlock.js/fs/use-the-fs-facade/SKILL.md`; the user is using plain `node:fs` and not touching fs imports.'
---

# `@warlock.js/fs` — overview

Thin, opinionated wrapper over `node:fs` and `node:fs/promises`. Same operations you'd write by hand against the Node primitives, but with consistent naming, parent-directory auto-creation, ENOENT-safe deletes, atomic writes, and streaming hashes — the boring-but-load-bearing utilities every backend grows by month two anyway.

## When to reach for it

- You're inside a `@warlock.js/*` project — every other framework package already depends on this one. Use it for consistency.
- You're outside Warlock but want one import that gives you sane defaults (auto-mkdir on writes, idempotent deletes, streaming hashes, atomic config writes).
- You're choosing between `node:fs` and a wrapper — and want a small, opinionated surface (~40 exports) rather than the kitchen sink of `fs-extra` or the patching-Node behavior of `graceful-fs`.

Skip if your code path is one-off and bare `node:fs/promises` is already imported elsewhere — there's no value in adding a dependency for a single `readFile`.

## Convention — read these once and you know the shape

- **`*Async` is async** (returns `Promise<…>`). Use these in server / runtime code.
- **Bare name is synchronous.** Use these in CLI tools, code generators, and one-shot scripts where blocking the loop doesn't matter.
- **One canonical name per operation.** No aliases (`unlinkAsync`, not `deleteAsync` or `removeAsync` for the same thing). Reach for the obvious name; if you don't find it, it doesn't exist.
- **Writes auto-create parent directories.** `putFileAsync("./a/b/c.txt", …)` works without a separate `ensureDirectory("./a/b")` first.
- **Deletes are ENOENT-safe.** `unlinkAsync` and `removeDirectoryAsync` no-op on missing targets. Other errors (`EACCES`, `EBUSY`) still throw.

## Skills index

Four task skills cover the surface. Load the one that matches what you're trying to do — don't load all four unless you're touring the package.

### [`read-and-write-files/SKILL.md`](@warlock.js/fs/read-and-write-files/SKILL.md)

Read and write text or JSON files; check existence and metadata. Covers
`getFile` / `getFileAsync` / `getJsonFile` / `getJsonFileAsync`,
`putFile` / `putFileAsync` / `putJsonFile` / `putJsonFileAsync`,
`pathExists` / `fileExists` / `directoryExists`,
`lastModified` / `stats`.

Load when reading or writing text or JSON, or gating creation on existence.

### [`manage-directories/SKILL.md`](@warlock.js/fs/manage-directories/SKILL.md)

Create, list, copy, move, and delete directories and files. Covers
`ensureDirectory(Async)`, `list(Async)` / `listFiles(Async)` / `listDirectories(Async)`,
`copyFile(Async)` / `copyDirectory(Async)`, `renameFile(Async)`,
`unlink(Async)`, `removeDirectory(Async)`.

Load when scaffolding, walking trees, snapshotting, cleaning, or moving files around.

### [`write-atomically/SKILL.md`](@warlock.js/fs/write-atomically/SKILL.md)

Write files so concurrent readers never see a half-written state. Covers
`atomicWriteAsync(path, content)` and `atomicWriteJsonAsync(path, value)`.
Sibling temp file + atomic rename — last-writer-wins on contention, no locking.

Load when writing a file that other processes / file watchers / build steps consume in parallel (config, manifest, state, lockfile).

### [`hash-files/SKILL.md`](@warlock.js/fs/hash-files/SKILL.md)

Compute hex digests for files (streaming) or in-memory content. Covers
`hashFile(Async)` (streaming — constant memory),
`hashFileSmallAsync` (one-shot for small files),
`hashString`, `hashBuffer`, plus the `HashAlgorithm` type.
Defaults to SHA-256; supports SHA-1 / MD5 / SHA-512.

Load when fingerprinting for cache invalidation, content-addressable storage, change detection, or file-equality comparison. Never for security (password hashing, signing).

### [`use-the-fs-facade/SKILL.md`](@warlock.js/fs/use-the-fs-facade/SKILL.md)

The ergonomic, **async** shorthand over all the primitives: `fs.files.*` (file ops), `fs.dirs.*` (directory ops), lazy `fs.file(path)` / `fs.dir(path)` handles (`File` / `Directory`), and `fs.exists`. Adds what the flat primitives lack — `append`/`appendLine`/`appendJsonLine`, `size`/`isEmpty`/`count`, `ensure`(ensureFile)/`touch`/`empty`(emptyDir), EXDEV-safe `move`, `walk` + recursive `list*`, `readLines`, `edit`/`editJson`/`mergeJson`/`ensureJson`, schema-validated `getJson`, directory `hash`.

Load when you want the grouped/OO surface, a read-modify-write (patch a file or JSON, merge a config), recursive listing/walking, or `File`/`Directory` handles. (Sync/one-shot code stays on the bare primitives above.)

## What this package deliberately doesn't do

- **Globbing.** Use `tinyglobby` / `fast-glob`. Adding a glob engine here would double the surface for one use case. (Recursive listing/traversal *is* covered — `fs.dirs.walk` and `fs.dirs.list*({ recursive })`.)
- **Watching.** Use `chokidar` or `node:fs.watch` directly. Watchers have their own lifecycle that doesn't fit the one-shot utility shape.
- **Permissions / chmod / chown.** Out of scope. Reach for `node:fs/promises`'s `chmod` / `chown` directly when you need them.
- **Streaming pipelines beyond hashing.** This isn't a general streams library; it's a wrapper for the common one-shot file operations.

## See also

- [`@warlock.js/core/warlock-conventions/SKILL.md`](@warlock.js/core/warlock-conventions/SKILL.md) — the parent framework's conventions; `fs` is one of its foundation packages.
- `mongez-agent-kit-authoring-skills` (load via agent-kit sync) — how this `overview/SKILL.md` becomes the front-door skill in `.claude/skills/warlock-js-fs-overview/`.
