---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Introduction"
description: What @warlock.js/fs is and why — one fs object with node:fs's power and sane defaults, minus the fs-extra / rimraf / mkdirp / hasha graveyard.
sidebar:
  order: 1
  label: "Introduction"
---

Every Node project ends up doing the same filesystem chores: create the parent
dir before writing, swallow the ENOENT when deleting something that isn't there,
write JSON with the right indent, hash a file for a cache key. `node:fs` makes
you spell all of that out, every time. `@warlock.js/fs` gives you one object that
just does the obvious right thing.

Meet `fs`:

```ts
import { fs } from "@warlock.js/fs";

await fs.files.putJson("dist/manifest.json", manifest);
```

That one line serialises the object, creates `dist/` if it's missing, and writes
UTF-8 JSON. No `mkdir` dance, no `JSON.stringify(v, null, 2)`, no `"utf-8"`
argument to remember. The `fs` object carries the same defaults everywhere.

## The `fs` object is the whole story

Everything hangs off five entry points. You rarely need more than these:

- **`fs.files.*`** — read, write, edit, append, copy, move, hash, and inspect
  files. `put`, `getJson`, `editJson`, `appendJsonLine`, `mergeJson`, and more.
- **`fs.dirs.*`** — ensure, empty, remove, copy, walk, list, size, and
  fingerprint directories.
- **`fs.file(path)`** / **`fs.dir(path)`** — lazy, immutable handles when you'd
  rather hold an object than pass a string around.
- **`fs.hash.*`** — hash a string or buffer (sync) or a file or directory tree
  (async). SHA-256 by default.
- **`fs.exists(path)`** — type-agnostic existence check, file or directory.

A quick taste of each:

```ts
await fs.files.editJson("package.json", (p) => ({ ...p, version: "4.7.0" }));
await fs.dirs.empty("cache");                    // clear it, keep the dir
const readme = fs.file("docs/README.md");         // lazy — no IO yet
for await (const e of fs.dirs.walk("src")) { /* { path, name, type } */ }
```

## Everything with sane defaults

The point of `fs` isn't fewer characters — it's that the defaults are the ones you
actually want. `node:fs` gives you power and no opinions; `fs` gives you power
*and* the obvious behaviour:

- **Writes create parent dirs** — no `mkdir({ recursive: true })` first.
- **Deletes are ENOENT-safe** — removing something that's already gone is a
  no-op, not a thrown error.
- **Atomic writes on request** — `{ atomic: true }` does temp-file + rename, so
  readers never see a half-written file.
- **JSON that reads back typed** — `getJson<T>()`, optional Standard Schema
  validation, and a `default` for the missing-file case.
- **Streaming hashes** — `fs.hash.file()` streams SHA-256, so a 200 MB bundle
  doesn't blow the heap.
- **Read-modify-write in one call** — `edit`, `editJson`, `mergeJson` do the
  read → transform → write round-trip for you.
- **Recursive walk that's an async iterable** — `for await` over a whole tree.

## The two layers

:::note[Async facade for app code, sync primitives for scripts]
`@warlock.js/fs` ships in two layers, and you'll almost always want the first:

- **The `fs` facade** (async-only). This is what you use in application code —
  servers, request handlers, anything with a live event loop. Every call returns
  a `Promise`; nothing blocks. There is no `Async` suffix on the facade, because
  the whole facade is async.
- **The low-level sync primitives** (`getFile`, `putFile`, `ensureDirectory`,
  `hashString`, …). These are the synchronous escape hatch for CLI tools, code
  generators, and one-shot scripts where blocking is fine and `await` is just
  noise. The facade delegates down to this same layer — it isn't a separate
  implementation, just a friendlier surface with a few extras.

Reach for the primitives only when you specifically want synchronous IO. In a
running app, stay on `fs`.
:::

## Versus the usual suspects

A typical Node app assembles a small graveyard of single-purpose libraries to
cover this ground. `fs` replaces the lot, with **zero runtime dependencies**
beyond Node's standard library:

- **`fs-extra`** — for `outputFile` / `copy` / `emptyDir`. Now `fs.files.put`,
  `fs.files.copy`, `fs.dirs.empty`.
- **`mkdirp`** — for recursive `mkdir`. Now automatic on every write, or
  `fs.dirs.ensure`.
- **`rimraf`** — for recursive, no-throw delete. Now `fs.dirs.remove` /
  `fs.files.remove`.
- **`write-file-atomic`** — for crash-safe writes. Now `fs.files.put(path, x, { atomic: true })`.
- **`hasha` / `md5-file`** — for file hashing. Now `fs.hash.file` /
  `fs.hash.dir`.
- **`jsonfile`** — for JSON read/write helpers. Now `fs.files.getJson` /
  `putJson`, with optional schema validation.

Each of those libraries is fine on its own. The stack of them — six deps, six
mental models, six changelogs — is not.

## Next

- [Installation](./02-installation) — add the package to your project.
- [Your first write](./03-your-first-write) — a five-minute walkthrough that
  ensures a directory, writes a JSON manifest, reads it back, and hashes it.
