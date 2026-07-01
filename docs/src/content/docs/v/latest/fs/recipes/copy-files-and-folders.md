---
title: "Copy files and folders"
description: Copy and move single files, whole trees, or handle objects with fs.files.* / fs.dirs.* / handle.copyTo — and why move survives crossing a filesystem boundary.
sidebar:
  order: 4
  label: "Copy files and folders"
---

Copying and moving are the operations people reach for `child_process` or a
shell for. You don't need to — the facade covers files, directories, and
handle objects, and its `move` survives crossing a disk.

## Copy a single file

```ts title="src/copy-file.ts"
import { fs } from "@warlock.js/fs";

await fs.files.copy("config.json", "config.backup.json");
```

Parent directories of the destination are created for you, same as any write.

## Copy a whole tree

`fs.dirs.copy` recurses — every file and subfolder comes along:

```ts title="src/copy-tree.ts"
import { fs } from "@warlock.js/fs";

await fs.dirs.copy("dist", "release/dist");
```

## Copy *into* a directory with handles

When you're thinking in terms of "this file, into that folder", handles read
better. `copyTo(dir)` drops the file into a directory keeping its name and
returns a **new** `File` handle pointing at the copy:

```ts title="src/copy-into.ts"
import { fs } from "@warlock.js/fs";

const archived = await fs.file("report.pdf").copyTo(fs.dir("archive/2026"));
archived.name;   // "report.pdf" — now living under archive/2026
```

`copyTo` keeps the filename; `copy(to)` takes a full destination path. Both
return a new handle — handles are immutable, so the original still points at
the source.

## Moving — and the EXDEV trap

A naive `rename` throws `EXDEV` the moment source and destination live on
different filesystems (a temp dir on one volume, your project on another — very
common in CI and containers). The facade's `move` handles that: it renames when
it can and falls back to copy-then-delete when it can't.

```ts title="src/move.ts"
import { fs } from "@warlock.js/fs";

await fs.files.move("tmp/upload.bin", "storage/upload.bin"); // EXDEV-safe
await fs.dirs.move("build/tmp", "build/final");              // trees too

// Handle form — moveTo(dir) returns the relocated handle:
const moved = await fs.file("tmp/upload.bin").moveTo(fs.dir("storage"));
```

:::tip[Rename vs move]
`rename(name)` on a handle changes only the filename in place and returns a new
handle; `move` / `moveTo` relocate across folders (and volumes). Reach for
`rename` when the file stays put, `move` when it travels.
:::

## Related

- [Ensure a directory before writing](./ensure-directory-before-writing) —
  destinations are auto-parented.
- [Work with handles](../guides/work-with-handles) — the full `File` /
  `Directory` handle API.
