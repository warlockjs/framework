# @warlock.js/fs

A pocket-sized filesystem toolkit for Node — the shape you wish `node:fs/promises` had, without pulling in `fs-extra`, `rimraf`, `mkdirp`, `write-file-atomic`, and `hasha`. Standalone: usable in any Node project, no `@warlock.js/core` required.

Every helper picks the right defaults — writes create parent directories for you, deletes swallow `ENOENT`, `atomicWriteAsync` writes-then-renames, and `hashFileAsync` streams so a 1 GB file doesn't blow the heap.

## Install

```bash
yarn add @warlock.js/fs
# or
npm install @warlock.js/fs
```

## One naming convention

That's the whole vocabulary:

- **`*Async`** returns a `Promise` — use it in server / runtime code.
- **bare name** is synchronous — use it in CLI tools, codegen, and one-shot scripts.

One canonical name per operation; no aliases to remember. If the obvious name isn't there, the operation isn't there.

## 30-second tour

```ts
import {
  putJsonFileAsync,
  getJsonFileAsync,
  atomicWriteAsync,
  ensureDirectoryAsync,
  listFilesAsync,
  hashFileAsync,
} from "@warlock.js/fs";

// Write JSON (parent dirs auto-created, pretty-printed at 2 spaces)
await putJsonFileAsync("./build/manifest.json", { version: "1.0.0" });

// Read it back, typed
const manifest = await getJsonFileAsync<{ version: string }>("./build/manifest.json");

// Atomic write — concurrent readers never see a half-written file
await atomicWriteAsync("./build/state.lock", manifest.version);

// Directory ops
await ensureDirectoryAsync("./build/cache");
const files = await listFilesAsync("./build"); // full paths, not bare names

// Content fingerprint (streaming — constant memory)
const digest = await hashFileAsync("./build/manifest.json");
```

## What you get

- **Read + write text and JSON** — `getFileAsync`, `getJsonFileAsync`, `putFileAsync`, `putJsonFileAsync`. Writes auto-create parent directories; JSON variants pretty-print at 2-space indent.
- **Atomic writes** — `atomicWriteAsync` (accepts `string | Buffer`) and `atomicWriteJsonAsync`, for files other processes read concurrently.
- **Directory management** — `ensureDirectoryAsync`, `list(Async)` / `listFiles(Async)` / `listDirectories(Async)`, `copyFile(Async)` / `copyDirectory(Async)`, `renameFile(Async)`.
- **Delete** — `unlink(Async)` and `removeDirectory(Async)`, both `ENOENT`-safe (no-op on missing targets).
- **Content hashing** — `hashFileAsync` (streaming), `hashFileSmallAsync`, `hashString`, `hashBuffer`. SHA-256 default; `sha1` / `md5` / `sha512` supported.
- **Existence + stats** — `pathExists`, `fileExists`, `directoryExists`, `lastModified`, `stats` (each with an `*Async` twin).

## Full documentation

The complete guide — getting started, essentials, task guides, recipes, and API reference — lives at **[warlock.js.org](https://warlock.js.org/v/latest/fs/)**.

## Tests

This package uses Vitest:

```bash
yarn test
```

## License

MIT
