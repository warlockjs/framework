---
title: "File & Directory handles"
description: fs.file(path) and fs.dir(path) give you lazy, immutable handle objects — pure-path helpers, child handles, and File[] / Directory[] listings you can filter and act on.
sidebar:
  order: 4
  label: "File & Directory handles"
---

Sometimes you don't want to keep threading a string path through five calls. You want an **object** that *is* the file — one you can pass around, ask questions of, and act on. That's `fs.file(path)` and `fs.dir(path)`.

```ts
import { fs } from "@warlock.js/fs";

const pkg = fs.file("package.json");
await pkg.editJson<Pkg>((p) => ({ ...p, version: "4.7.0" }));
```

`pkg` is a `File` handle. Every `fs.files.*` method you already know has a no-path counterpart on the handle — `pkg.get()`, `pkg.exists()`, `pkg.hash()`, `pkg.remove()` — because the handle already knows its path.

## Lazy — the constructor does zero IO

Creating a handle touches the disk **not at all**. `fs.file()` and `fs.dir()` just remember a path; the path helpers are pure `node:path`. Nothing happens until you call a method that reads or writes.

```ts
const report = fs.file("reports/2026-q3.json"); // no IO — the file need not exist
if (await report.exists()) {                     // *now* it touches disk
  const data = await report.getJson();
}
```

So you can build handles freely — in a loop, in a config, ahead of time — without paying for filesystem calls you may never make.

## Immutable — copy / move / rename return a new handle

A handle is a stable reference to *a path*, not a moving target. `copy`, `move`, `rename` (and their `copyTo` / `moveTo` cousins) **never mutate the handle they're called on** — they perform the operation and hand back a brand-new handle pointing at the destination.

```ts
const original = fs.file("draft.md");
const published = await original.rename("final.md"); // File → "final.md"

original.name;  // "draft.md"  ← unchanged
published.name; // "final.md"  ← the new handle
```

The original still points where it always did. This makes handles safe to capture and reuse: nothing you do elsewhere can silently repoint a handle you're holding.

:::note[Same EXDEV-safety as the facade]
`File.move` / `Directory.move` are the cross-device-safe move you get from `fs.files.move`: if source and destination live on different mounts, they fall back to copy-then-delete instead of failing with `EXDEV`.
:::

## Pure-path helpers

`File` exposes the parts of its path with zero IO — great for filtering and building sibling paths.

```ts
const f = fs.file("src/components/Button.tsx");
f.name;       // "Button.tsx"
f.basename;   // "Button"
f.extension;  // ".tsx"
f.parent();   // Directory handle for "src/components"
```

`Directory` mirrors this with `name` and `parent()`.

## Child handles from a directory

A `Directory` builds child handles for you with `file(...segments)` and `dir(...segments)` — no manual `path.join`, no string concatenation.

```ts
const app = fs.dir("app");
const env = app.file("config", ".env");   // File  → "app/config/.env"
const cache = app.dir("storage", "cache"); // Directory → "app/storage/cache"
await cache.ensure();
```

Both accept multiple segments and stay lazy — `env` and `cache` haven't touched disk yet.

## `listFiles()` / `listDirs()` — handles, not strings

The ergonomic win: `Directory.listFiles()` returns `File[]` and `listDirs()` returns `Directory[]`. Because each entry is already a handle, you can filter on `f.extension` and act in the same breath — no re-wrapping.

```ts
const src = fs.dir("src");
for (const file of await src.listFiles({ recursive: true })) {
  if (file.extension === ".ts") {
    console.log(file.basename, await file.size());
  }
}
```

Pass `{ recursive: true }` to descend the whole tree; omit it for immediate children only.

### Walk a tree, hash every `.ts`

Handles make this read almost like a sentence — walk `src`, keep the `.ts` files, hash each one:

```ts
const src = fs.dir("src");
const files = await src.listFiles({ recursive: true });
const scripts = files.filter((f) => f.extension === ".ts");

for (const file of scripts) {
  console.log(file.name, await file.hash()); // SHA-256 per file
}
```

If you only ever need the paths (not a `File[]`), reach for `fs.dirs.walk` instead — it's a constant-memory async iterator that yields `{ path, name, type }`. See [The fs facade](./the-fs-facade).

:::tip[When to prefer a handle over `fs.files.*`]
Both do the same work; pick by how the code reads.

- **Use a handle** when you pass a path *around* (return it, store it, hand it to another function), or when you do **several operations on one path** — one `fs.file(p)` up front beats repeating `p` in every call.
- **Use `fs.files.*` / `fs.dirs.*`** for a **single** one-off operation on a path you already have — `await fs.files.remove(p)` is shorter than `await fs.file(p).remove()`.

Handles are also the cleaner choice for `rename` / `move` chains, since each step returns the next handle to work with.
:::

## Handle method map

Everything below is IO-free to *construct* and delegates to the same primitives under the hood.

| `fs.file(path)` → `File` | `fs.dir(path)` → `Directory` |
| --- | --- |
| `name` / `basename` / `extension` / `parent()` | `name` / `parent()` / `file(...segs)` / `dir(...segs)` |
| `get` / `getJson` / `put` / `putJson` | `ensure` / `remove` / `empty` |
| `append` / `prepend` / `appendJsonLine` | `exists` / `isEmpty` / `count` |
| `edit` / `editJson` / `mergeJson` | `list` / `listFiles` → `File[]` / `listDirs` → `Directory[]` |
| `exists` / `isEmpty` / `ensure` / `touch` | `copy(to)` / `move(to)` → `Directory` |
| `remove` / `copy(to)` / `move(to)` → `File` | `stats` / `size` / `walk` / `hash` |
| `copyTo(dir)` / `moveTo(dir)` / `rename(name)` → `File` | |
| `stats` / `size` / `lastModified` / `hash` / `readLines` | |

## Related

- [The fs facade](./the-fs-facade) — the full `fs.files.*` / `fs.dirs.*` / `fs.hash` surface the handles delegate to.
- [Hash files](./hash-files) — what `hash()` and `fs.hash.*` guarantee.
- [Reference / API](../reference/api) — full signatures.
