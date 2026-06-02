---
title: "Manage directories"
description: Ensure directories exist, list children, copy / rename / delete files and trees — with ENOENT-safe deletes and full-path listings.
sidebar:
  order: 2
  label: "Manage directories"
---

Everything you need to move, list, and clean up files and folders. Same
naming convention as the rest of the package — `*Async` returns a Promise,
the bare name is synchronous.

## Ensure a directory exists

```ts
import { ensureDirectoryAsync, ensureDirectory } from "@warlock.js/fs";

await ensureDirectoryAsync("./dist/cache/v2");
// creates ./dist, ./dist/cache, ./dist/cache/v2 if any are missing
// no-op if they're all already there
```

Idempotent. Calls `mkdir({ recursive: true })` under the hood. You usually
don't need this before writing a file — `putFileAsync`, `putJsonFileAsync`,
`atomicWriteAsync`, and `copyFileAsync` all auto-create the immediate
parent of their target. Reach for `ensureDirectoryAsync` when:

- You're about to copy several files into a directory and want the
  directory itself created up front (`copyDirectoryAsync` also creates
  the destination, but the explicit call documents intent).
- You're staging an empty directory for another tool to write into.
- You want the create step to be visible in a multi-stage script.

## List children

Three variants, all returning **full paths joined to the directory you
passed in** — not bare entry names. This means the results feed straight
into the next call:

```ts
import { listAsync, listFilesAsync, listDirectoriesAsync } from "@warlock.js/fs";

const everything = await listAsync("./src");           // files + subdirs
const onlyFiles = await listFilesAsync("./src");        // regular files only
const onlyDirs = await listDirectoriesAsync("./src");   // directories only
```

So this just works:

```ts
import { listFilesAsync, getFileAsync } from "@warlock.js/fs";

for (const file of await listFilesAsync("./src/components")) {
  // file = "./src/components/Button.tsx" — full path
  const source = await getFileAsync(file);
  // ...
}
```

**Non-recursive by design.** All three list only the immediate children.
If you need to walk a tree, recurse yourself:

```ts
import { listAsync, directoryExistsAsync } from "@warlock.js/fs";

async function walk(dir: string): Promise<string[]> {
  const entries = await listAsync(dir);
  const results: string[] = [];

  for (const entry of entries) {
    if (await directoryExistsAsync(entry)) {
      results.push(...(await walk(entry)));
    } else {
      results.push(entry);
    }
  }

  return results;
}

const allFiles = await walk("./src");
```

Why no built-in `walk`? Because every project's needs differ — extensions
to include, dot-files to skip, depth caps, parallel limits. A hand-rolled
walker takes ten lines and matches your project exactly.

## Copy

```ts
import { copyFileAsync, copyDirectoryAsync } from "@warlock.js/fs";

// File — destination's parent dir is auto-created
await copyFileAsync("./dist/bundle.js", "./snapshot/v2/bundle.js");

// Directory — fully recursive, preserves the tree
await copyDirectoryAsync("./public", "./dist/public");
```

`copyDirectoryAsync` uses Node's `cp` with `recursive: true`. Existing
files at the destination are overwritten. Symlinks are preserved (not
dereferenced).

## Rename / move

```ts
import { renameFileAsync } from "@warlock.js/fs";

await renameFileAsync("./tmp/foo.txt", "./final/foo.txt");
await renameFileAsync("./old-name-dir", "./new-name-dir"); // works for dirs too
```

`renameFileAsync` is a thin wrapper around `node:fs/promises`'s `rename`.
It does **not** auto-create the destination's parent directory — if
`./final` doesn't exist, the call fails. Pair with `ensureDirectoryAsync`
if you can't be sure:

```ts
import { ensureDirectoryAsync, renameFileAsync } from "@warlock.js/fs";
import path from "node:path";

const destination = "./final/foo.txt";
await ensureDirectoryAsync(path.dirname(destination));
await renameFileAsync("./tmp/foo.txt", destination);
```

**Cross-device gotcha.** If source and destination are on different
mounts / volumes (e.g. `/tmp` and `/var` on Linux, or moving between two
drives on Windows), `rename` fails with `EXDEV`. The OS can't atomically
move bytes across filesystems. The workaround is copy + delete:

```ts
import { copyFileAsync, unlinkAsync } from "@warlock.js/fs";

await copyFileAsync("/tmp/foo.txt", "/var/lib/foo.txt");
await unlinkAsync("/tmp/foo.txt");
```

## Delete

```ts
import { unlinkAsync, removeDirectoryAsync } from "@warlock.js/fs";

await unlinkAsync("./obsolete.txt");          // single file
await removeDirectoryAsync("./dist");          // recursive force
```

**Both are ENOENT-safe** — calling them on a path that doesn't exist is a
no-op, not an error. Other errors (`EACCES` permission denied, `EBUSY`
file in use) still throw.

This means you can write reset-style code without any guards:

```ts
import { removeDirectoryAsync, ensureDirectoryAsync } from "@warlock.js/fs";

// Wipe and recreate, regardless of whether ./tmp existed before
await removeDirectoryAsync("./tmp");
await ensureDirectoryAsync("./tmp");
```

### Picking a delete shape

| You want to... | Use |
| --- | --- |
| Drop one file | `unlinkAsync(path)` |
| Drop a whole tree | `removeDirectoryAsync(path)` |
| Drop everything in a folder, keep the folder | Iterate, delete each child appropriately |

For the third case:

```ts
import {
  listAsync,
  fileExistsAsync,
  unlinkAsync,
  removeDirectoryAsync,
} from "@warlock.js/fs";

for (const entry of await listAsync("./tmp")) {
  if (await fileExistsAsync(entry)) {
    await unlinkAsync(entry);
  } else {
    await removeDirectoryAsync(entry);
  }
}
```

## Common shapes

### Snapshot a build output

```ts
import { copyDirectoryAsync } from "@warlock.js/fs";

const target = `./snapshots/${Date.now()}`;
await copyDirectoryAsync("./dist", target);
// copyDirectoryAsync creates ./snapshots/<timestamp>/ if missing
```

### Move artifacts from a staging directory

```ts
import { listFilesAsync, renameFileAsync, ensureDirectoryAsync } from "@warlock.js/fs";
import path from "node:path";

await ensureDirectoryAsync("./final");
for (const staged of await listFilesAsync("./staging")) {
  const target = path.join("./final", path.basename(staged));
  await renameFileAsync(staged, target);
}
```

(Works only if `./staging` and `./final` are on the same mount.)

## Related

- [Read and write files](./read-and-write-files) — text + JSON IO.
- [Write atomically](./write-atomically) — for files concurrent readers
  see.
- [Reference / API](../reference/api) — full signatures.
