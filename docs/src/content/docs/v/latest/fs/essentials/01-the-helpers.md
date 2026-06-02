---
title: "The helpers"
description: A guided tour of every helper @warlock.js/fs exposes — read/write, JSON, atomic writes, directories, hashing, existence checks, stats.
sidebar:
  order: 1
  label: "The helpers"
---

A quick tour of everything in the box, grouped by what they do rather than
which file they live in. If you've read [Your first write](../getting-started/03-your-first-write),
this is the next step — same vocabulary, full surface.

## Reading text and JSON

```ts
import { getFileAsync, getFile, getJsonFileAsync, getJsonFile } from "@warlock.js/fs";

const text = await getFileAsync("./config.toml");           // string (UTF-8)
const sync = getFile("./config.toml");                       // string

const data = await getJsonFileAsync<MyConfig>("./config.json"); // T
const dataSync = getJsonFile<MyConfig>("./config.json");        // T
```

Throws on missing files (`ENOENT`) and on malformed JSON. Don't try/catch
ENOENT as control flow — use the existence checks below.

## Writing text and JSON

```ts
import { putFileAsync, putFile, putJsonFileAsync, putJsonFile } from "@warlock.js/fs";

await putFileAsync("./out/log.txt", "hello\n");
await putJsonFileAsync("./out/state.json", { ok: true });
```

Both variants:

- Create parent directories recursively.
- Overwrite existing files (last writer wins).
- JSON variants pretty-print at 2-space indent.

For files other processes read concurrently, use [atomic writes](#atomic-writes)
instead.

## Atomic writes

```ts
import { atomicWriteAsync, atomicWriteJsonAsync } from "@warlock.js/fs";

await atomicWriteAsync("./config.toml", configString);
await atomicWriteAsync("./binary.bin", Buffer.from([0x01, 0x02])); // accepts Buffer too
await atomicWriteJsonAsync("./manifest.json", { version: "1.0.0" });
```

Writes to a uniquely-named temp file in the same directory, then renames
onto the target. Readers see the old content or the complete new content,
never anything in between. There's no sync variant — atomic writes are
always async, because they're worth the await.

Full mechanics in [Atomic vs non-atomic](./02-atomic-vs-non-atomic) and
[Write atomically](../guides/write-atomically).

## Directories

```ts
import {
  ensureDirectoryAsync,
  ensureDirectory,
  removeDirectoryAsync,
  removeDirectory,
} from "@warlock.js/fs";

await ensureDirectoryAsync("./dist/cache/v2");   // mkdir -p, idempotent
await removeDirectoryAsync("./dist");             // rm -rf, ENOENT-safe
```

`ensureDirectoryAsync` is a no-op if the directory already exists.
`removeDirectoryAsync` is a no-op if the target doesn't exist.

## Listing children

```ts
import { listAsync, listFilesAsync, listDirectoriesAsync } from "@warlock.js/fs";

await listAsync("./src");              // every immediate child, full paths
await listFilesAsync("./src");          // only regular files
await listDirectoriesAsync("./src");    // only subdirectories
```

All three return **full paths joined to the directory you passed**, not
bare entry names — feed them straight into the next call. Non-recursive
by design; if you need a deep walk, recurse yourself (there's a snippet in
[Manage directories](../guides/manage-directories)).

## Copying and renaming

```ts
import {
  copyFileAsync,
  copyDirectoryAsync,
  renameFileAsync,
} from "@warlock.js/fs";

await copyFileAsync("./src.txt", "./dst/copy.txt");      // parent dirs auto-created
await copyDirectoryAsync("./public", "./dist/public");    // recursive
await renameFileAsync("./tmp/foo", "./final/foo");        // works for files and dirs
```

Cross-mount renames may fail with `EXDEV` — for cross-device moves, copy
then delete.

## Deleting

```ts
import { unlinkAsync, removeDirectoryAsync } from "@warlock.js/fs";

await unlinkAsync("./obsolete.txt");          // single file, ENOENT-safe
await removeDirectoryAsync("./dist");          // recursive + force, ENOENT-safe
```

Both swallow "not found" errors. Other errors (`EACCES`, `EBUSY`) still
throw — if you're catching, you're catching a real problem.

## Existence checks

Three variants, pick the strictest one that answers your question:

```ts
import { pathExistsAsync, fileExistsAsync, directoryExistsAsync } from "@warlock.js/fs";

await pathExistsAsync("./anything");        // true if file OR directory
await fileExistsAsync("./config.toml");      // true only if a regular file
await directoryExistsAsync("./dist");         // true only if a directory
```

Use these to gate creation, not as a try/catch replacement for read errors
(though they do read more cleanly than that pattern). Sync variants exist
under the bare names.

## Metadata

```ts
import { lastModifiedAsync, statsAsync } from "@warlock.js/fs";

const mtime = await lastModifiedAsync("./bundle.js");   // Date
const all = await statsAsync("./bundle.js");             // fs.Stats
```

`lastModified` is sugar around `stat().mtime`. Reach for `stats` when you
need size, mode bits, or any of the other `fs.Stats` fields.

## Hashing

```ts
import { hashFileAsync, hashString, hashBuffer, hashFileSmallAsync } from "@warlock.js/fs";

await hashFileAsync("./bundle.js");                  // streaming, SHA-256, hex
hashString("hello world");                            // in-memory string
hashBuffer(Buffer.from([1, 2, 3]));                   // in-memory bytes
await hashFileSmallAsync("./tiny.svg");               // one-shot read, < ~1 MB
```

All four accept a second arg picking the algorithm:
`"sha256" | "sha1" | "md5" | "sha512"`. Default is `sha256`. Full
walkthrough in [Hash files](../guides/hash-files).

## Sync vs async — when to pick which

| Context | Use |
| --- | --- |
| Server / app runtime | `*Async` always — keep the event loop free |
| CLI scripts | Either — blocking sync is usually fine, and reads cleaner |
| Code generators, build scripts | Sync is fine — it's a one-shot process |
| Config loaders at startup | Sync — there's nothing else to do yet |

When in doubt: async. The cost is one `await` keyword; the benefit is
that you never accidentally block a server's request handler.

## Next

- [Atomic vs non-atomic](./02-atomic-vs-non-atomic) — picking between
  `putFileAsync` and `atomicWriteAsync`.
- [Reference / API](../reference/api) — full export list with signatures.
