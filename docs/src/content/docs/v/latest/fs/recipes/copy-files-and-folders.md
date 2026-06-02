---
title: "Copy a large file (and whole folders)"
description: copyFileAsync is already a kernel-level copy — constant memory even for multi-GB files, no streaming needed. Plus recursive folder copy and the snapshot pattern.
sidebar:
  order: 4
  label: "Copy files and folders"
---

A frequent worry: "I need to copy a 4 GB video file — won't loading it into memory blow the heap?" Short answer: no, and you don't need to reach for streams. `copyFileAsync` doesn't read the file into your process at all.

## Copy a single (large) file

```ts
import { copyFileAsync } from "@warlock.js/fs";

await copyFileAsync("./media/source.mp4", "./backup/2026/source.mp4");
```

`copyFileAsync` wraps Node's `fs.copyFile`, which copies at the OS level — the bytes never pass through your JavaScript heap. A 4 GB file copies in constant memory. There's nothing to stream and no progress callback to wire up; the kernel handles the transfer.

It also creates the destination's parent directory (`./backup/2026` above) if it's missing, so you don't pre-`mkdir`.

**When you genuinely need streaming** — only if you want a progress bar or to transform bytes mid-copy — drop to `node:fs` directly; that's outside this package's one-shot-utility scope:

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

// Only reach for this if you need per-chunk progress / transforms.
await pipeline(createReadStream(source), createWriteStream(destination));
```

For a plain "make a copy", `copyFileAsync` is simpler and at least as fast.

## Copy a whole folder

```ts
import { copyDirectoryAsync } from "@warlock.js/fs";

await copyDirectoryAsync("./public", "./dist/public");
```

Recursive by default — copies the entire tree, overwriting any files that already exist at the destination. Backed by Node's `cp({ recursive: true })`.

## The snapshot pattern

Capture a build output (or any folder) under a timestamped path:

```ts
import { copyDirectoryAsync, ensureDirectoryAsync } from "@warlock.js/fs";

async function snapshot(source: string) {
  const target = `./snapshots/${Date.now()}`;
  await ensureDirectoryAsync(target);
  await copyDirectoryAsync(source, target);

  return target;
}

const saved = await snapshot("./dist");
```

## Copy then delete (cross-device move)

`renameFileAsync` is the cheap move — but it fails with `EXDEV` when source and destination live on different mounts (e.g. `/tmp` → a mounted volume). The portable fallback is copy + delete:

```ts
import { copyFileAsync, unlinkAsync } from "@warlock.js/fs";

async function moveAcrossDevices(source: string, destination: string) {
  await copyFileAsync(source, destination);
  await unlinkAsync(source);
}
```

For a same-device move, prefer `renameFileAsync` — it's a single metadata operation, no byte copy.

## Sync variants

Every copy has a synchronous twin for scripts and codegen: `copyFile`, `copyDirectory`. Same behavior, blocking. Use them in CLI tools where blocking the event loop is fine; stick to the `*Async` versions in any server runtime.

## Related

- [Manage directories](../guides/manage-directories) — copy, move, list, delete.
- [Ensure a directory exists](./ensure-directory-before-writing) — the
  auto-mkdir behavior copies rely on.
