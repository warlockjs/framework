---
title: "Read a user-chosen folder safely"
description: Import data from a folder the user points you at — an old data directory, an extracted export — without following planted symlinks, escaping through .. or absolute paths, or loading an unbounded amount of data. Uses fs.confined.
sidebar:
  order: 7
  label: "Read a user-chosen folder safely"
---

Your app offers "import from an old data folder". The user picks a path; the
folder came from somewhere else — an older install, a backup, a zip from a
colleague. Its manifest names files, its tree may be large, and nothing stops
it from containing `rooms/main/cover.png -> /home/app/.env` or a manifest entry
`"../../.ssh/id_rsa"`.

Read it through [`fs.confined`](../guides/read-a-folder-confined) and those
cases become typed errors you can report, instead of reads outside the folder.

## The import

```ts title="src/import/import-data-folder.ts"
import { fs, FsLimitExceededError, FsLinkRefusedError, FsPathEscapeError } from "@warlock.js/fs";

// Your app's own persistence.
declare function saveRoom(id: string, data: unknown): Promise<void>;
declare function saveAttachment(path: string, bytes: Buffer): Promise<void>;

type Manifest = { rooms: { id: string; file: string }[] };

type ImportReport = {
  imported: string[];
  skipped: { path: string; why: string }[];
};

export async function importDataFolder(chosenFolder: string): Promise<ImportReport> {
  // Throws right away if the folder is missing, not a folder, or itself a symlink.
  const folder = fs.confined(chosenFolder, {
    maxFileBytes: 8 * 1024 * 1024, // no single file over 8 MiB
    maxEntries: 20_000, // the whole tree, not per folder
    maxDepth: 12,
  });

  const report: ImportReport = { imported: [], skipped: [] };

  // 1. The manifest names files: treat every name in it as untrusted input.
  const manifest = await folder.readJson<Manifest>("manifest.json");

  for (const room of manifest.rooms) {
    try {
      const data = await folder.readJson(room.file);
      await saveRoom(room.id, data);
      report.imported.push(room.file);
    } catch (error) {
      if (!skip(error, report)) throw error;
    }
  }

  // 2. Pick up attachments by walking the tree — links are listed, never followed.
  for await (const entry of folder.walk("attachments")) {
    if (entry.type === "symlink" || entry.type === "other") {
      report.skipped.push({ path: entry.path, why: entry.type });
      continue;
    }

    if (entry.type !== "file") continue;

    try {
      await saveAttachment(entry.path, await folder.readBuffer(entry.path));
      report.imported.push(entry.path);
    } catch (error) {
      if (!skip(error, report)) throw error;
    }
  }

  return report;
}

/** Record a refusal from the confined reader; anything else is a real failure. */
function skip(error: unknown, report: ImportReport): boolean {
  if (error instanceof FsPathEscapeError || error instanceof FsLinkRefusedError) {
    report.skipped.push({ path: error.path, why: `${error.type}: ${error.reason}` });
    return true;
  }

  if (error instanceof FsLimitExceededError && error.limit === "maxFileBytes") {
    report.skipped.push({ path: error.path, why: `larger than ${error.max} bytes` });
    return true;
  }

  return false;
}
```

## What each guard stops

| The folder contains                                 | What happens                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| a manifest entry `"../../.ssh/id_rsa"`              | `FsPathEscapeError`, `reason: "parent-traversal"` — nothing is read           |
| a manifest entry `"/etc/passwd"`                    | `FsPathEscapeError`, `reason: "absolute"`                                     |
| `rooms/main.json -> /home/app/.env`                 | `FsLinkRefusedError`, `reason: "symlink"`                                     |
| `attachments -> /` (a linked folder)                | `walk("attachments")` throws `FsLinkRefusedError`                             |
| a file swapped for a link while the import runs     | `FsLinkRefusedError`, `reason: "identity-changed"`                            |
| a 4 GB file, or one that keeps growing              | `FsLimitExceededError`, `limit: "maxFileBytes"` — at most 8 MiB + 1 byte read |
| millions of tiny files, or a 10 000-level deep tree | the walk throws `FsLimitExceededError` (`maxEntries` / `maxDepth`)            |
| a FIFO named `rooms/main.json`                      | refused with `EINVAL` instead of blocking the import                          |

The entry and depth bounds are not skipped in `skip()`: a folder over them is
not the kind of folder this import expects, so the whole import stops and the
error reaches the user.

## Choosing the folder

`fs.confined()` refuses a root that is itself a symbolic link. If your users
reasonably pick a linked folder (a `current` link to the latest backup), pass
`allowSymlinkedRoot: true` — the reader is then confined to the link's target,
fixed at the moment you create it. Links in the parents of the chosen folder
are always fine.

If the export legitimately links inside itself (`latest -> 2026-10-01`), use
`followLinks: true`: links are followed only while their target stays inside
the folder, and a link out still throws (`reason: "link-escape"`).

## See also

- [Read a folder confined](../guides/read-a-folder-confined) — every guarantee and limit in detail.
- [Resolve project-relative paths](./resolve-project-relative-paths) — anchoring paths to your own folders.
