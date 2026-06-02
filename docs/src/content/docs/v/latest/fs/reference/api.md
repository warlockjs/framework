---
title: "API"
description: Complete export list — every function and type @warlock.js/fs ships, grouped by module. Signatures + one-line example each.
sidebar:
  order: 1
  label: "API"
---

The complete public surface of `@warlock.js/fs`, grouped by module. Every
export. Same naming convention throughout: `*Async` returns a `Promise`,
the bare name is synchronous.

## Read

### `getFileAsync(path: string): Promise<string>`

Read a file as UTF-8 text. Throws `ENOENT` if missing.

```ts
const config = await getFileAsync("./config.toml");
```

### `getFile(path: string): string`

Sync version of `getFileAsync`.

### `getJsonFileAsync<T = unknown>(path: string): Promise<T>`

Read and `JSON.parse` a file. Throws `ENOENT` if missing, `SyntaxError`
if invalid JSON.

```ts
const manifest = await getJsonFileAsync<Manifest>("./manifest.json");
```

### `getJsonFile<T = unknown>(path: string): T`

Sync version of `getJsonFileAsync`.

## Write

### `putFileAsync(filePath: string, content: string): Promise<void>`

Write a UTF-8 string to disk. Creates missing parent directories.
Overwrites existing files. **Text only** — for binary, use
`atomicWriteAsync` or drop to `node:fs/promises`.

```ts
await putFileAsync("./out/log.txt", "hello\n");
```

### `putFile(filePath: string, content: string): void`

Sync version of `putFileAsync`.

### `putJsonFileAsync(filePath: string, value: unknown): Promise<void>`

Write a JSON-serializable value as pretty-printed JSON (2-space indent).

```ts
await putJsonFileAsync("./out/manifest.json", { version: "1.0.0" });
```

### `putJsonFile(filePath: string, value: unknown): void`

Sync version of `putJsonFileAsync`.

## Atomic write

### `atomicWriteAsync(filePath: string, content: string | Buffer): Promise<void>`

Write a file atomically — writes to a uniquely-named sibling temp file
then renames onto the target. Readers see old or new content, never a
half-written file. Creates missing parent directories. Accepts `string`
or `Buffer`. Async only.

```ts
await atomicWriteAsync("./config.toml", configString);
await atomicWriteAsync("./binary.bin", Buffer.from([0x01, 0x02]));
```

### `atomicWriteJsonAsync(filePath: string, value: unknown): Promise<void>`

Atomic write convenience for JSON values. Pretty-prints at 2-space
indent.

```ts
await atomicWriteJsonAsync("./manifest.json", { version: "1.0.0" });
```

## Directories

### `ensureDirectoryAsync(path: string): Promise<void>`

Create a directory recursively. Idempotent — no error if it already
exists.

```ts
await ensureDirectoryAsync("./dist/cache/v2");
```

### `ensureDirectory(path: string): void`

Sync version.

### `removeDirectoryAsync(path: string): Promise<void>`

Recursively delete a directory and its contents. No error if missing
(uses `rm({ recursive: true, force: true })`).

```ts
await removeDirectoryAsync("./dist");
```

### `removeDirectory(path: string): void`

Sync version.

## Listing

### `listAsync(directoryPath: string): Promise<string[]>`

List immediate children (files + subdirectories) as full paths joined to
the directory.

```ts
const entries = await listAsync("./src");
// → ["./src/a.ts", "./src/components", ...]
```

### `list(directoryPath: string): string[]`

Sync version.

### `listFilesAsync(directoryPath: string): Promise<string[]>`

List only regular files in a directory (not subdirectories). Full paths.

```ts
const files = await listFilesAsync("./src");
```

### `listFiles(directoryPath: string): string[]`

Sync version.

### `listDirectoriesAsync(directoryPath: string): Promise<string[]>`

List only subdirectories. Full paths.

```ts
const dirs = await listDirectoriesAsync("./src");
```

### `listDirectories(directoryPath: string): string[]`

Sync version.

## Copy

### `copyFileAsync(source: string, destination: string): Promise<void>`

Copy a single file. Creates the destination's parent directory if missing.

```ts
await copyFileAsync("./src.txt", "./dst/copy.txt");
```

### `copyFile(source: string, destination: string): void`

Sync version.

### `copyDirectoryAsync(source: string, destination: string): Promise<void>`

Recursively copy a directory. Overwrites existing files at the
destination.

```ts
await copyDirectoryAsync("./public", "./dist/public");
```

### `copyDirectory(source: string, destination: string): void`

Sync version.

## Rename

### `renameFileAsync(from: string, to: string): Promise<void>`

Rename / move a file or directory. Does **not** auto-create the
destination's parent — use `ensureDirectoryAsync` first if needed. Fails
with `EXDEV` for cross-mount moves.

```ts
await renameFileAsync("./tmp/foo.txt", "./final/foo.txt");
```

### `renameFile(from: string, to: string): void`

Sync version.

## Delete

### `unlinkAsync(path: string): Promise<void>`

Delete a single file. ENOENT-safe (no error if missing).

```ts
await unlinkAsync("./obsolete.txt");
```

### `unlink(path: string): void`

Sync version.

(`removeDirectoryAsync` / `removeDirectory` cover recursive deletes — see
[Directories](#directories).)

## Existence

### `pathExistsAsync(path: string): Promise<boolean>`

True if the path exists, regardless of whether it's a file or directory.

```ts
if (await pathExistsAsync("./anything")) { /* ... */ }
```

### `pathExists(path: string): boolean`

Sync version.

### `fileExistsAsync(path: string): Promise<boolean>`

True only if the path exists AND is a regular file. Follows symlinks
(uses `stat`, not `lstat`).

```ts
if (await fileExistsAsync("./config.toml")) { /* ... */ }
```

### `fileExists(path: string): boolean`

Sync version.

### `directoryExistsAsync(path: string): Promise<boolean>`

True only if the path exists AND is a directory.

```ts
if (await directoryExistsAsync("./dist")) { /* ... */ }
```

### `directoryExists(path: string): boolean`

Sync version.

## Stats

### `lastModifiedAsync(path: string): Promise<Date>`

The path's `mtime` as a `Date`. Throws `ENOENT` if missing.

```ts
const mtime = await lastModifiedAsync("./bundle.js");
```

### `lastModified(path: string): Date`

Sync version.

### `statsAsync(path: string): Promise<fs.Stats>`

Raw `fs.Stats` for the path — size, mode, atime, etc.

```ts
const stats = await statsAsync("./bundle.js");
console.log(stats.size, stats.mode);
```

### `stats(path: string): fs.Stats`

Sync version.

## Hashing

### `type HashAlgorithm = "sha256" | "sha1" | "md5" | "sha512"`

The four supported hash algorithms. Default for every hash function is
`"sha256"`.

### `hashFileAsync(path: string, algorithm?: HashAlgorithm): Promise<string>`

Streaming hex digest of a file's contents. Constant memory regardless of
file size — safe for large files.

```ts
const fingerprint = await hashFileAsync("./bundle.js");
const md5 = await hashFileAsync("./bundle.js", "md5");
```

### `hashFile(path: string, algorithm?: HashAlgorithm): string`

Sync — reads the whole file into memory before hashing. Use only on small
files.

### `hashFileSmallAsync(path: string, algorithm?: HashAlgorithm): Promise<string>`

Async, one-shot — reads the file in a single `readFile` then hashes.
Slightly faster than `hashFileAsync` for files under ~1 MB. Don't use on
large files (loads the whole thing into memory).

```ts
const digest = await hashFileSmallAsync("./icon.svg");
```

### `hashString(content: string, algorithm?: HashAlgorithm): string`

Hex digest of an in-memory string.

```ts
const key = hashString(JSON.stringify(input));
```

### `hashBuffer(content: Buffer | Uint8Array, algorithm?: HashAlgorithm): string`

Hex digest of an in-memory `Buffer` or `Uint8Array`.

```ts
const digest = hashBuffer(Buffer.from([0x01, 0x02, 0x03]));
```

## See also

- [The helpers](../essentials/01-the-helpers) — guided tour of the surface.
- [Read and write files](../guides/read-and-write-files) — IO walkthrough.
- [Write atomically](../guides/write-atomically) — atomic write deep-dive.
- [Hash files](../guides/hash-files) — hashing walkthrough.
- [Manage directories](../guides/manage-directories) — directory ops.

Source: [`@warlock.js/fs/src/`](https://github.com/warlockjs/core/tree/main/%40warlock.js/fs/src)
