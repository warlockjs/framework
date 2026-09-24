---
name: manage-directories
description: 'Manage directories + files — ensureDirectory (mkdir -p), list / listFiles / listDirectories, copyFile / copyDirectory, renameFile, unlink (ENOENT-safe), removeDirectory (recursive force). Triggers: `ensureDirectoryAsync`, `listAsync`, `listFilesAsync`, `listDirectoriesAsync`, `copyFileAsync`, `copyDirectoryAsync`, `renameFileAsync`, `unlinkAsync`, `removeDirectoryAsync`; "create directory recursively", "list files in folder", "delete directory recursively", "copy or rename folder", "walk a tree"; typical import `import { ensureDirectoryAsync, listFilesAsync, removeDirectoryAsync } from "@warlock.js/fs"`. Skip: file IO — `@warlock.js/fs/read-and-write-files/SKILL.md`; atomic writes — `@warlock.js/fs/write-atomically/SKILL.md`; competing libs `fs-extra`, `mkdirp`, `rimraf`, `recursive-readdir`, `glob`; native `node:fs/promises`.'
---

# Manage directories and files on disk

Same two-suffix convention as the rest of `@warlock.js/fs` — `*Async` is async, the bare name is sync.

## Ensure a directory exists

```ts
import { ensureDirectoryAsync } from "@warlock.js/fs";

await ensureDirectoryAsync("./dist/cache/v2");
// recursively creates dist, dist/cache, dist/cache/v2 if missing
// no-op if everything already exists
```

Idempotent. Pair it with anything that writes — though `putFileAsync` already does this internally, so you rarely need `ensureDirectory` for the immediate parent of a file you're about to write.

## List children

Three variants:

```ts
import { listAsync, listFilesAsync, listDirectoriesAsync } from "@warlock.js/fs";

await listAsync("./src");              // [files + subdirs] full paths
await listFilesAsync("./src");          // only regular files
await listDirectoriesAsync("./src");    // only directories
```

Returns **full paths** (joined to the directory you passed in), not bare entry names. Pass them straight to other fs calls.

```ts
const components = await listFilesAsync("./src/components");
for (const file of components) {
  // file = "./src/components/Button.tsx"
  await processComponent(file);
}
```

Only the immediate children — non-recursive. Recurse yourself with the directory variant + a stack/queue if you need deep traversal.

## Copy

```ts
import { copyFileAsync, copyDirectoryAsync } from "@warlock.js/fs";

// File — creates the destination's parent directories
await copyFileAsync("./dist/bundle.js", "./snapshot/v2/bundle.js");

// Directory — fully recursive
await copyDirectoryAsync("./public", "./dist/public");
```

`copyFile` creates the destination's parent directories. `copyDirectory` uses Node's recursive `cp` under the hood — preserves the tree, overwrites existing files.

## Rename / move

```ts
import { renameFileAsync } from "@warlock.js/fs";

await renameFileAsync("./tmp/foo.txt", "./final/foo.txt");
```

Works on files and directories. Cross-device renames (e.g. `/tmp` → `/var`) may fail with `EXDEV` — the OS won't move across mounts. For cross-device, copy then delete.

## Delete

```ts
import { unlinkAsync, removeDirectoryAsync } from "@warlock.js/fs";

await unlinkAsync("./obsolete.txt");          // single file — ENOENT-safe
await removeDirectoryAsync("./dist");          // recursive + force — ENOENT-safe
```

Both are **idempotent for missing targets** — calling on a path that doesn't exist is a no-op, not an error. Other errors (`EACCES`, `EBUSY`) still throw.

## Picking a delete shape

| Task | Reach for |
| --- | --- |
| Drop one file | `unlinkAsync(path)` |
| Drop a whole tree | `removeDirectoryAsync(path)` |
| Drop everything in a folder but keep the folder | `for (const f of await listAsync(dir)) await removeDirectoryAsync(f)` (file? unlink; dir? recurse) |

## Common shapes

### Snapshot a build output

```ts
import { ensureDirectoryAsync, copyDirectoryAsync, removeDirectoryAsync } from "@warlock.js/fs";

const target = `./snapshots/${Date.now()}`;
await ensureDirectoryAsync(target);
await copyDirectoryAsync("./dist", target);
```

### Reset a temp dir between runs

```ts
await removeDirectoryAsync("./tmp");
await ensureDirectoryAsync("./tmp");
```

### Walk every TS file under src

```ts
async function walk(dir: string): Promise<string[]> {
  const entries = await listAsync(dir);
  const results: string[] = [];

  for (const entry of entries) {
    if (await directoryExistsAsync(entry)) {
      results.push(...(await walk(entry)));
    } else if (entry.endsWith(".ts")) {
      results.push(entry);
    }
  }

  return results;
}

const tsFiles = await walk("./src");
```

## See also

- [`@warlock.js/fs/read-and-write-files/SKILL.md`](@warlock.js/fs/read-and-write-files/SKILL.md) — text / JSON file IO and existence checks
- [`@warlock.js/fs/write-atomically/SKILL.md`](@warlock.js/fs/write-atomically/SKILL.md) — atomic writes when concurrent readers might see the file mid-write
- [`@warlock.js/fs/hash-files/SKILL.md`](@warlock.js/fs/hash-files/SKILL.md) — fingerprinting

## Things NOT to do

- Don't expect `listAsync` to recurse — it's intentionally one level. Write your own walker (see above) for deep traversal.
- Don't catch `ENOENT` on `unlink` / `removeDirectory` — both functions already swallow missing-target errors. If you're catching, you're handling a real error and should re-throw.
- Don't use `renameFile` across filesystems / mounts — `EXDEV` will surface. Copy + delete for cross-device.
- Don't list a directory you're concurrently modifying — readdir snapshots aren't atomic across concurrent writes.
