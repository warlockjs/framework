---
title: "Read a folder confined"
description: "fs.confined(root) — a reader that cannot leave its root: refuses .. and absolute paths, refuses symlinks and junctions at every component, closes the check-then-open race, and caps file size and entry counts. Typed FsPathEscapeError, FsLinkRefusedError and FsLimitExceededError."
sidebar:
  order: 6
  label: "Read a folder confined"
---

`fs.files.*` reads whatever path you give it and follows symbolic links. That
is right for your own files. It is wrong for a folder somebody else filled —
a folder the user picked to import from, an archive you extracted, a shared
volume — where one `../` in a manifest, one absolute path, or one planted link
(`avatar.jpg -> /home/app/.env`) reads outside the folder.

`fs.confined(root, options)` returns a reader that stays inside `root`:

```ts title="src/import/read-export.ts"
import { fs } from "@warlock.js/fs";

const folder = fs.confined(exportFolder, { maxFileBytes: 8 * 1024 * 1024 });

const manifest = await folder.readJson<Manifest>("manifest.json");
const readme = await folder.readText("README.md");

for await (const entry of folder.walk("rooms", { maxEntries: 20_000 })) {
  if (entry.type === "file") {
    const bytes = await folder.readBuffer(entry.path);
  }
}
```

The same factory is exported as `createConfinedReader(root, options)`.

## The reader

| Method                                    | Returns                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `readText(path, { encoding? })`           | `Promise<string>` (UTF-8 by default)                                         |
| `readBuffer(path)`                        | `Promise<Buffer>`                                                            |
| `readJson<T>(path, { schema? })`          | `Promise<T>`, validated against any Standard Schema when given               |
| `stat(path)`                              | `{ path, name, type: "file" \| "directory" \| "other", size, lastModified }` |
| `exists(path)`                            | `Promise<boolean>`                                                           |
| `list(path?, { maxEntries? })`            | `ConfinedEntry[]` directly inside a folder, sorted by name                   |
| `walk(path?, { maxEntries?, maxDepth? })` | `AsyncGenerator<ConfinedEntry>`, depth-first, a folder before its contents   |

Every path is **relative to the root** (`""` or `"."` is the root itself), and
every entry `list` and `walk` give back carries a root-relative `path` you can
pass straight to another method:

```ts
type ConfinedEntry = {
  path: string; // "rooms/main/room.json", always "/"-separated
  name: string;
  type: "file" | "directory" | "symlink" | "other"; // the entry's own type, never its target's
  depth: number; // 1 = directly inside the folder listed or walked
};
```

The reader exposes its canonical `root` and its bounds (`maxFileBytes`,
`maxEntries`, `maxDepth`, `followLinks`).

## Options

| Option               | Default | What it does                                                                                        |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `followLinks`        | `false` | Follow a link only when its resolved target stays inside the root; otherwise every link is refused. |
| `allowSymlinkedRoot` | `false` | Accept a root that is itself a symlink (the reader is confined to its target).                      |
| `maxFileBytes`       | 16 MiB  | Largest file a read returns. Enforced while reading. Per call: `readText(path, { maxFileBytes })`.  |
| `maxEntries`         | 100 000 | Most entries one `list` call, or one whole `walk`, may read. Per call: `{ maxEntries }`.            |
| `maxDepth`           | 64      | Deepest level `walk` descends to. Per call: `walk(path, { maxDepth })`.                             |

`Infinity` turns a bound off. A negative or fractional bound throws a
`TypeError`.

## What it guarantees

**The root is fixed when the reader is created.** It is resolved with
`realpath` once, synchronously, in `fs.confined()`. A root that is itself a
symbolic link throws `FsLinkRefusedError` (`reason: "root-symlink"`) unless you
pass `allowSymlinkedRoot: true`; links in the root's _parent_ folders (macOS
`/tmp`, a deploy `current` link above it) are fine. A missing root throws
`ENOENT`, a file throws `ENOTDIR`. If the root is later replaced by a link or
another folder, the next call is refused.

**Paths cannot climb out.** Before anything touches the disk, the path is
normalised and checked:

- absolute paths — `/etc/passwd`, and on Windows `C:\x`, `C:x`, `\\server\share`
  — throw `FsPathEscapeError` with `reason: "absolute"`, even when they point
  inside the root;
- a `..` that climbs above the root throws `reason: "parent-traversal"`
  (`a/../b` is fine and means `b`);
- a NUL byte, and on Windows a `:` (alternate data stream), a device name
  (`CON`, `nul.txt`, `COM1`) or a name ending in `.` or a space, throws
  `reason: "invalid"`.

`..` is resolved on the text, never through the disk: `link/../x` is `x` in
the root.

**No link is followed.** Every component from the root down is checked with
`lstat`. A symbolic link anywhere — the file itself or any folder on the way —
throws `FsLinkRefusedError` with `reason: "symlink"` and `linkPath` naming the
component (`"rooms/portal"`). Node reports Windows junctions that point at a
drive path as symbolic links too, so they are refused the same way. `list` and
`walk` report links as `type: "symlink"` and never descend into them.

**The check cannot be raced.** Between checking a path and opening it,
another process could swap the file — or a folder above it — for a link. The
reader opens files with `O_NOFOLLOW` where the platform has it, then compares
the open handle's device and inode with the entry it checked. A file swapped
for a link, a parent folder swapped for a link to elsewhere, or a file replaced
by another file throws `FsLinkRefusedError` with `reason: "identity-changed"`
and nothing is returned. On Linux, folders are opened the same way and read
through the checked descriptor (`/proc/self/fd`); elsewhere a folder's identity
is checked again after it is read.

**Reads are bounded.** `FsLimitExceededError` carries `limit`
(`"maxFileBytes"`, `"maxEntries"` or `"maxDepth"`), `max`, `actual` and the
`path` being read:

- `maxFileBytes` is checked against the size before opening **and while
  reading**: a file that grows after the check stops at `max + 1` bytes.
  FIFOs, sockets and devices are refused (`EINVAL`) — they could block or never
  end;
- `maxEntries` counts every entry read by one `list`, or across a whole `walk`;
- `maxDepth` stops a `walk` from descending into a folder deeper than the
  bound.

A walk over a bound throws instead of returning a silently partial tree. Set
the bounds to what a legitimate folder can hold.

## Errors

All three are exported classes with a `type` discriminator, the caller's
`path`, and the reader's `root` where it applies:

| Class                  | `type`             | Extra fields                                                               |
| ---------------------- | ------------------ | -------------------------------------------------------------------------- |
| `FsPathEscapeError`    | `"path-escape"`    | `reason`: `"absolute"`, `"parent-traversal"`, `"invalid"`, `"link-escape"` |
| `FsLinkRefusedError`   | `"link-refused"`   | `reason`: `"symlink"`, `"root-symlink"`, `"identity-changed"`; `linkPath`  |
| `FsLimitExceededError` | `"limit-exceeded"` | `limit`, `max`, `actual`                                                   |

Missing paths throw the usual `ENOENT` / `ENOTDIR`, and a folder passed to a
file reader throws `EISDIR`. `exists()` returns `false` for a missing path but
still throws for an escape or a link, so a hostile path is never reported as
"not there".

```ts
import { FsLimitExceededError, FsLinkRefusedError, FsPathEscapeError } from "@warlock.js/fs";

try {
  return await folder.readText(nameFromManifest);
} catch (error) {
  if (error instanceof FsPathEscapeError || error instanceof FsLinkRefusedError) {
    skipped.push({ path: error.path, why: error.type });
    return undefined;
  }

  if (error instanceof FsLimitExceededError) {
    skipped.push({ path: error.path, why: `${error.limit} over ${error.max}` });
    return undefined;
  }

  throw error;
}
```

## Following links that stay inside

Some folders legitimately use links — a `current -> releases/42` pointer, a
shared `assets` folder. With `followLinks: true`, each link is resolved with
`realpath` and accepted only when the target is inside the root:

```ts
const folder = fs.confined(root, { followLinks: true });

await folder.readText("current/config.json"); // current -> releases/42: read
await folder.readText("leak.txt"); // leak.txt -> /etc/passwd: FsPathEscapeError, reason "link-escape"
```

`stat` reports the target's type. `walk` descends into folder links that stay
inside, walks each folder once (so a link back to an ancestor cannot loop), and
yields links that point outside as `symlink` without descending.

## Limits

- **Hard links** are not links: a hard link inside the root to a file elsewhere
  on the same filesystem is the same file, and is read. Creating one takes
  write access inside the root on the same filesystem as the target.
- **Windows**: there is no `O_NOFOLLOW`, so the device/inode comparison is
  what refuses a swapped file. Node reports symbolic links and drive-path
  junctions as links; volume mount points and other reparse points (cloud
  placeholders, deduplicated files) look like ordinary folders and files and
  are traversed.
- The reader only **reads**. It does not write, and it is not an OS sandbox
  around code you run.

## Relation to the AI workspace jail

`@warlock.js/ai-workspace` jails an agent's tools with its own resolver. That
jail accepts absolute paths inside the workspace, several `allowPaths` roots,
`denyPaths` globs, links whose target stays inside, and paths that do not exist
yet (for writes), because its tools also write files and run commands. The
confined reader is stricter on purpose and only reads; the two are separate
implementations.

## See also

- [Read a user-chosen folder safely](../recipes/read-a-user-chosen-folder-safely) — an import, end to end.
- [Read and write files](./read-and-write-files) — the everyday, unconfined readers.
- [API reference](../reference/api#fsconfinedroot-options-confinedreader)
