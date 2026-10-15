---
title: "The fs object"
description: The mental model behind @warlock.js/fs — one async fs facade with files, dirs, lazy handles, hashing, and a type-agnostic exists check.
sidebar:
  order: 1
  label: "The fs object"
---

Everything in this package hangs off one object: `fs`. Import it once, and
files, directories, hashing, and existence checks are all one short call
away.

```ts
import { fs } from "@warlock.js/fs";

await fs.files.put("out/log.txt", "hello\n");
```

That's the whole idea. You don't hunt for a function named
`putFileAsync` — you reach for `fs`, then say what you're touching. This
page is the map: five namespaces, one naming rule, and a couple of things
`fs` deliberately does *not* do.

## The shape of `fs`

`fs` groups its surface by *what you're acting on*, so the call reads like
a sentence.

`fs.files.*` — everything you do to a file. Read, write, JSON, append,
edit-in-place, hash, stat, copy, move.

```ts
await fs.files.getJson<Config>("config.json");
```

`fs.dirs.*` — everything you do to a directory. Ensure, empty, remove,
list, walk, size, hash the whole tree.

```ts
await fs.dirs.ensure("uploads/images");
```

`fs.file(path)` and `fs.dir(path)` — a **handle**: a small object bound to
one path, with the same methods hanging off it. Handy when you'll touch
the same path several times.

```ts
const pkg = fs.file("package.json");
await pkg.editJson((p) => ({ ...p, version: "4.7.0" }));
```

`fs.hash.*` — hashing. Strings and buffers hash in memory; files and
directories stream from disk.

```ts
fs.hash.string("hello");            // sync
await fs.hash.file("bundle.js");    // async
```

`fs.exists(path)` — a type-agnostic existence check. True whether the path
is a file or a directory.

```ts
if (await fs.exists("cache")) { /* something is there */ }
```

Each namespace has its own page. Jump wherever your task lives:

- [Files](../guides/read-and-write-files) — `fs.files.*` in depth.
- [Directories](../guides/manage-directories) — `fs.dirs.*` in depth.
- [Lazy handles](../guides/the-fs-facade) — `fs.file()` / `fs.dir()`.
- [Hashing](../guides/hash-files) — `fs.hash.*`.

## Async-first — the one naming rule

Every method on `fs` returns a Promise. There is no `fs.files.getSync`,
no `Async` suffix to remember — the facade is async, full stop, so you
just `await` it.

```ts
const text = await fs.files.get("config.toml");   // Promise<string>
```

Under the hood, though, this package ships two layers of every operation:
a bare synchronous primitive (`getFile`, `putFile`, `ensureDirectory`, …)
and an async one (`getFileAsync`, `putFileAsync`, …). The facade is built
on the async layer and hides the suffix entirely.

You only meet that layer when you genuinely can't `await` — a code
generator, a config loader at startup, a one-shot CLI script. There, drop
to the bare **synchronous** primitives:

```ts
import { getFile, putJsonFile } from "@warlock.js/fs";

const raw = getFile("config.toml");        // blocking, no await
putJsonFile("out.json", { ok: true });
```

That's the whole rule: **`fs.*` is async; the bare `*` primitives are the
sync escape hatch.** The `*Async` primitives exist too, but the facade is
the friendlier way to reach them — reach for `fs` first.

:::note[When sync is fine]
CLI tools, build scripts, and startup config loaders are one-shot
processes with nothing else to block. Sync reads cleaner there. In a
server or any request handler, always stay on the async facade — one
`await` keeps the event loop free.
:::

## "I want to…" → use

| I want to… | Use |
| --- | --- |
| Read a text file | `fs.files.get(path)` |
| Read + parse JSON (typed) | `fs.files.getJson<T>(path)` |
| Write a file (create parents) | `fs.files.put(path, content)` |
| Write JSON | `fs.files.putJson(path, value)` |
| Patch a JSON object | `fs.files.mergeJson(path, partial)` |
| Transform a file in place | `fs.files.edit(path, fn)` |
| Make a directory (mkdir -p) | `fs.dirs.ensure(path)` |
| Empty a directory, keep it | `fs.dirs.empty(path)` |
| Delete a directory tree | `fs.dirs.remove(path)` |
| List / walk a tree | `fs.dirs.list(path)` / `fs.dirs.walk(path)` |
| Hash a string or buffer | `fs.hash.string(s)` / `fs.hash.buffer(b)` |
| Hash a file or a whole tree | `fs.hash.file(path)` / `fs.hash.dir(path)` |
| Check if *anything* is there | `fs.exists(path)` |
| Hold one path and reuse it | `fs.file(path)` / `fs.dir(path)` |
| Read/write synchronously | bare `getFile` / `putFile` primitives |

## Options ride along the last argument

Most calls take an options object as their final argument. Same handful of
names show up everywhere, so once you learn them once you know them
everywhere.

```ts
await fs.files.put("cache/data.json", "{}", {
  atomic: true,      // write to a temp file, then rename onto target
  overwrite: false,  // fail instead of clobbering an existing file
  ensureDir: true,   // create parent directories first
});
```

- `atomic` — readers see the old content or the complete new content,
  never a half-written file. See [Atomic vs non-atomic](./02-atomic-vs-non-atomic).
- `overwrite` — set `false` for create-if-missing semantics (that's what
  `fs.files.create` does for you).
- `ensureDir` — create the parent path before writing.
- `recursive` — on `fs.dirs.list` / `walk`, descend into subdirectories.
- `schema` + `default` — on `fs.files.getJson`, validate against a
  [Standard Schema](https://standardschema.dev) and fall back when the
  file is missing.

:::tip[Options are always optional]
Every one of these has a sane default, so the two-argument form is the
common case. Reach for the options object only when you want to change the
default behavior — atomic writes, no-clobber creates, schema-checked reads.
:::

## What `fs` will not do for you

:::caution[`fs` does not sandbox paths]
The facade treats whatever path you hand it as gospel — `"../../etc/passwd"`
resolves and reads just fine. **Path containment is the storage layer's
job**, not this package's. If you're accepting paths from user input, run
them through your storage layer (or validate them yourself) *before*
they reach `fs`. `@warlock.js/fs` is the low-level toolkit; it trusts its
caller.
:::

## Next

- [Atomic vs non-atomic](./02-atomic-vs-non-atomic) — when to flip
  `{ atomic: true }` on a write.
- [The fs facade](../guides/the-fs-facade) — the full facade surface,
  including lazy handles and read-modify-write helpers.
- [Reference / API](../reference/api) — every export with signatures.
