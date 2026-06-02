---
title: "Introduction"
description: What @warlock.js/fs gives you on top of node:fs/promises — sane defaults, atomic writes, JSON helpers, hashing, one consistent naming convention.
sidebar:
  order: 1
  label: "Introduction"
---

`@warlock.js/fs` is a thin opinionated wrapper around `node:fs` and
`node:fs/promises`. It exists because nobody likes writing this every time
they want to write a JSON file:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

await mkdir(path.dirname(filePath), { recursive: true });
await writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
```

That's the shape of half the boilerplate in any Node codebase. So:

```ts
import { putJsonFileAsync } from "@warlock.js/fs";

await putJsonFileAsync(filePath, value);
```

Same effect. No setup. Parent directories created. JSON pretty-printed.
UTF-8. Done.

## What you avoid

Without this package, a typical Node app reaches for a fleet of
single-purpose libraries — `fs-extra` for `outputFile`, `mkdirp` for
recursive `mkdir`, `rimraf` for recursive delete, `write-file-atomic` for
atomic writes, `hasha` or `md5-file` for hashing, `jsonfile` for JSON
helpers. Each one is fine. The stack of them is not.

`@warlock.js/fs` covers the ground all of those cover, in one place, with
zero runtime deps beyond Node's standard library.

## What it adds on top of node:fs

| Capability | Raw `node:fs` | `@warlock.js/fs` |
| --- | --- | --- |
| Write a file, creating parent dirs | `mkdir({recursive: true})` + `writeFile` | `putFileAsync(path, content)` |
| Write JSON | `writeFile(path, JSON.stringify(v, null, 2))` | `putJsonFileAsync(path, v)` |
| Atomic write (no half-written reads) | Hand-roll temp-file + rename + cleanup | `atomicWriteAsync(path, content)` |
| Recursive delete (no-throw on missing) | `rm({recursive, force})` + filter ENOENT | `removeDirectoryAsync(path)` |
| Recursive `mkdir` | `mkdir({recursive: true})` | `ensureDirectoryAsync(path)` |
| Stream-hash a file | Hand-roll `createHash` + `createReadStream` | `hashFileAsync(path)` |
| Hash an in-memory string | `createHash('sha256').update(s).digest('hex')` | `hashString(s)` |
| Exists-and-is-a-file | `stat(path).isFile()` + try/catch ENOENT | `fileExistsAsync(path)` |
| List only files in a dir | `readdir` + `stat` each + filter | `listFilesAsync(path)` |

The pattern: every helper does the obvious right thing for the common case.
You drop down to `node:fs` directly when you need something exotic
(symlinks, watching, FIFOs, low-level FD operations).

## The naming convention

Two suffixes. That's it.

- **`*Async`** — returns a `Promise`. Use this everywhere in a running
  server / app.
- **bare name** — synchronous, blocking. Use this in CLI tools, config
  loaders, code generators — anywhere that runs once and there's nothing
  else for the event loop to do.

There is **no `*Sync` suffix**. The sync calls are the bare names. Reason:
if both halves had a suffix, you'd have to remember which is which. With
this convention, sync is the default and async is decorated — the decoration
matches its surface area (Promise, await, etc).

```ts
// async — the everyday choice in a server
const content = await getFileAsync("./config.toml");

// sync — fine in a CLI, blocking is acceptable here
const content = getFile("./config.toml");
```

## When to reach for this package vs node:fs

Reach for `@warlock.js/fs` when:

- You're writing files and want parent-dir creation for free.
- You want atomic writes for config / manifest / state files.
- You need a content hash for cache invalidation or ETag generation.
- You're doing the "ensure dir, list files, copy, delete" dance.

Stay on `node:fs` when:

- You need streaming reads of a partial file.
- You're watching files (`fs.watch`).
- You need low-level descriptor operations (`open`, `read`, `pwrite`).
- You're working with symlinks, FIFOs, or permission bits.

Both can coexist in the same file. Use whichever reads clearer for the
task at hand.

## Next

- [Installation](./02-installation) — install the package.
- [Your first write](./03-your-first-write) — five-minute walkthrough that
  ensures a directory, writes a JSON file, reads it back.
