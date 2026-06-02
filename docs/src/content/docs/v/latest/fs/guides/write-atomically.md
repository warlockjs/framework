---
title: "Write atomically"
description: Atomic file writes via temp-file + rename — the safe write for config files, manifests, and state shared with other readers. Plus edge cases and what it doesn't protect.
sidebar:
  order: 3
  label: "Write atomically"
---

`atomicWriteAsync` is the safe replacement for `putFileAsync` when readers
can pick up the file at any moment. Same auto-parent-dirs convenience;
the difference is the write strategy.

## The shape

```ts
import { atomicWriteAsync, atomicWriteJsonAsync } from "@warlock.js/fs";

await atomicWriteAsync("./config.toml", configString);
await atomicWriteAsync("./binary.bin", Buffer.from([0x01, 0x02])); // string OR Buffer

// JSON sugar — pretty-printed at 2-space indent
await atomicWriteJsonAsync("./manifest.json", {
  version: "1.0.0",
  files: ["bundle.js"],
});
```

That's the entire surface. There's no `atomicWrite` sync variant — atomic
writes are always async, because the temp-file dance is worth the await
every time.

## What happens internally

The flow is small enough to keep in your head:

```
1. mkdir(dir, recursive)                                  ← parent dirs
2. tempPath = `${dir}/.${name}.${randomHex(6)}.tmp`        ← unique sibling
3. writeFile(tempPath, content)                            ← full write
4. rename(tempPath, filePath)                              ← atomic swap
   on failure: unlink(tempPath)                            ← clean up temp
```

Two things that matter:

- **The temp file lives in the same directory as the target.** On most
  filesystems `rename` is atomic only within the same mount. Putting the
  temp next to the target keeps it intra-mount.
- **The random 6-byte suffix** stops two concurrent writers from
  fighting over the same temp file. Each call gets its own temp.

After step 4, readers see the new content. Before step 4, they see the
old content. There's no moment when the file is half-written from a
reader's perspective.

## When to reach for it

The three big cases:

### Config files watched by a dev server / linter

```ts
const transformed = await transformConfig(rawConfig);
await atomicWriteAsync("./config.toml", transformed);
```

The dev server's file watcher fires once after the rename and sees the
complete content. With a plain `putFileAsync` you'd risk a double-event
(open-for-writing then close-after-write) or a parse error on partial
content.

### Manifests consumed by another process

```ts
const manifest = computeManifest(builtFiles);
await atomicWriteJsonAsync("./dist/manifest.json", manifest);
```

A deploy script polling `dist/manifest.json` doesn't need to know your
build is mid-write. It reads valid JSON every time.

### State files between runs of the same script

```ts
await atomicWriteJsonAsync("./.cache/last-run.json", {
  finishedAt: new Date().toISOString(),
  buildId: process.env.BUILD_ID,
});
```

If the process crashes between steps 3 and 4 in the diagram, the target
file is unchanged — the temp file is orphaned, but the next run can read
the previous run's state and recover. With `putJsonFileAsync`, a crash
mid-write leaves you with a truncated JSON file you can't parse.

## Edge cases

### What if the process crashes mid-write?

Three scenarios, depending on which step you crashed at:

| Crash at step | What's on disk | Effect |
| --- | --- | --- |
| 1 (mkdir) | Parent directory may exist, target unchanged | Reader sees old content (or no file if it didn't exist) |
| 2-3 (temp write) | Orphaned temp file in target's dir, target unchanged | Reader sees old content; temp file is leftover garbage |
| 4 (rename, mid-flight) | OS guarantees atomicity — either succeeds or doesn't | Reader sees old or new, never partial |

The orphaned temp files are the one wart. They're harmless — readers
ignore them (they're dot-files with a random suffix and `.tmp`
extension) — but they accumulate. A periodic cleanup of stale `.*.tmp`
files in directories you `atomicWrite` to is fine if you're paranoid.

### Concurrent writers

Two `atomicWriteAsync` calls to the same target both succeed. They
serialize at the rename step — last-writer-wins. There's no locking, no
CAS, no conflict detection.

```ts
// These two might run in any order; whichever rename completes last wins
await Promise.all([
  atomicWriteJsonAsync("./state.json", { from: "A" }),
  atomicWriteJsonAsync("./state.json", { from: "B" }),
]);
```

If you need read-modify-write atomicity — each writer sees the previous
writer's content — wrap the call in a lock. `@warlock.js/cache`'s
`cache.lock(key, ttl, fn)` works for distributed locking across processes.

### Partial reads on the reader side

A reader reading the target while a different writer is mid-rename will
see either the pre-rename file (with old content) or the post-rename file
(with new content). The rename is atomic from the reader's perspective.

The only "partial read" risk is if your reader is also reading the temp
file directly — which they wouldn't, because the temp file name starts
with `.` and ends with `.tmp` and includes a random suffix nobody guesses.

### Filesystem corruption / power loss

`atomicWriteAsync` doesn't `fsync`. After the rename returns, the bytes
are in the OS write cache; the OS will flush them to physical disk on its
own schedule (usually within a few seconds).

If the machine loses power between rename and flush, on many filesystems
the rename is durable but the file's *contents* may not be — you could
end up with the new filename pointing to garbage. Properly ironclad
durability requires `fsync(tempFd)` before rename, then `fsync(parentDir)`
after. The helper skips both for speed; if you're writing financial
ledgers or replicated state, drop down to `node:fs/promises` and do the
fsyncs yourself.

For the everyday "I want readers to never see half a file" case (which is
what 99% of atomic-write needs are), the helper is the right level.

### Cross-mount renames

If somehow the temp file ends up on a different mount than the target
(unusual — only happens if you override the helper's internals or set up
a fancy union mount), the rename falls back to copy + delete which is
**not atomic**. The helper picks the target's directory deliberately so
the temp stays on the same mount.

## When NOT to use it

`putFileAsync` is slightly faster (no temp-file + rename round trip).
Stick with it when:

- The file is ephemeral and only this process touches it.
- You're writing a log file that's append-and-forget.
- You're going to read it back immediately in the same script with no
  external readers in the picture.

Atomic isn't free — every write involves a temp file create, a full
content write, a rename, and a potential temp-file cleanup on failure.
Use it where it earns its keep.

## Related

- [Atomic vs non-atomic](../essentials/02-atomic-vs-non-atomic) — the
  decision tree for picking between the two.
- [Read and write files](./read-and-write-files) — the plain
  `putFileAsync` flow.
- [Reference / API](../reference/api) — full signatures.
