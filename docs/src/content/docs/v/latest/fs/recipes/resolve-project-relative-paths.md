---
title: "Resolve project-relative paths"
description: Anchor a directory once with fs.dir(root), then build File/Directory handles with .file(...segs) and .dir(...segs) — normalized, cwd-independent paths that carry their own IO.
sidebar:
  order: 6
  label: "Resolve project-relative paths"
---

The bug everyone hits once: `fs.files.get("./data/seed.json")` works from the
project root, then breaks the moment a script runs from a different directory
or a cron job runs from `/`. Relative strings resolve against `process.cwd()` —
the *working directory*, not the file the code lives in.

The facade's fix: anchor a `Directory` handle once, then let it build child
paths for you.

## Anchor once, derive everything

`fs.dir(root)` gives you a handle. Its `.file(...segments)` and
`.dir(...segments)` build child handles that carry the fully-resolved path —
and the IO methods with them:

```ts title="src/paths.ts"
import { fs } from "@warlock.js/fs";

const root = fs.dir(process.cwd());

const seed = await root.file("data", "seed.json").getJson();
await root.dir("storage").file("state.json").putJson({ ok: true });
```

Segments are joined with `node:path`, so the same code normalizes separators on
Windows (`\`) and POSIX (`/`) — no hand-concatenating with `+` and `/`.

## Anchor to the current module (ESM)

When a path must resolve next to *the module that references it* — a seeder, a
template loader — anchor the handle to the file's own directory instead of the
cwd:

```ts title="src/template-loader.ts"
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fs } from "@warlock.js/fs";

const here = fs.dir(path.dirname(fileURLToPath(import.meta.url)));

// Resolves next to THIS file regardless of where the process started.
const html = await here.file("templates", "email.html").get();
```

## Handles compose

Because a handle is just a stable reference to a path (zero IO until you call a
method), you can pass the anchored directory around and branch off it wherever
you need:

```ts title="src/branch.ts"
const storage = fs.dir(process.cwd()).dir("storage");

await storage.dir("uploads").ensure();
const manifest = storage.file("manifest.json");
await manifest.putJson({ version: 1 });
```

:::note[fs does not sandbox — storage does]
`fs.dir(root).file("..", "..", "etc/passwd")` will happily resolve outside
`root`. The facade builds and normalizes paths; it does **not** contain them.
If you're resolving *untrusted* segments (an upload name, a user-supplied key),
put your storage layer in front — sandboxing a base directory is its job, not
the fs facade's.
:::

## Inside a Warlock.js app

In a `@warlock.js/core` project you don't hand-roll the root at all — core
ships path helpers (`rootPath`, `storagePath`, `publicPath`, `uploadsPath`, …)
that already know your layout. Feed one straight into a handle:

```ts title="src/app.ts"
import { fs } from "@warlock.js/fs";
import { storagePath } from "@warlock.js/core";

await fs.file(storagePath("manifest.json")).putJson(manifest);
```

## Related

- [Work with handles](../guides/work-with-handles) — the full `File` /
  `Directory` handle API.
- [Copy files and folders](./copy-files-and-folders) — `copyTo` / `moveTo`
  take these directory handles.
