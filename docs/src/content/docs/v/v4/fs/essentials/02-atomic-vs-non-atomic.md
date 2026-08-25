---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Atomic vs non-atomic writes"
description: "When fs.files.put is fine and when you need { atomic: true } — concurrent readers, file watchers, build steps, and the last-write-wins caveat."
sidebar:
  order: 2
  label: "Atomic vs non-atomic writes"
---

Every write with the [`fs` facade](../guides/the-fs-facade) ends the same way:
the file contains your bytes. The interesting question is what a *reader*
sees in the middle. That's the whole difference between a plain write and an
atomic one, and it's a footgun that stays quiet until production is under
load.

## The two calls

Same method, one option. That's the entire API surface for this decision:

```ts
// Plain write — fast, direct.
await fs.files.put("./config.toml", configString);

// Atomic write — reader never sees a half-written file.
await fs.files.put("./config.toml", configString, { atomic: true });
```

`put` writes straight to the destination. `{ atomic: true }` writes to a
temp sibling first, then renames it onto the target in one step.

## What a plain write looks like to a reader

A direct write isn't a single instant — it's a sequence. If another process
reads mid-flight, here's the state it can catch:

```text
old content  →  truncated (0 bytes)  →  half the new content  →  complete
```

A reader that lands on the middle two states gets garbage. JSON parsers
throw, YAML parsers throw, and file watchers fire on a file that isn't done
yet.

```ts
// Deploy script polls this file. A plain write can hand it a truncated blob.
await fs.files.putJson("./manifest.json", manifest);
```

## What an atomic write looks like to a reader

With `{ atomic: true }` the facade writes the full content to a
uniquely-named temp file in the same directory, then `rename`s it onto the
target. Rename is atomic on POSIX and effectively atomic on NTFS, so the
target only ever has two states:

```text
old content  →  new content
```

There is no in-between. The reader sees the old version or the new version,
never a stitched-together mess.

```ts
// The deploy poller now only ever reads a complete manifest.
await fs.files.putJson("./manifest.json", manifest, { atomic: true });
```

## When atomic actually matters

Reach for `{ atomic: true }` the moment *someone else* can read the file
while you write it:

- A dev server's **file watcher** re-reads on every change.
- A **build step** that polls for `manifest.json` before continuing.
- A **sibling process** consuming a state file or an event log.
- A **crash mid-write** would leave a config the next run can't parse.

```ts
// A file watcher can read this at any moment — atomic keeps it whole.
await fs.files.put("./.cache/graph.json", serialized, { atomic: true });
```

## When plain is fine

Skip the temp-file dance when nothing else is looking:

- A **scratch file** this process owns and reads back itself.
- A **build artifact** written before any reader exists.
- A **regenerable cache** where a corrupt read just triggers a rebuild.

```ts
// No concurrent reader, this process owns the file — plain write is fine.
await fs.files.put("./tmp/scratch.txt", workOutput);
const back = await fs.files.get("./tmp/scratch.txt");
```

Plain is also a touch faster: one syscall fewer, no rename.

:::note[The `{ atomic }` option travels with the JSON writers too]
It's not just `put`. `fs.files.putJson`, `fs.files.editJson`, and
`fs.files.mergeJson` all accept `{ atomic: true }` and route through the same
temp-file-then-rename path. Any write you'd want atomic can be — including the
read-modify-write helpers.
:::

## The last-write-wins caveat

`fs.files.edit(path, fn)`, `fs.files.editJson(path, fn)`, and
`fs.files.mergeJson(path, patch)` are **read-modify-write sugar, not a
lock**. `{ atomic: true }` makes the *write* half indivisible — a reader
never catches a partial file — but it does nothing to serialize two
concurrent editors:

```ts
// Two runs edit the same counter at once.
await fs.files.editJson("./counter.json", (d) => ({ n: d.n + 1 }), { atomic: true });
```

Both read `n`, both compute `n + 1`, both write. Whichever rename lands last
wins; the other increment is silently lost. Atomicity here means "no torn
file", not "no lost update". If you need true read-modify-write atomicity,
wrap the whole thing in a lock — `@warlock.js/cache`'s
`cache.lock(key, ttl, fn)` is one option.

:::caution[Atomic is not durability]
A power loss *between* the temp write and the rename leaves the temp file
orphaned and the target unchanged (readers still see the old content — good).
The facade skips a post-rename `fsync` for write speed, so "atomic" means
crash-*consistent*, not crash-*durable*.
:::

## A quick decision tree

> Can anything other than this script read the file while the write is in
> flight? **→ `{ atomic: true }`.**
>
> Could a crash mid-write leave a corrupt file the next run can't recover
> from? **→ `{ atomic: true }`.**
>
> Otherwise a plain `fs.files.put` is fine — and slightly faster.

## Under the hood

`{ atomic: true }` delegates to the low-level `atomicWriteAsync` primitive —
the temp-file-then-rename mechanism described above. Atomic writes are
inherently async: there's no sync variant, because the temp-file dance is worth
the `await` every time. If you're already working at the primitive layer you can
call `atomicWriteAsync` directly, but for app code reach for
`fs.files.put(path, content, { atomic: true })`.

## Next

- [Write atomically](../guides/write-atomically) — the guide-level
  walkthrough with the full sequence and edge cases.
- [The fs facade](../guides/the-fs-facade) — the full facade tour.
- [The helpers](./01-the-helpers) — the low-level sync/async layer beneath it.
