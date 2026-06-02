---
title: "Resolve project-relative paths"
description: A relative string like "./config.json" resolves against the process working directory, not the file you wrote it in. Anchor paths reliably, then hand them to the fs helpers.
sidebar:
  order: 5
  label: "Resolve project-relative paths"
---

The bug everyone hits once: you write `getFileAsync("./data/seed.json")`, it works when you run from the project root, then it breaks the moment a script runs from a different directory or a cron job runs from `/`. Relative paths resolve against `process.cwd()` — the *working directory*, not the file the code lives in.

`@warlock.js/fs` doesn't ship a path resolver — that's `node:path`'s job. The pattern is: build an absolute path with `node:path`, then pass it to the fs helpers. Every fs function takes a plain string and is happy with absolute paths.

## Anchor to the project root

The most common need: "this path is relative to my project root, wherever the process happens to start." Pin the root once, derive everything from it:

```ts
import path from "node:path";
import { getJsonFileAsync } from "@warlock.js/fs";

// Resolve against cwd — fine when you control where the process starts
// (npm/yarn scripts always run from the package root).
const projectRoot = process.cwd();

const seedPath = path.join(projectRoot, "data", "seed.json");
const seed = await getJsonFileAsync(seedPath);
```

`path.join` also normalizes separators, so the same code works on Windows (`\`) and POSIX (`/`).

## Anchor to the current file (ESM)

When a path must resolve relative to *the module that references it* — not the working directory — derive the directory from `import.meta.url`. This is the robust choice for library code, seeders, and anything that might be invoked from elsewhere:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFileAsync } from "@warlock.js/fs";

const here = path.dirname(fileURLToPath(import.meta.url));

// Always resolves next to THIS file, regardless of cwd.
const template = await getFileAsync(path.join(here, "templates/email.html"));
```

`import.meta.url` is the ESM equivalent of CommonJS's `__dirname`. `fileURLToPath` converts the `file://` URL it gives you into a real filesystem path.

## Build a small path helper

If you resolve from the root a lot, wrap it once:

```ts
import path from "node:path";
import { putJsonFileAsync, getJsonFileAsync } from "@warlock.js/fs";

const fromRoot = (...segments: string[]) => path.join(process.cwd(), ...segments);

await putJsonFileAsync(fromRoot("storage", "state.json"), { ok: true });
const state = await getJsonFileAsync(fromRoot("storage", "state.json"));
```

Now every path in the module reads as `fromRoot("storage", "state.json")` — anchored, normalized, and obvious.

## Inside a Warlock.js app: use the path helpers

If you're in a `@warlock.js/core` project, you don't need to hand-roll the root anchor — core ships path helpers that already know your project layout (`rootPath`, `storagePath`, `publicPath`, `srcPath`, `tempPath`, `uploadsPath`, and friends). Pair them with the fs IO:

```ts
import { atomicWriteJsonAsync, getJsonFileAsync } from "@warlock.js/fs";
import { storagePath } from "@warlock.js/core";

await atomicWriteJsonAsync(storagePath("manifest.json"), manifest);
const back = await getJsonFileAsync(storagePath("manifest.json"));
```

`storagePath("manifest.json")` returns the absolute path to `manifest.json` under your app's storage directory — no `process.cwd()`, no `import.meta.url` bookkeeping. This is the idiomatic choice inside Warlock; the `node:path` patterns above are for standalone use where you don't have the framework's conventions.

## Things to avoid

- **Don't concatenate paths with `+` and `/`.** `dir + "/" + name` breaks on Windows and double-slashes when `dir` already ends in `/`. Use `path.join`.
- **Don't assume `process.cwd()` is the project root** in long-running servers spawned by a process manager — it might be `/`. Anchor to `import.meta.url` (or core's path helpers) when in doubt.
- **Don't store absolute paths in files you commit** (manifests, configs). Store paths relative to a known root and re-resolve on read.

## Related

- [Read and write files](../guides/read-and-write-files) — the IO calls
  these paths feed into.
- [Installation](../getting-started/02-installation) — pairing fs with
  `@warlock.js/core`'s path conventions.
