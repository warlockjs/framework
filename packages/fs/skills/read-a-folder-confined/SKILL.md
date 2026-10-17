---
name: read-a-folder-confined
description: 'Read a folder you do not control (user-chosen import folder, uploaded archive extracted to disk, a mounted volume) without being tricked into reading elsewhere: `fs.confined(root, options)` / `createConfinedReader` with `readText`, `readBuffer`, `readJson`, `stat`, `exists`, `list`, `walk`; refuses `..` and absolute paths, refuses symlinks and Windows junctions at every path component, opens with `O_NOFOLLOW` and re-checks device/inode, caps file size while reading and entry count/depth while walking. Triggers: `fs.confined`, `createConfinedReader`, `ConfinedReader`, `FsPathEscapeError`, `FsLinkRefusedError`, `FsLimitExceededError`, `followLinks`, `maxFileBytes`, `maxEntries`, `maxDepth`, `allowSymlinkedRoot`; "path traversal", "symlink attack", "read a user-chosen folder safely", "jail reads to a directory", "no-follow read", "zip slip after extraction"; typical import `import { fs, FsLinkRefusedError } from "@warlock.js/fs"`. Skip: an agent''s read/write/shell jail — the `use-a-workspace` topic of the `warlock-js-ai-workspace` skill; serving uploaded files over HTTP — storage drivers in @warlock.js/core; ordinary reads of your own files — the `read-and-write-files` topic.'
---

# Read a folder you do not control

`fs.files.*` and the flat helpers read any path you give them and follow symbolic links. That is right for your own files and wrong for a folder a user picked, an extracted upload or a shared volume: a `../` in a name, an absolute path in a manifest, or a link planted inside the folder (`photos/avatar.jpg -> /etc/passwd`) reads outside it.

`fs.confined(root, options)` returns a reader that cannot leave `root`.

```ts
import { fs } from "@warlock.js/fs";

type Room = { name: string };
declare const userChosenFolder: string;

const folder = fs.confined(userChosenFolder, {
  maxFileBytes: 8 * 1024 * 1024, // default 16 MiB, enforced while reading
  maxEntries: 20_000, // default 100_000, per list call / per whole walk
  maxDepth: 16, // default 64, walk only
});

const room = await folder.readJson<Room>("rooms/main/room.json"); // optional { schema }
const notes = await folder.readText("notes.md");
const image = await folder.readBuffer("rooms/main/cover.png", { maxFileBytes: 2_000_000 });

if (await folder.exists("legacy.json")) {
  const info = await folder.stat("legacy.json"); // { path, name, type, size, lastModified }
  console.log(info.size, room.name, notes.length, image.byteLength);
}

for (const entry of await folder.list("rooms")) {
  console.log(entry.type, entry.path); // "file" | "directory" | "symlink" | "other"
}

for await (const entry of folder.walk("rooms")) {
  if (entry.type === "file" && entry.name.endsWith(".json")) {
    await folder.readJson(entry.path); // entry.path is root-relative: pass it straight back
  }
}
```

`createConfinedReader(root, options)` is the same factory as a named export.

## What it guarantees

- **Root**: canonicalised once (`realpath`) when the reader is created, synchronously. A root that is itself a symlink throws `FsLinkRefusedError` (`reason: "root-symlink"`) unless `allowSymlinkedRoot: true`. Links in the root's parent folders (macOS `/tmp`) are fine. A root replaced later is refused on the next call.
- **Paths**: relative to the root only. Absolute paths (`/x`, `C:\x`, `\\server\share`, `C:x`) and a `..` that climbs above the root after normalisation throw `FsPathEscapeError` (`reason: "absolute" | "parent-traversal"`). `a/../b` is fine. On Windows `:` streams, device names (`CON`, `nul.txt`) and names ending in `.` or a space are `reason: "invalid"`.
- **Links**: every component is `lstat`-ed from the root down; a symlink anywhere throws `FsLinkRefusedError` (`reason: "symlink"`, `linkPath` names the component). Node reports Windows junctions to drive paths as symlinks too. `list`/`walk` report links as `type: "symlink"` and never descend into them.
- **Race**: files open with `O_NOFOLLOW` (where the OS has it) and the opened handle's device/inode must match the checked entry, so a file or parent folder swapped for a link between the check and the open throws `FsLinkRefusedError` (`reason: "identity-changed"`). On Linux, folders are read through the checked descriptor; elsewhere their identity is re-checked after the read.
- **Bounds**: `FsLimitExceededError` with `limit` (`"maxFileBytes" | "maxEntries" | "maxDepth"`), `max` and `actual`. The size bound applies while reading, so a file that grows after the check still stops. A walk over its bounds throws rather than returning a partial tree. `Infinity` turns a bound off.

All three errors carry `type` (`"path-escape"`, `"link-refused"`, `"limit-exceeded"`) and `path`. Missing paths throw the ordinary `ENOENT`/`ENOTDIR`; `exists()` returns `false` for those but still throws for an escape or a link, so a hostile path is never mistaken for a missing one.

## Handling refusals

```ts
import { fs, FsLimitExceededError, FsLinkRefusedError, FsPathEscapeError } from "@warlock.js/fs";

declare const nameFromManifest: string;
const folder = fs.confined("/srv/imports/current-job");
const report: { skipped: { path: string; why: string }[] } = { skipped: [] };

try {
  await folder.readText(nameFromManifest);
} catch (error) {
  if (error instanceof FsPathEscapeError || error instanceof FsLinkRefusedError) {
    report.skipped.push({ path: error.path, why: error.type });
  } else if (error instanceof FsLimitExceededError) {
    report.skipped.push({ path: error.path, why: `${error.limit} (${error.max})` });
  } else {
    throw error;
  }
}
```

## Following links that stay inside

```ts
const folder = fs.confined(root, { followLinks: true });
await folder.readText("current/config.json"); // `current -> releases/42` inside root: read
await folder.readText("leak.txt"); // `leak.txt -> /etc/passwd`: FsPathEscapeError, reason "link-escape"
```

Each link is resolved with `realpath` and must land inside the root. `walk` descends into inside folder links once each (cycles cannot loop) and skips links that point outside.

## Limits to know

- **Hard links** are not links to the reader: a hard link inside the root to a file elsewhere on the same filesystem is the same inode and is read. Creating one takes write access inside the root on the same filesystem as the target.
- **Windows**: volume mount points and other reparse points that are not symlinks or drive-path junctions look like ordinary folders to Node and are traversed. There is no `O_NOFOLLOW`; the device/inode check refuses a swapped file instead.
- `exists`/`stat` use the same checks as the readers, so a symlinked path makes them throw, not return `false`.
- The reader only reads. For an agent that also writes and runs commands, use `@warlock.js/ai-workspace`; its jail follows links that stay inside and accepts absolute paths inside the jail by design.
