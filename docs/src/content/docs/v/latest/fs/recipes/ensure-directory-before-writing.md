---
title: "Ensure a directory before writing"
description: Write into a nested path without pre-creating folders — fs.files.put makes parents for you — and reach for fs.dirs.ensure when the directory itself is the goal.
sidebar:
  order: 3
  label: "Ensure a directory before writing"
---

The classic Node dance is `mkdir -p` then `writeFile`. The facade collapses
it: writing a file just makes the folders it needs.

## Just write — parents are created for you

`fs.files.put` (and every write helper built on it) creates missing parent
directories on the way:

```ts title="src/write-nested.ts"
import { fs } from "@warlock.js/fs";

// cache/2026/07/report.json — none of those folders have to exist yet.
await fs.files.put("cache/2026/07/report.json", "{}");
```

No `ensureDir` call, no `ENOENT`. `putJson`, `append`, `create`, and the handle
methods all inherit this.

:::note[Opting out]
Auto-parenting is the default. If you want a write to *fail* when the folder is
missing — a guard against typo'd paths — pass `{ ensureDir: false }`.
:::

## When the directory itself is the point

Sometimes you need the folder to exist before anything writes into it — an
uploads root, a scratch dir, an output target you'll hand to another tool. Ask
for the directory directly:

```ts title="src/prepare-dirs.ts"
import { fs } from "@warlock.js/fs";

await fs.dirs.ensure("storage/uploads");
```

`ensure` is idempotent — it creates the tree if it's absent and does nothing
if it's already there. Never throws for an existing directory, so you can call
it freely at the top of any handler.

## Reset a directory before a run

Building into an output folder that must start clean? `empty` clears the
contents but keeps the directory (and its permissions) in place:

```ts title="src/clean-build.ts"
import { fs } from "@warlock.js/fs";

await fs.dirs.ensure("dist");
await fs.dirs.empty("dist");   // wipe contents, keep the folder
```

Prefer `empty` over remove-then-recreate when something else already holds a
reference to the folder.

## Related

- [Copy files and folders](./copy-files-and-folders) — moving content into the
  folders you just ensured.
- [Manage directories](../guides/manage-directories) — the full `fs.dirs.*`
  surface.
