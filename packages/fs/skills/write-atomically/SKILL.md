---
name: write-atomically
description: 'Atomic file writes via atomicWriteAsync(path, content) — writes to a uniquely-named sibling temp + rename onto target so readers see old or complete new content, never half-written. Triggers: `atomicWriteAsync`, `atomicWriteJsonAsync`; "atomic file write", "write config file safely with concurrent readers", "manifest written by build step", "state file across runs", "avoid half-written files"; typical import `import { atomicWriteAsync, atomicWriteJsonAsync } from "@warlock.js/fs"`. Skip: plain writes — `@warlock.js/fs/read-and-write-files/SKILL.md`; read-modify-write locking — `@warlock.js/cache/use-cache-lock/SKILL.md`; competing libs `write-file-atomic`, `steno`, `fs-extra` `outputFile`.'
---

# Atomic file writes

`atomicWriteAsync` is the safe replacement for `putFileAsync` when readers can see the file at any moment. Same parent-directory auto-creation; the difference is the write strategy.

## Why use it

`putFileAsync` writes directly to the destination. If a reader picks the file up while you're partway through the write, they see truncated content. That's fine for ephemeral logs; not fine for:

- **Config files watched by a dev server / linter.** Half-written config makes the watcher emit a spurious error.
- **Manifests consumed by another process.** Two-process pipelines deserialize and crash on partial JSON.
- **State files between runs of the same script.** A crash mid-write leaves you with a corrupt file you can't read on the next run.

`atomicWriteAsync` writes to a uniquely-named sibling temp file first, then `rename`s it onto the target. On most filesystems the rename is atomic — readers see the old content, then the new content, never anything in between.

## Shape

```ts
import { atomicWriteAsync, atomicWriteJsonAsync } from "@warlock.js/fs";

await atomicWriteAsync("./config.toml", configString);
await atomicWriteAsync("./binary.bin", Buffer.from([0x01, 0x02]));   // accepts string OR Buffer

// JSON sugar — pretty-prints at 2-space indent
await atomicWriteJsonAsync("./manifest.json", { version: "1.0.0", files: [...] });
```

## What happens internally

```
1. mkdir(dir, recursive)
2. tempPath = `${dir}/.${name}.${randomHex(6)}.tmp`     ← unique sibling temp
3. writeFile(tempPath, content)
4. rename(tempPath, filePath)                            ← atomic on POSIX, near-atomic on NTFS
   on failure: unlink(tempPath)
```

The random 6-byte suffix prevents two concurrent writers from racing on the same temp file. The temp file lives in the **same directory** as the target so the rename is intra-mount (cross-mount rename would fall back to copy + unlink, which isn't atomic).

## Concurrent writers

Two `atomicWriteAsync` calls to the same target serialize at the rename. Whichever rename completes last wins. **No locking** — last-writer-wins is the contract.

If you need read-modify-write atomicity (each writer sees the previous writer's result), wrap the calls in a distributed lock — e.g. [`@warlock.js/cache/use-cache-lock/SKILL.md`](@warlock.js/cache/use-cache-lock/SKILL.md).

## Common shapes

### State file written across multiple runs

```ts
// On every successful run
await atomicWriteJsonAsync("./.cache/last-run.json", {
  finishedAt: new Date().toISOString(),
  buildId: process.env.BUILD_ID,
});
```

Crash partway through? Either the file has the previous run's content or the new run's content. Never garbage.

### Manifest emitted by a build step

```ts
const manifest = computeManifest(files);
await atomicWriteJsonAsync("./dist/manifest.json", manifest);
```

A reader (CDN purge script, deployment tool) that picks up `dist/manifest.json` while the build is mid-write doesn't crash.

### Config file watched by a dev server

```ts
const config = transformConfig(input);
await atomicWriteAsync("./config.toml", config);
```

The dev server's file watcher fires once after the rename, sees complete content. No double-event or partial-content noise.

## What it doesn't protect against

- **Filesystem corruption.** Power-loss between `writeFile` and `rename` leaves the temp file behind — that's `fsync` territory, not handled here. For ironclad durability, you'd need a `writeFile + fsync + rename + fsync(parent)` sequence; this helper skips the fsyncs for write speed.
- **Cross-filesystem renames.** If `dir` is a different mount from the target's actual storage (unusual), `rename` may fall back to copy + delete, which isn't atomic. Keep the temp on the same mount — the helper does this automatically.
- **Race conditions in your callers.** `atomicWriteAsync` makes the file write atomic; it doesn't serialize callers. Two callers stomping each other is your problem, not the helper's.

## See also

- [`@warlock.js/fs/read-and-write-files/SKILL.md`](@warlock.js/fs/read-and-write-files/SKILL.md) — `putFileAsync` for non-atomic writes
- [`@warlock.js/cache/use-cache-lock/SKILL.md`](@warlock.js/cache/use-cache-lock/SKILL.md) — distributed lock for read-modify-write protection

## Things NOT to do

- Don't use `atomicWriteAsync` when you don't need atomicity — `putFileAsync` is slightly faster (no rename round-trip). For ephemeral files, plain write is fine.
- Don't store the temp file outside the target directory. The helper picks the same dir on purpose so the rename is intra-mount; if you reach inside the source and change that, you lose the atomicity guarantee on cross-mount setups.
- Don't pair atomic writes with locked reads expecting consistency. A reader between the rename and your next write sees the intermediate complete state — that's the point of the helper. If you want every read to see a particular write, serialize with a lock.
- Don't sync after atomic write expecting "definitely persisted to disk" — the helper doesn't fsync. For durability guarantees, fsync the parent directory after the rename yourself.
