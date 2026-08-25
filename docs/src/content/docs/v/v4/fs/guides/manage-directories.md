---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Manage directories"
description: Ensure, empty, and remove directories; list and walk trees in constant memory; copy / move across volumes; measure size and fingerprint a tree — all through fs.dirs.
sidebar:
  order: 3
  label: "Manage directories"
---

Directories are the other half of file work: you stage them before writing,
list them to find things, and wipe them when you're done. `fs.dirs.*` is the
async surface for all of it — grouped, ergonomic, and named for what you
actually want.

```ts title="src/setup.ts"
import { fs } from "@warlock.js/fs";

await fs.dirs.ensure("uploads");
```

Idempotent create. That single line makes `uploads/` (and every missing
parent) exist, and does nothing if it already does.

:::note[The facade is async-only]
Everything here is `await`-ed. Synchronous callers — CLI tools, code
generators, one-shot scripts — drop to the bare primitives
(`ensureDirectory`, `removeDirectory`, `listDirectories`, …), which are the
sanctioned sync layer the facade delegates to. `fs.dirs` never carries an
`Async` suffix and never blocks.
:::

## Create, empty, remove

Three verbs cover the whole lifecycle, and they read exactly as they behave.

```ts
await fs.dirs.ensure("dist/cache/v2");   // create (+ parents), no-op if present
await fs.dirs.empty("cache");            // clear contents, keep the folder
await fs.dirs.remove("tmp");             // delete the whole tree
```

`ensure` is recursive `mkdir` — you rarely need it before writing a file,
since `fs.files.put` auto-creates the parent. Reach for it when you want an
empty directory staged up front, or to make the create step visible in a
script.

`empty` is the one people reinvent by hand: it removes every child but leaves
the directory itself in place — perfect for a scratch folder you keep reusing.

`remove` deletes recursively and is safe to call on a path that doesn't
exist — a missing target is a no-op, not an error. So a wipe-and-recreate
needs no guards:

```ts
await fs.dirs.remove("build");
await fs.dirs.ensure("build");
// or, if the folder should survive: await fs.dirs.empty("build");
```

## Inspect a directory

Ask questions before you act on them.

```ts
await fs.dirs.exists("logs");    // boolean
await fs.dirs.isEmpty("logs");   // boolean — no children
await fs.dirs.count("logs");     // number of immediate children
```

`isEmpty` is the honest gate for "should I skip this?" and `count` gives you a
quick tally without materializing the whole listing.

## List children

`list` returns the immediate entries; `listFiles` and `listDirs` narrow to one
type. All three yield **full paths joined to the directory you passed**, so
results feed straight into the next call.

```ts
const everything = await fs.dirs.list("src");        // files + subdirs
const onlyFiles = await fs.dirs.listFiles("src");    // regular files
const onlyDirs = await fs.dirs.listDirs("src");      // subdirectories
```

Single-level by default. Pass `{ recursive: true }` to flatten the whole tree
into one array:

```ts
const allFiles = await fs.dirs.listFiles("src", { recursive: true });
```

That's convenient for small trees, but it builds the entire list in memory
before you see the first entry. For anything large, stream instead.

## Walk a tree in constant memory

`walk` is an async iterator: it yields `{ path, name, type }` one entry at a
time, so memory stays flat no matter how deep or wide the tree is.

```ts
for await (const entry of fs.dirs.walk("src", { recursive: true })) {
  if (entry.type === "file" && entry.name.endsWith(".ts")) {
    console.log(entry.path);
  }
}
```

You can start processing the first match immediately instead of waiting for the
whole scan — the right default for build steps, indexers, and cleanup passes.
`walk` also takes `{ followSymlinks: true }` when you want to descend through
links.

:::note[No glob — on purpose]
There's intentionally no `glob`. Every project disagrees about what to include,
which dot-files to skip, and how deep to go. `walk` + a plain filter is a few
lines, matches your project exactly, and streams. Reach for it instead of
pattern strings.
:::

## Copy and move

Both mirror the whole tree and auto-create the destination's parent.

```ts
await fs.dirs.copy("public", "dist/public");   // recursive copy
await fs.dirs.move("staging/build", "releases/current");
```

`move` is **EXDEV-safe**: when source and destination live on different volumes
(a `/tmp` → `/var` hop on Linux, or two drives on Windows), the OS can't rename
across filesystems, so `fs.dirs.move` transparently falls back to copy-then-
delete. You don't handle `EXDEV` yourself.

## Measure and fingerprint

```ts
await fs.dirs.size("dist");   // total bytes, recursive
await fs.dirs.hash("dist");   // stable fingerprint of the whole tree
```

`size` sums every file underneath — the number you'd report as "build output
size". `hash` produces a **stable** digest of the tree's structure and content
(SHA-256 by default): the same files in the same shape always hash the same,
regardless of walk order. It's the reliable way to answer "did this directory
change since last time?" without diffing entry by entry — see
[Hash files](./hash-files) for the file-level counterpart.

## Prefer an object? Use a handle

When you're doing several operations against one directory, `fs.dir(path)` hands
you a lazy `Directory` — no IO until you call a method, and child handles for
free.

```ts
const src = fs.dir("src");

for (const file of await src.listFiles({ recursive: true })) {
  if (file.extension === ".ts") {
    console.log(await file.size());  // File handle, per entry
  }
}

const nested = src.dir("components", "ui");  // child Directory handle
```

`listFiles` / `listDirs` on a handle return `File[]` / `Directory[]`, so you keep
chaining without re-joining paths by hand. See
[The fs facade](./the-fs-facade) for the full handle surface.

## Related

- [Read and write files](./read-and-write-files) — text + JSON IO through `fs.files.*`.
- [The fs facade](./the-fs-facade) — the whole `fs.*` surface, including handles.
- [Hash files](./hash-files) — fingerprinting for cache invalidation.
- [Reference / API](../reference/api) — full signatures, including the sync primitives.
