---
name: use-the-fs-facade
description: 'Use the ergonomic `fs` shorthand facade in `@warlock.js/fs` — `fs.files.*` (file ops), `fs.dirs.*` (directory ops), and lazy `fs.file(path)` / `fs.dir(path)` handles (`File` / `Directory`), plus `fs.exists(path)`. Async-only (delegates to the `*Async` primitives). Adds ops the flat primitives lack: `append`/`prepend`/`appendLine`/`appendJsonLine`, `size`/`isEmpty`/`count`, `ensure`(ensureFile)/`touch`/`empty`(emptyDir), EXDEV-safe `move`, `walk` + recursive `list*`, `readLines`, `edit`/`editJson`/`mergeJson`/`ensureJson`, `getJson({ schema })` (any Standard Schema — seal/zod/valibot), `checksumMatches`, directory `hash`, handle path helpers (`name`/`extension`/`basename`/`parent`/child `file`/`dir`). TRIGGER when: code uses `fs.files.`/`fs.dirs.`/`fs.file(`/`fs.dir(`; user wants a "read-modify-write"/patch a file or JSON, "merge into a config json", "list files recursively", "walk a directory", "get-or-create a json", "append a log line/NDJSON", "directory size/fingerprint", "File/Directory object"; user asks the ergonomic/OO way to do fs. Skip: sync/one-shot code — use the bare primitives (`getFile`/`putFile`/…) via `read-and-write-files` / `manage-directories`; path sandboxing/uploads — that is the storage layer, not fs.'
---

# `@warlock.js/fs` — the `fs` shorthand facade

`fs.*` is an **async, ergonomic** surface over the flat primitives. Group file ops under `fs.files.*`, directory ops under `fs.dirs.*`, and reach for lazy `fs.file(path)` / `fs.dir(path)` handles when you want an object. Sync callers stay on the bare primitives (`getFile` / `putFile` / …) — the facade never carries an `Async` suffix and never blocks.

> **fs does NOT sandbox paths.** It's the raw-IO layer; path containment (traversal guards, roots) is the storage layer's job.

```ts
import { fs } from "@warlock.js/fs";

await fs.files.put("cache/data.json", "{}", { atomic: true });     // temp+rename; creates parents
const cfg = await fs.files.getJson("config.json", { default: {} }); // no throw when missing
await fs.files.editJson<Pkg>("package.json", (p) => ({ ...p, version: "4.7.0" }));
await fs.files.appendJsonLine("logs/audit.ndjson", { userId, action }); // one JSON record per line
```

## `fs.files.*`

Reads/writes: `get(path, { encoding? })` (string; `encoding:null` → `Buffer`), `getJson(path, { schema?, default? })`, `put(path, content, { atomic?, overwrite?, ensureDir?, encoding? })`, `putJson(path, value, { indent? })`, `create`/`createJson` (= `put`/`putJson` with `overwrite:false`), `append`/`prepend`, `appendLine`, `appendJsonLine`.

Read-modify-write (the win over `put`): `edit(path, (text) => text)`, `editJson(path, (value) => value)`, `mergeJson(path, partial, { deep? })`, `ensureJson(path, fallback)` (get-or-create).

Info + housekeeping: `exists`, `isEmpty`, `size`, `stats` (→ `{ path, name, size, type, lastModified, raw }`), `lastModified`, `hash`, `checksumMatches(path, expected)`, `readLines(path)` (async iterator), `ensure` (create-if-missing, never truncates), `touch`, `remove` (ENOENT-safe), `copy`, `move` (EXDEV-safe: creates parent, falls back to copy+unlink across devices).

`get()` returns a **`string`** by default (overloaded — no cast); pass `{ encoding: null }` for a `Buffer`.

## `fs.hash.*` — hashing

`fs.hash.string(content)` / `fs.hash.buffer(bytes)` are **sync** (pure, in-memory — no `await`); `fs.hash.file(path)` / `fs.hash.dir(path)` are **async** (read from disk). Defaults to SHA-256. (Handles also expose `file.hash()` / `directory.hash()`.)

### The JSON family — pick the right one
- `getJson` — read (+ optional `schema` validation, + `default` when missing).
- `putJson` — overwrite the whole document.
- `mergeJson(path, partial, { deep? })` — **patch an object** (shallow spread; `deep:true` recurses).
- `editJson(path, fn)` — arbitrary transform, e.g. push into an array `(arr) => [...arr, x]`.
- `ensureJson(path, fallback)` — return the parsed doc, or create it with `fallback`.
- `appendJsonLine(path, value)` — **NDJSON**: one JSON record per line (a log/journal), NOT one JSON document; never parses or merges.

### Schema-validated reads (`getJson({ schema })`)
`schema` is any [Standard Schema](https://standardschema.dev) validator — `@warlock.js/seal` (every seal validator qualifies), zod, valibot. fs calls the schema's own `~standard.validate`, so there's **no dependency** on any validator. A failed read throws `JsonSchemaValidationError`.

```ts
import { v } from "@warlock.js/seal";
const cfg = await fs.files.getJson("config.json", { schema: v.object({ port: v.number() }) });
```

## `fs.dirs.*`

`ensure`, `remove` (recursive), `empty` (clear contents, keep the dir), `exists`, `isEmpty`, `count`, `copy`, `move` (EXDEV-safe), `stats`, `size` (recursive byte sum), `list` / `listFiles` / `listDirs` (add `{ recursive: true }`), `walk(path, { recursive?, followSymlinks? })` (constant-memory async iterator of `{ path, name, type }`), `hash` (stable directory fingerprint).

```ts
for await (const entry of fs.dirs.walk("src")) { /* { path, name, type: "file"|"directory" } */ }
const tsFiles = await fs.dirs.listFiles("src", { recursive: true });
```

## `fs.file(path)` / `fs.dir(path)` — lazy, immutable handles

The constructor does **zero IO**. Path helpers are pure `node:path`; `copy`/`move`/`rename`/`copyTo`/`moveTo` return a **new** handle and never mutate `this.path`.

```ts
const pkg = fs.file("package.json");
pkg.name;        // "package.json"
pkg.extension;   // ".json"
pkg.basename;    // "package"
pkg.parent();    // Directory handle
await pkg.editJson<Pkg>((p) => ({ ...p, version: "4.7.0" }));

const src = fs.dir("src");
for (const f of await src.listFiles({ recursive: true })) {   // File[]
  if (f.extension === ".ts") await f.appendJsonLine({ /* … */ });
}
const moved = await fs.file("a.txt").moveTo(fs.dir("archive"));  // new File handle
```

`Directory.file(...segments)` / `.dir(...segments)` build child handles; `listFiles`/`listDirs` return `File[]` / `Directory[]`.

## Facade vs primitives — when to use which
- **Facade (`fs.*`)** — async app/runtime code; read-modify-write; JSON patching; recursive listing/walking; you want an OO handle. One import, ergonomic verbs.
- **Bare primitives (`getFile`/`putFile`/…)** — synchronous CLI tools / codegen / one-shot scripts (no `Async`), or when you want the smallest possible call. See [`read-and-write-files`](@warlock.js/fs/read-and-write-files/SKILL.md) / [`manage-directories`](@warlock.js/fs/manage-directories/SKILL.md).

## Gotchas
- **Async-only facade.** There is no `fs.filesSync`; for sync use the bare primitives.
- **`edit`/`mergeJson` are sugar, not a lock.** Concurrent edits race (last-write-wins); `atomic` only makes the *write* atomic, not the read+write pair. No file locking.
- **`get()` reads the whole file.** For large text use `readLines`; for large-file digests `hash` already streams.
- **Still no glob / watch / chmod** — see the [overview](@warlock.js/fs/overview/SKILL.md). Use `walk` + filter instead of glob.

## See also
- [`overview/SKILL.md`](@warlock.js/fs/overview/SKILL.md) — the package front door + the `*Async`/bare convention.
- [`write-atomically/SKILL.md`](@warlock.js/fs/write-atomically/SKILL.md) — `put({ atomic })` delegates to this.
