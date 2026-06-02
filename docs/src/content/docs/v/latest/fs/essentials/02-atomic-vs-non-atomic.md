---
title: "Atomic vs non-atomic writes"
description: When putFileAsync is fine and when you need atomicWriteAsync — concurrent readers, crash mid-write, config files, manifests, state.
sidebar:
  order: 2
  label: "Atomic vs non-atomic"
---

Both `putFileAsync` and `atomicWriteAsync` end with "the file contains
your bytes". The difference is what observers see in between. Picking the
wrong one for the situation is a footgun that doesn't surface until
production is under load.

## How a plain write looks to readers

`putFileAsync` writes directly to the destination. From a reader's point
of view, between the moment your write starts and the moment it finishes,
the file is:

1. Existing with the old content (before you started).
2. Truncated to zero bytes (the moment `writeFile` opens it for writing).
3. Partially populated (as bytes stream in).
4. Complete (after the write finishes).

If another process reads the file during steps 2 or 3, it sees garbage —
or worse, it sees something that *looks* valid but is half a file.
JSON parsers crash. YAML parsers crash. File watchers fire twice.

## How an atomic write looks

`atomicWriteAsync` writes to a different file first — a uniquely-named
temp sibling like `.manifest.json.a1b2c3d4e5f6.tmp`. After the full
content is on disk, it `rename`s the temp onto the target. The rename is
atomic on POSIX filesystems and effectively atomic on NTFS.

From a reader's point of view, the target file goes from:

1. The old content.
2. The new content.

There's no in-between state. The reader either sees the old version or
the new version — never something half-cooked.

## When non-atomic is fine

`putFileAsync` is the right call when:

- **No one's reading concurrently.** A throwaway log line, a temp file
  used only by the current process, a build artifact written before any
  reader exists.
- **Readers tolerate eventual consistency.** A cache file that the next
  read can simply regenerate if it's corrupt.
- **You control the timing.** You're going to read it yourself after the
  write completes, and nothing else touches it.

```ts
// ✅ Plain write is fine — no concurrent reader, this process owns the file.
await putFileAsync("./tmp/scratch.txt", workOutput);
const back = await getFileAsync("./tmp/scratch.txt");
```

## When you want atomic

`atomicWriteAsync` is the right call when:

- **Other processes or tools read the file.** A dev server's file
  watcher, a deployment script that polls for `manifest.json`, a sibling
  process consuming an event log.
- **The same script reads it back across runs.** A `.cache/last-run.json`
  that the next run depends on. A crash mid-write would leave it
  corrupt and the next run can't recover.
- **The file is short-but-critical.** Config files, manifests, state
  snapshots — anything where "half written" is a worse failure mode than
  "didn't write at all".

```ts
// ✅ Atomic — the dev server's file watcher reads this any moment.
await atomicWriteAsync("./config.toml", configString);

// ✅ Atomic — next run depends on this; can't survive a crash mid-write.
await atomicWriteJsonAsync("./.cache/last-run.json", {
  finishedAt: new Date().toISOString(),
  buildId: process.env.BUILD_ID,
});
```

## A simple decision tree

> Is the file read by anything other than the script that just wrote it,
> while the write is in flight? **→ atomic.**
>
> Could a crash mid-write leave you with a corrupt file that breaks the
> next run? **→ atomic.**
>
> Otherwise → `putFileAsync` is fine. It's slightly faster (one syscall
> fewer, no temp-file dance).

## What atomic does NOT protect against

It's worth knowing the edges:

- **Power loss between `writeFile` and `rename`** leaves the temp file
  behind. The target is unchanged, so readers see the old content — but
  the temp file is orphaned until you clean it up. For ironclad
  durability you'd need an `fsync` after the rename; the helper skips
  that for write speed.
- **Last-writer-wins.** Two concurrent `atomicWriteAsync` calls to the
  same target both succeed. Whichever rename completes last wins; the
  other write is lost. If you need read-modify-write atomicity, wrap the
  call in a lock — `@warlock.js/cache`'s `cache.lock(key, ttl, fn)` is one
  option.
- **Cross-mount renames.** If the temp file ends up on a different mount
  than the target (unusual, only happens if you override the helper's
  internals), the rename falls back to copy + delete which isn't atomic.
  The helper picks the target's directory specifically to keep the temp
  on the same mount.

## Next

- [Write atomically](../guides/write-atomically) — the guide-level
  walkthrough with the full sequence and edge cases.
- [Read and write files](../guides/read-and-write-files) — the everyday
  `putFileAsync` / `getFileAsync` flow.
