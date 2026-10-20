---
description: 'Filesystem helpers with sync names and `Async` variants: `fs`, `File`, `Directory`, `getJsonFileAsync`, `atomicWriteAsync`, `hashFileAsync` and `createConfinedReader`. Use for "read JSON", "write atomically", "copy a directory", "hash a file" or "read a folder without escaping it". Not this package → @warlock.js/core for uploads/storage; @warlock.js/ai-workspace for agent file tools with policy enforcement.'
---

# @warlock.js/fs

Two layers: flat functions (`getFile`, `putFile`, `copyFile`, ...; append `Async` for the promise version) and an async facade, `fs.files.*` / `fs.dirs.*`, with `File` and `Directory` handles. There is one name per operation, no aliases.

## The 80% path

1. Use this index for orientation and choose a task below.
2. Read and write files and JSON: `read-and-write-files.md`.
3. Create, list, copy, remove directories: `manage-directories.md`.
4. Prefer the facade for chained work: `use-the-fs-facade.md`.
5. Anything that must not be half-written (config, state, indexes): `write-atomically.md`.
6. Content checks and cache keys: `hash-files.md`.
7. Multi-file state, CAS, recovery, replay and consistent snapshots: `multi-file-transactions.md`.
8. Reading a folder you do not control (user-chosen, extracted upload): `read-a-folder-confined.md`.

## Conventions and pitfalls

- `fs.files.*` and the flat helpers follow symlinks and accept any path; for an untrusted folder use `fs.confined(root)`, which refuses escapes and links and caps reads (`FsPathEscapeError`, `FsLinkRefusedError`, `FsLimitExceededError`).
- Choose `Async` in servers; sync variants block the event loop.
- Use atomic writes for files read by other processes; plain `putFile` can leave a truncated file on crash.
- JSON helpers can validate against a Standard Schema (for example a `@warlock.js/seal` schema); failures throw `JsonSchemaValidationError`.
- On Windows a rename can hit transient lock errors; `atomicWriteAsync` already retries them and throws `AtomicWriteError` if it gives up.

## Server-only package

`@warlock.js/fs`'s entire runtime surface is server-only — its `package.json` declares `"warlock": { "environment": "server" }`. This is build-boundary metadata read by `@warlock.js/web`'s Gate A (import resolution) and Gate C (emitted-bundle verification), not application behavior. App code that reaches the client bundle (including page and layout modules) must not value-import `@warlock.js/fs` — Gate A refuses the build. A type-only import (`import type { ... }`) is allowed. Server loaders, controllers, and modules may import it freely.

## When to reach for it

- You're inside a `@warlock.js/*` project — every other framework package already depends on this one. Use it for consistency.
- You're outside Warlock but want one import that gives you sane defaults (auto-mkdir on writes, idempotent deletes, streaming hashes, atomic config writes).
- You're choosing between `node:fs` and a wrapper — and want a small, opinionated surface (~40 exports) rather than the kitchen sink of **fs-extra** or the patching-Node behavior of **graceful-fs**.

Skip if your code path is one-off and bare `node:fs/promises` is already imported elsewhere — there's no value in adding a dependency for a single `readFile`.

## Convention — read these once and you know the shape

- **`*Async` is async** (returns `Promise<…>`). Use these in server / runtime code.
- **Bare name is synchronous.** Use these in CLI tools, code generators, and one-shot scripts where blocking the loop doesn't matter.
- **One canonical name per operation.** No aliases (`unlinkAsync`, not `deleteAsync` or `removeAsync` for the same thing). Reach for the obvious name; if you don't find it, it doesn't exist.
- **Writes auto-create parent directories.** `putFileAsync("./a/b/c.txt", …)` works without a separate `ensureDirectory("./a/b")` first.
- **Deletes are ENOENT-safe.** `unlinkAsync` and `removeDirectoryAsync` no-op on missing targets. Other errors (`EACCES`, `EBUSY`) still throw.

## What this package deliberately doesn't do

- **Globbing.** Use `tinyglobby` / **fast-glob**. Adding a glob engine here would double the surface for one use case. (Recursive listing/traversal _is_ covered — `fs.dirs.walk` and `fs.dirs.list*({ recursive })`.)
- **Watching.** Use `chokidar` or `node:fs.watch` directly. Watchers have their own lifecycle that doesn't fit the one-shot utility shape.
- **Permissions / chmod / chown.** Out of scope. Reach for `node:fs/promises`'s `chmod` / `chown` directly when you need them.
- **Streaming pipelines beyond hashing.** This isn't a general streams library; it's a wrapper for the common one-shot file operations.

## See also

- The `warlock-conventions` topic of the `warlock-js-core` skill — the parent framework's conventions; `fs` is one of its foundation packages.
