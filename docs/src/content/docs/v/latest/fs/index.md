---
title: "@warlock.js/fs"
description: Tiny filesystem toolkit for Node — atomic writes, JSON helpers, content hashing, directory management. Zero deps beyond node:fs.
sidebar:
  order: 1
  label: "Overview"
---

> Standalone — usable in any Node project, no `@warlock.js/core` required.

A pocket-sized filesystem toolkit. The shape you wish `node:fs/promises`
had, without pulling in `fs-extra`, `rimraf`, `mkdirp`, `write-file-atomic`,
`hasha`, and a small graveyard of single-purpose dependencies.

Every helper picks the right defaults — `putFileAsync` creates parent
directories for you, `unlinkAsync` swallows `ENOENT`, `atomicWriteAsync`
writes to a temp file and renames, `hashFileAsync` streams so big files
don't blow the heap. One naming convention: `*Async` returns a Promise,
the bare name is sync. That's the whole vocabulary.

## Dive in

```ts
import {
  putJsonFileAsync,
  getJsonFileAsync,
  fileExistsAsync,
  hashFileAsync,
} from "@warlock.js/fs";

// Write JSON — parent dirs auto-created, pretty-printed at 2 spaces.
await putJsonFileAsync("./build/manifest.json", { version: "1.0.0" });

// Read it back, fully typed.
const manifest = await getJsonFileAsync<{ version: string }>("./build/manifest.json");

// Gate on existence instead of try/catching a read.
if (await fileExistsAsync("./build/manifest.json")) {
  const digest = await hashFileAsync("./build/manifest.json"); // streaming SHA-256
  console.log(`manifest v${manifest.version} — ${digest.slice(0, 8)}`);
}
```

No factory, no config, no setup — import the function and call it.

## What you get

- **Read + write text and JSON** — `getFileAsync`, `putJsonFileAsync`, friends.
  Auto-creates parent directories on writes. See [Read and write files](./guides/read-and-write-files).
- **Atomic writes** — `atomicWriteAsync` for files that other processes
  read concurrently. See [Write atomically](./guides/write-atomically).
- **Directory management** — `ensureDirectoryAsync`, `listFilesAsync`,
  `copyDirectoryAsync`, `removeDirectoryAsync`. See [Manage directories](./guides/manage-directories).
- **Content hashing** — `hashFileAsync` (streaming), `hashString`,
  `hashBuffer`. SHA-256 default, sha1/md5/sha512 supported. See [Hash files](./guides/hash-files).
- **Existence + stats** — `fileExistsAsync`, `directoryExistsAsync`,
  `lastModifiedAsync`.

## Where to start

1. [Introduction](./getting-started/01-introduction) — what `@warlock.js/fs`
   actually gives you over raw `node:fs/promises`.
2. [Installation](./getting-started/02-installation) — `yarn add @warlock.js/fs`.
3. [Your first write](./getting-started/03-your-first-write) — 5-minute
   `putFileAsync` + `getFileAsync` walkthrough.

Then dip into [Essentials](./essentials/01-the-helpers) for the lay of the
land, [Guides](./guides/read-and-write-files) for task-oriented walkthroughs,
or [Reference](./reference/api) for the full export list.
