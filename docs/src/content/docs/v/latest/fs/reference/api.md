---
title: "API reference"
description: "The complete public surface of @warlock.js/fs — the fs facade first, then the low-level primitives and the option types."
sidebar:
  order: 1
  label: "API reference"
---

The complete public surface of `@warlock.js/fs`. It's organized the way you
should reach for it: the **[`fs` facade](#the-fs-facade)** is the main event —
the async, ergonomic surface you'll use for almost everything. The
**[low-level primitives](#low-level-primitives-sync--async)** sit underneath it
as the synchronous escape hatch and the building blocks the facade delegates to.

:::note[Naming charter]
One rule runs through the whole package: a bare name is **synchronous**, a
`*Async` name returns a **Promise**. There are no aliases — one canonical name
per operation.
:::

## The `fs` facade

```ts title="src/anything.ts"
import { fs } from "@warlock.js/fs";
```

`fs` is a single async object. Four groups hang off it — `fs.files.*` for
files, `fs.dirs.*` for directories, `fs.file(path)` / `fs.dir(path)` for lazy
handles, and `fs.hash.*` / `fs.exists()` for the odds and ends. Every method is
async by design; synchronous callers drop to the
[primitives](#low-level-primitives-sync--async).

The facade does **not** sandbox paths — containment is the storage layer's job.

### `fs.files.*` — file operations

Read:

```ts
get(path: string, options?: ReadOptions): Promise<string | Buffer>   // string; Buffer when { encoding: null }
getJson<T>(path: string, options?: ReadJsonOptions<T>): Promise<T>   // { schema } validates, { default } on ENOENT
```

Write:

```ts
put(path: string, content: string | Buffer, options?: WriteOptions): Promise<void>
putJson(path: string, value: unknown, options?: WriteJsonOptions): Promise<void>
create(path: string, content: string | Buffer, options?: WriteOptions): Promise<void>      // put with { overwrite: false }
createJson(path: string, value: unknown, options?: WriteJsonOptions): Promise<void>         // putJson with { overwrite: false }
```

Append / prepend:

```ts
append(path: string, content: string): Promise<void>
prepend(path: string, content: string): Promise<void>
appendLine(path: string, line: string): Promise<void>                 // newline-terminated
appendJsonLine(path: string, value: unknown): Promise<void>           // NDJSON — one JSON record per line
```

Transform in place:

```ts
edit(path: string, editor: (content: string) => string | Promise<string>): Promise<void>
editJson<T>(path: string, editor: (value: T) => T | Promise<T>): Promise<void>
mergeJson<T>(path: string, partial: Partial<T>, options?: MergeJsonOptions): Promise<void>  // shallow; { deep } to recurse
ensureJson<T>(path: string, fallback: T): Promise<T>                  // read, or create-and-return the fallback
```

Existence / shape / lifecycle:

```ts
exists(path: string): Promise<boolean>
isEmpty(path: string): Promise<boolean>
size(path: string): Promise<number>
ensure(path: string): Promise<void>                                   // create-if-missing — never truncates
touch(path: string): Promise<void>
remove(path: string): Promise<void>                                   // ENOENT-safe
```

Metadata:

```ts
stats(path: string): Promise<FileStats>
lastModified(path: string): Promise<Date>
hash(path: string, algorithm?: HashAlgorithm): Promise<string>
checksumMatches(path: string, expected: string, algorithm?: HashAlgorithm): Promise<boolean>
```

Move / copy / stream:

```ts
copy(from: string, to: string, options?: CopyOptions): Promise<void>
move(from: string, to: string, options?: MoveOptions): Promise<void>  // EXDEV-safe: falls back to copy+delete
readLines(path: string): AsyncIterable<string>                        // for await (const line of fs.files.readLines(p))
```

### `fs.dirs.*` — directory operations

Lifecycle:

```ts
ensure(path: string): Promise<void>                                   // recursive, idempotent
remove(path: string): Promise<void>                                   // recursive delete
empty(path: string): Promise<void>                                    // clear contents, keep the directory
```

Existence / shape:

```ts
exists(path: string): Promise<boolean>
isEmpty(path: string): Promise<boolean>
count(path: string): Promise<number>                                  // immediate children
size(path: string): Promise<number>                                   // total bytes, recursive
```

Move / copy / metadata:

```ts
copy(from: string, to: string, options?: CopyOptions): Promise<void>
move(from: string, to: string, options?: MoveOptions): Promise<void>  // EXDEV-safe
stats(path: string): Promise<FileStats>
hash(path: string, algorithm?: HashAlgorithm): Promise<string>        // stable tree fingerprint
```

Listing / walking:

```ts
list(path: string, options?: ListOptions): Promise<string[]>          // files + subdirectories
listFiles(path: string, options?: ListOptions): Promise<string[]>
listDirs(path: string, options?: ListOptions): Promise<string[]>
walk(path: string, options?: WalkOptions): AsyncIterable<WalkEntry>   // { path, name, type }
```

### `fs.file(path): File`

A lazy, immutable handle to a file path. No IO runs in the constructor, and
mutating methods (`copy` / `copyTo` / `move` / `moveTo` / `rename`) return a
**new** handle rather than changing this one.

```ts
const file = fs.file("cache/report.json");
const renamed = await file.rename("report.v2.json");   // `file` still points at report.json
```

Properties:

```ts
file.path: string
file.name: string          // "report.json"
file.basename: string      // "report"
file.extension: string     // ".json"
file.parent(): Directory
```

Methods mirror `fs.files.*` (path-bound):

```ts
get(options?) / getJson<T>(options?)
put(content, options?) / putJson(value, options?)
append(content) / prepend(content) / appendJsonLine(value)
edit(editor) / editJson(editor) / mergeJson(partial, options?)
exists() / isEmpty() / ensure() / touch() / remove()
stats() / size() / lastModified() / hash(algorithm?)
readLines(): AsyncIterable<string>
copy(to: string): Promise<File>        copyTo(dir: string): Promise<File>
move(to: string): Promise<File>        moveTo(dir: string): Promise<File>
rename(name: string): Promise<File>
```

### `fs.dir(path): Directory`

A lazy, immutable handle to a directory path. `file(...segments)` and
`dir(...segments)` compose child handles without touching disk.

```ts
const uploads = fs.dir("storage/uploads");
const avatar = uploads.dir("users").file("42", "avatar.png");   // storage/uploads/users/42/avatar.png
```

Properties:

```ts
dir.path: string
dir.name: string
dir.parent(): Directory
dir.file(...segments: string[]): File
dir.dir(...segments: string[]): Directory
```

Methods mirror `fs.dirs.*` (path-bound):

```ts
ensure() / remove() / empty()
exists() / isEmpty() / count()
stats() / size() / hash(algorithm?)
list(options?) / listFiles(options?): Promise<File[]>   listDirs(options?): Promise<Directory[]>
walk(options?): AsyncIterable<WalkEntry>
copy(to: string): Promise<Directory>   move(to: string): Promise<Directory>
```

### `fs.exists` · `fs.hash.*`

```ts
fs.exists(path: string): Promise<boolean>              // type-agnostic — file OR directory

fs.hash.string(content: string, algorithm?): string    // sync — pure, in-memory
fs.hash.buffer(bytes: Buffer | Uint8Array, algorithm?): string   // sync
fs.hash.file(path: string, algorithm?): Promise<string>          // async — reads from disk
fs.hash.dir(path: string, algorithm?): Promise<string>           // async — stable tree fingerprint
```

All hashing defaults to `sha256`.

### Option & result types

Every option bag is a plain object, exported from the package root.

```ts
type ReadOptions = { encoding?: BufferEncoding | null };   // encoding: null → Buffer

type ReadJsonOptions<T = unknown> = {
  schema?: StandardSchemaV1<T>;   // validate the parsed value
  default?: T;                    // returned on ENOENT instead of throwing
};

type WriteOptions = {
  encoding?: BufferEncoding;      // string writes; default "utf-8"
  atomic?: boolean;               // temp file + rename
  ensureDir?: boolean;            // create parents; default true
  overwrite?: boolean;            // false → throw if target exists; default true
};

type WriteJsonOptions = WriteOptions & { indent?: number };        // default 2
type MergeJsonOptions = WriteJsonOptions & { deep?: boolean };     // shallow by default

type CopyOptions = {
  overwrite?: boolean;            // default true
  errorOnExist?: boolean;         // default false
  dereference?: boolean;          // follow symlinks; default false
};

type MoveOptions = { overwrite?: boolean; ensureDir?: boolean };   // ensureDir default true

type ListOptions = { recursive?: boolean };
type WalkOptions = { recursive?: boolean; followSymlinks?: boolean };
```

```ts
type WalkEntry = {
  path: string;
  name: string;
  type: "file" | "directory";     // discriminated by `type`, never `kind`
};

type FileStats = {
  path: string;
  name: string;
  size: number;
  type: "file" | "directory";
  lastModified: Date;
  raw: import("node:fs").Stats;   // escape hatch to the raw stats
};
```

Schema validation on JSON reads is validator-agnostic — `@warlock.js/fs` ships
with **zero dependencies**, so it speaks the neutral
[Standard Schema](https://standardschema.dev) contract instead of importing any
validator.

```ts
interface StandardSchemaV1<Output = unknown> { readonly "~standard": { /* version, vendor, validate */ } }

class JsonSchemaValidationError extends Error {
  readonly path: string;
  readonly issues: ReadonlyArray<StandardSchemaIssue>;
}
```

Any Standard-Schema-compliant validator — `@warlock.js/seal`, zod, valibot —
can be passed as `getJson`'s `schema`. On failure it throws
`JsonSchemaValidationError` carrying the raw `issues`.

## Low-level primitives (sync + `*Async`)

The flat functions the facade is built on. Reach for these when you need a
**synchronous** call (the facade is async-only) or want the thinnest possible
wrapper over `node:fs`. Each comes in a `bare` (sync) and `*Async` flavor.

### Read / write / JSON

```ts
getFileAsync(path: string): Promise<string>          getFile(path: string): string
getJsonFileAsync<T>(path: string): Promise<T>        getJsonFile<T>(path: string): T
putFileAsync(filePath: string, content: string): Promise<void>       putFile(filePath, content): void
putJsonFileAsync(filePath: string, value: unknown): Promise<void>    putJsonFile(filePath, value): void
```

`put*` create missing parents, overwrite existing files, and are **text-only**
— for binary or crash-safe writes use the atomic writers.

### Atomic write (async only)

```ts
atomicWriteAsync(filePath: string, content: string | Buffer): Promise<void>   // temp file + rename
atomicWriteJsonAsync(filePath: string, value: unknown): Promise<void>         // pretty-printed, 2-space
```

### Directories

```ts
ensureDirectoryAsync(path: string): Promise<void>    ensureDirectory(path: string): void    // recursive, idempotent
removeDirectoryAsync(path: string): Promise<void>    removeDirectory(path: string): void    // recursive, ENOENT-safe
```

### Listing

```ts
listAsync(dir: string): Promise<string[]>            list(dir: string): string[]            // files + subdirs
listFilesAsync(dir: string): Promise<string[]>       listFiles(dir: string): string[]
listDirectoriesAsync(dir: string): Promise<string[]> listDirectories(dir: string): string[]
```

All return full paths joined to the directory.

### Copy / rename

```ts
copyFileAsync(source, destination): Promise<void>        copyFile(source, destination): void        // creates dest parent
copyDirectoryAsync(source, destination): Promise<void>   copyDirectory(source, destination): void   // recursive
renameFileAsync(from, to): Promise<void>                 renameFile(from, to): void                 // no auto-parent; EXDEV on cross-mount
```

### Delete

```ts
unlinkAsync(path: string): Promise<void>             unlink(path: string): void             // single file, ENOENT-safe
```

(Recursive deletes live on `removeDirectory*` above.)

### Stats

```ts
lastModifiedAsync(path: string): Promise<Date>       lastModified(path: string): Date       // mtime
statsAsync(path: string): Promise<import("node:fs").Stats>    stats(path): import("node:fs").Stats
```

### Existence

```ts
pathExistsAsync(path: string): Promise<boolean>      pathExists(path: string): boolean      // file OR directory
fileExistsAsync(path: string): Promise<boolean>      fileExists(path: string): boolean      // file only (follows symlinks)
directoryExistsAsync(path: string): Promise<boolean> directoryExists(path: string): boolean // directory only
```

### Hashing

```ts
type HashAlgorithm = "sha256" | "sha1" | "md5" | "sha512";   // default "sha256"

hashFileAsync(path: string, algorithm?: HashAlgorithm): Promise<string>       // streaming — constant memory
hashFileSmallAsync(path: string, algorithm?: HashAlgorithm): Promise<string>  // one-shot; small files only
hashFile(path: string, algorithm?: HashAlgorithm): string                     // sync; small files only
hashString(content: string, algorithm?: HashAlgorithm): string                // in-memory
hashBuffer(content: Buffer | Uint8Array, algorithm?: HashAlgorithm): string    // in-memory
```

## See also

- [The fs facade](../guides/the-fs-facade) — why `fs.*` is the way in.
- [Read and write files](../guides/read-and-write-files) — the IO walkthrough.
- [Write atomically](../guides/write-atomically) — the atomic-write deep dive.
- [Manage directories](../guides/manage-directories) — directory operations end to end.
- [Hash files](../guides/hash-files) — hashing strings, buffers, files, and trees.

Source: [`@warlock.js/fs/src/`](https://github.com/warlockjs/core/tree/main/%40warlock.js/fs/src)
