---
description: "Filesystem primitives for Warlock.js: sync and async file/dir operations with one canonical name each (`*Async` is async, bare name is sync). Exports `fs`, `File`, `Directory`, `getJsonFileAsync`, `putFileAsync`, `atomicWriteAsync`, `atomicWriteJsonAsync`, `ensureDirectoryAsync`, `copyDirectoryAsync`, `listFilesAsync`, `hashFileAsync`. Use for: \"read a JSON file\", \"write a file without corrupting it on crash\", \"create a directory recursively\", \"hash a file\", \"list files in a folder\". Not this package: uploads and storage drivers live in @warlock.js/core; config loading is a core concern."
---
# @warlock.js/fs

Two layers: flat functions (`getFile`, `putFile`, `copyFile`, ...; append `Async` for the promise version) and an async facade, `fs.files.*` / `fs.dirs.*`, with `File` and `Directory` handles. There is one name per operation, no aliases.

## The 80% path
1. Orient: `overview.md`.
2. Read and write files and JSON: `read-and-write-files.md`.
3. Create, list, copy, remove directories: `manage-directories.md`.
4. Prefer the facade for chained work: `use-the-fs-facade.md`.
5. Anything that must not be half-written (config, state, indexes): `write-atomically.md`.
6. Content checks and cache keys: `hash-files.md`.

## Conventions and pitfalls
- Choose `Async` in servers; sync variants block the event loop.
- Use atomic writes for files read by other processes; plain `putFile` can leave a truncated file on crash.
- JSON helpers can validate against a Standard Schema (for example a `@warlock.js/seal` schema); failures throw `JsonSchemaValidationError`.
- On Windows a rename can hit transient lock errors; `atomicWriteAsync` already retries them and throws `AtomicWriteError` if it gives up.
