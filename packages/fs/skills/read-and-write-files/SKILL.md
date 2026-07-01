---
name: read-and-write-files
description: 'Read and write files — getFile / getFileAsync / getJsonFile / putFile (auto-creates parent dirs), plus pathExists / fileExists / directoryExists / lastModified / stats. Triggers: `getFileAsync`, `getJsonFileAsync`, `putFileAsync`, `putJsonFileAsync`, `pathExists`, `fileExists`, `lastModifiedAsync`, `statsAsync`; "read a text file", "write a JSON file", "check if file exists"; typical import `import { getFileAsync, putJsonFileAsync, fileExists } from "@warlock.js/fs"`. Skip: atomic writes — `@warlock.js/fs/write-atomically/SKILL.md`; dirs + copy + delete — `@warlock.js/fs/manage-directories/SKILL.md`; hashing — `@warlock.js/fs/hash-files/SKILL.md`; competing libs `fs-extra`, `jsonfile`, `graceful-fs`; native `node:fs/promises`.'
---

# Read and write files

Thin, opinionated wrapper around `node:fs` and `node:fs/promises`. Two-suffix convention: `*Async` returns a Promise, the bare name is synchronous. No `Sync` suffix on the sync calls — that would mean you have to remember the inverse.

## Install

```bash
yarn add @warlock.js/fs
```

## Read

```ts
import { getFile, getFileAsync, getJsonFile, getJsonFileAsync } from "@warlock.js/fs";

// UTF-8 text
const config = await getFileAsync("./config.toml");
const sync = getFile("./config.toml");

// Parsed JSON, generic-typed
type Manifest = { version: string; files: string[] };
const manifest = await getJsonFileAsync<Manifest>("./manifest.json");
```

Behavior:
- All read functions return UTF-8 strings (or parsed JSON in the `JsonFile` variants).
- Throws if the file doesn't exist (`ENOENT`) or JSON is invalid. Don't try/catch for "file might not be there" — use `pathExists` / `fileExists` below.

## Write

```ts
import { putFile, putFileAsync, putJsonFile, putJsonFileAsync } from "@warlock.js/fs";

await putFileAsync("./dist/output.txt", "hello world");
await putJsonFileAsync("./dist/manifest.json", { version: "1.0.0" });
```

Behavior:
- Parent directories are created recursively — no need to `ensureDirectory` first.
- JSON variants pretty-print at 2-space indent. For minified output, stringify yourself and use the plain `putFile`.
- Overwrites existing files. For atomic write semantics (readers never see a half-written file), use [`write-atomically`](@warlock.js/fs/write-atomically/SKILL.md).

## Existence checks

Three variants — pick the strictest one that fits the question you're asking. Each has an async (`*Async`) and a sync form:

```ts
import { pathExistsAsync, fileExistsAsync, directoryExistsAsync } from "@warlock.js/fs";

await pathExistsAsync("./anything");      // true if file OR directory
await fileExistsAsync("./config.toml");   // true ONLY if a regular file
await directoryExistsAsync("./dist");     // true ONLY if a directory

// sync counterparts, same semantics
import { pathExists, fileExists, directoryExists } from "@warlock.js/fs";
```

Match the check to the target: gate a directory operation (listing, walking) on `directoryExistsAsync`, not `fileExistsAsync` — the latter resolves `false` for a folder and would skip it entirely. Reach for `pathExistsAsync` only when the type genuinely doesn't matter.

`fileExists*` and `directoryExists*` follow symlinks (they're `stat`-based, not `lstat`). Use them to gate creation logic instead of try-catching a `read`:

```ts
// ✅ Clearer intent
if (!(await fileExists("./config.toml"))) {
  await putFileAsync("./config.toml", defaultConfig);
}

// ❌ Don't catch ENOENT as control flow
try {
  await getFileAsync("./config.toml");
} catch {
  await putFileAsync("./config.toml", defaultConfig);
}
```

## Metadata

```ts
import { lastModified, stats } from "@warlock.js/fs";

const mtime = await lastModifiedAsync("./bundle.js");      // Date
const all = await statsAsync("./bundle.js");                // fs.Stats
```

`lastModified` is sugar around `stat().mtime`. Reach for `stats` when you need size, mode bits, or other fields.

## When to pick sync vs async

- **Async by default** — everything in a Warlock server / app runtime should be async. The event loop stays free.
- **Sync only in CLI tools and config-loaders that run once** — startup config, code generators, scripts. The blocking call is fine when there's nothing else to do.

## See also

- [`@warlock.js/fs/manage-directories/SKILL.md`](@warlock.js/fs/manage-directories/SKILL.md) — directory listing, copying, removing, renaming
- [`@warlock.js/fs/write-atomically/SKILL.md`](@warlock.js/fs/write-atomically/SKILL.md) — safe writes for files that other readers depend on
- [`@warlock.js/fs/hash-files/SKILL.md`](@warlock.js/fs/hash-files/SKILL.md) — fingerprinting files

## Things NOT to do

- Don't call `putFileAsync` on a file that other processes / readers consume in parallel — use `atomicWriteAsync` from [`write-atomically`](@warlock.js/fs/write-atomically/SKILL.md) instead.
- Don't rely on `try { getFileAsync(...) } catch` for existence checks — `fileExists` is faster and reads better.
- Don't pass binary content to `putFile` / `putFileAsync` as a `Buffer` directly — these are text-only (UTF-8). For binaries, use `node:fs/promises`'s `writeFile` directly, or use `atomicWriteAsync` (which accepts `string | Buffer`).
