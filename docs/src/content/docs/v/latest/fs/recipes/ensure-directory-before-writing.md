---
title: "Ensure a directory exists before writing"
description: Writes auto-create their parent directories — so when do you still need ensureDirectoryAsync? The two cases that actually matter, plus the upload-handler pattern.
sidebar:
  order: 3
  label: "Ensure a directory exists"
---

The first thing every backend hits: "I tried to write `./uploads/2026/06/avatar.png` and got `ENOENT` because `./uploads/2026/06` doesn't exist." In raw `node:fs` you'd `mkdir(..., { recursive: true })` first, then write. Here you usually don't have to.

## The short version: writes already do this

`putFileAsync`, `putJsonFileAsync`, `copyFileAsync`, and `atomicWriteAsync` all create missing parent directories for you. So the naive thing just works:

```ts
import { putFileAsync } from "@warlock.js/fs";

// ./uploads/2026/06 does not exist yet — created automatically.
await putFileAsync("./uploads/2026/06/note.txt", "saved");
```

No `ensureDirectoryAsync` call needed for the file's *own* parent. That covers 90% of "I just want to write a file" cases.

## When you DO want ensureDirectoryAsync

Two situations:

**1. You're creating an empty directory ahead of filling it** — e.g. a destination you're about to copy many files into, where no single write covers it:

```ts
import { ensureDirectoryAsync, copyFileAsync } from "@warlock.js/fs";

const targetDir = "./dist/assets";
await ensureDirectoryAsync(targetDir);

for (const asset of assets) {
  await copyFileAsync(asset.source, `${targetDir}/${asset.name}`);
}
```

(`copyFileAsync` would create `targetDir` on the first file anyway — but making it explicit reads better and means an empty `assets` array still leaves the directory in place.)

**2. The directory itself is the deliverable** — a cache folder, a scratch dir, a per-tenant workspace that should exist even before anything lands in it:

```ts
import { ensureDirectoryAsync } from "@warlock.js/fs";

await ensureDirectoryAsync(`./workspaces/${tenantId}/tmp`);
```

`ensureDirectoryAsync` is idempotent — calling it on a directory that already exists is a no-op, never an error. So you can call it freely at the top of any handler without guarding it.

## The upload-handler pattern

A common real shape — save an uploaded file under a date-partitioned path:

```ts
import { putFileAsync } from "@warlock.js/fs";

async function saveUpload(buffer: Buffer, originalName: string) {
  const now = new Date();
  const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const path = `./storage/uploads/${folder}/${Date.now()}-${originalName}`;

  // putFileAsync is UTF-8 text only — for binary, use atomicWriteAsync.
  await atomicWriteAsync(path, buffer);

  return path;
}
```

```ts
import { atomicWriteAsync } from "@warlock.js/fs";
```

Note the swap: uploaded bytes are binary, and `putFile` / `putFileAsync` are text-only (UTF-8). `atomicWriteAsync` accepts `string | Buffer` *and* creates the date folders — so it's the right one-call tool for binary uploads. (It also gives you the atomic-rename guarantee for free, which is a nice bonus for files a CDN or another worker might pick up.)

## Reset-a-directory pattern

Wipe and recreate — useful between test runs or build passes:

```ts
import { removeDirectoryAsync, ensureDirectoryAsync } from "@warlock.js/fs";

await removeDirectoryAsync("./tmp");   // rm -rf, no error if missing
await ensureDirectoryAsync("./tmp");   // fresh empty dir
```

`removeDirectoryAsync` is also `ENOENT`-safe, so this works whether or not `./tmp` existed before.

## Related

- [Manage directories](../guides/manage-directories) — the full directory surface.
- [Your first write](../getting-started/03-your-first-write) — the
  `ensureDirectory` + `putFile` walkthrough.
