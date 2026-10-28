---
title: "Write atomically"
description: "Pass { atomic: true } to fs.files.put — a temp-file + rename write so readers never catch a half-written file. When to use it, what it protects, and what it doesn't."
sidebar:
  order: 3
  label: "Write atomically"
---

A plain `fs.files.put` writes in place: the file is opened, truncated, and
filled. For a moment it's half-written — and if a linter, dev server, or
sibling process reads it right then, it sees garbage or a parse error.

An **atomic** write avoids that window. Add one option:

```ts
import { fs } from "@warlock.js/fs";

await fs.files.put("./config.toml", configString, { atomic: true });
await fs.files.putJson("./dist/manifest.json", manifest, { atomic: true });
```

Same call you already know, same auto-created parent directories — the only
difference is _how_ the bytes land.

:::note[Buffers are always atomic]
When the content is a `Buffer` rather than a string, `put` routes through the
atomic writer automatically — you don't need to pass `{ atomic: true }`.
:::

## What "atomic" buys you

Under the hood, `{ atomic: true }` writes to a uniquely-named temp file in the
**same directory**, then `rename`s it over the target. On a single filesystem a
`rename` is atomic: a reader sees either the whole old file or the whole new
file, never a mix.

So the guarantee is precise, and worth stating plainly:

- **Readers never see a partial file.** Before the rename they read the old
  content; after it they read the new. There is no in-between.
- **A crash leaves the target intact.** If the process dies mid-write, the
  half-written bytes are in the _temp_ file — the real file is untouched, so
  the next run can still read the last good version.

## When to reach for it

Three everyday cases cover almost all real use:

- **Config files something else watches.** A dev server or linter with a file
  watcher fires once on the rename and reads complete content — no
  double-event, no parse error on a partial read.
- **Manifests another process consumes.** A deploy script polling
  `dist/manifest.json` reads valid JSON every time, even mid-build.
- **State files between runs.** If the process crashes, the previous run's
  state survives intact, so the next run can recover instead of choking on a
  truncated file.

## What it doesn't protect against

Atomic is about _visibility_, not _coordination_ or _durability_. Know the edges:

- **No read-modify-write safety.** Two atomic writes to the same path both
  succeed and serialize at the rename — last writer wins. If each writer must
  see the previous one's content, wrap the operation in a lock (for cross-process
  work, use [multi-file transactions](./multi-file-transactions)).
- **No default `fsync`.** The facade's atomic writes remain unflushed. For a
  durable single-file replacement on POSIX use the flat helper:

  ```ts
  import { atomicWriteAsync } from "@warlock.js/fs";

  await atomicWriteAsync("./state.json", "{}", { durability: "full" });
  ```

  This flushes file bytes before rename and the parent directory afterward,
  including newly created parent entries. Full durability is refused on Windows;
  explicit `durability: "file"` flushes file bytes without a power-loss guarantee.
  A directory-sync error can occur after the target changed. For journaled
  recovery and coordinated readers, use
  [multi-file transactions](./multi-file-transactions).

- **Same-mount only.** The temp file is placed beside the target so the rename
  stays intra-mount. Renames across mounts aren't atomic — not a concern unless
  you've engineered an unusual union mount.

- **Open readers on Windows.** Windows cannot replace a file while another
  handle has it open. The final rename retries for about 4 seconds, so ordinary
  reads that open, read and close the file are fine. A process that keeps the
  file open the whole time (or reads it in a tight loop with no pause) blocks
  the replace, and the write fails with `AtomicWriteError`.

## When to skip it

`{ atomic: true }` isn't free — it's a temp-file create, a full write, and a
rename every time. For a file only this process touches, an append-only log, or
something you write and immediately read back in the same script, a plain
`fs.files.put` is simpler and a touch faster.

The decision tree lives in [Atomic vs non-atomic](../essentials/02-atomic-vs-non-atomic).

## Related

- [Atomic vs non-atomic](../essentials/02-atomic-vs-non-atomic) — how to choose.
- [Read and write files](./read-and-write-files) — the plain `fs.files.put` flow.
- [Reference / API](../reference/api) — every method and option.
