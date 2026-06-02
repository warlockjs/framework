---
title: "Read and write files"
description: Read text and JSON, write text and JSON with auto-parent-dirs, check existence, get metadata — the everyday file IO toolkit.
sidebar:
  order: 1
  label: "Read and write files"
---

The bread-and-butter helpers. Every Node project ends up doing some flavor
of "read a config file, write a build artifact, check if a state file
exists". This guide covers all of that.

## Reading text

```ts
import { getFileAsync, getFile } from "@warlock.js/fs";

const config = await getFileAsync("./config.toml");   // string, UTF-8
const sync = getFile("./config.toml");                 // string
```

Both always read as UTF-8 — there's no encoding parameter. If you need
binary, drop down to `node:fs/promises`'s `readFile`. The helper exists to
make the common case (text) one call.

**Errors.** Throws `ENOENT` if the file doesn't exist. Don't try/catch
that — use [existence checks](#existence-checks) to gate reads instead.

## Reading JSON

```ts
import { getJsonFileAsync, getJsonFile } from "@warlock.js/fs";

type Manifest = { version: string; files: string[] };

const manifest = await getJsonFileAsync<Manifest>("./manifest.json");
//    ^? Manifest

const inline = getJsonFile<Manifest>("./manifest.json");
```

The generic is a type assertion — `JSON.parse` returns whatever's in the
file regardless of what you typed. If you can't trust the file, run the
result through a schema validator (`@warlock.js/seal` is one) before using
it.

**Errors.** Throws if the file is missing (`ENOENT`) or contains invalid
JSON (`SyntaxError`).

## Writing text

```ts
import { putFileAsync, putFile } from "@warlock.js/fs";

await putFileAsync("./out/log.txt", "hello world\n");
putFile("./out/log.txt", "hello world\n");
```

Both:

- Create parent directories recursively — you don't need to
  `ensureDirectory` first.
- Write UTF-8.
- Overwrite the file if it exists.

The content parameter is `string` only. For binary writes, either use
[`atomicWriteAsync`](./write-atomically) (which accepts `string | Buffer`)
or drop to `node:fs/promises`'s `writeFile`.

## Writing JSON

```ts
import { putJsonFileAsync, putJsonFile } from "@warlock.js/fs";

await putJsonFileAsync("./out/manifest.json", {
  version: "1.0.0",
  files: ["bundle.js", "styles.css"],
});
```

Same auto-parent-dirs and overwrite semantics. The serialization is
pretty-printed at 2-space indent. For minified JSON, stringify yourself
and use `putFileAsync`:

```ts
import { putFileAsync } from "@warlock.js/fs";

await putFileAsync("./out/min.json", JSON.stringify(value));
```

## When you want atomic semantics

`putFileAsync` writes directly. If a concurrent reader picks up the file
mid-write, they see truncated content. For files that other tools or
processes read (config files watched by a dev server, manifests consumed
by a deploy script), use [`atomicWriteAsync`](./write-atomically) instead.

The rule of thumb is in [Atomic vs non-atomic](../essentials/02-atomic-vs-non-atomic);
the short version: read by anyone but you, or has to survive a crash
mid-write → atomic.

## Existence checks

Three variants, all `*Async` + sync. Pick the strictest one that fits your
question:

```ts
import { pathExistsAsync, fileExistsAsync, directoryExistsAsync } from "@warlock.js/fs";

await pathExistsAsync("./anything");        // true if file OR directory
await fileExistsAsync("./config.toml");      // true only if regular file
await directoryExistsAsync("./dist");         // true only if directory
```

`fileExistsAsync` and `directoryExistsAsync` follow symlinks (they use
`stat`, not `lstat`). If you need to distinguish "symlink to a file" from
"actual file", drop to `lstat` directly.

The idiomatic use: gate a creation step instead of catching `ENOENT`:

```ts
// ✅ Clear intent
if (!(await fileExistsAsync("./config.toml"))) {
  await putFileAsync("./config.toml", defaultConfig);
}

// ❌ Catching ENOENT as control flow is uglier and slower
try {
  await getFileAsync("./config.toml");
} catch {
  await putFileAsync("./config.toml", defaultConfig);
}
```

## Metadata

```ts
import { lastModifiedAsync, statsAsync } from "@warlock.js/fs";

const mtime = await lastModifiedAsync("./bundle.js");   // Date
const all = await statsAsync("./bundle.js");             // fs.Stats
```

`lastModifiedAsync` is sugar around `stat().mtime`. Reach for `statsAsync`
when you need size, mode bits, or the full `fs.Stats` object. Both throw
`ENOENT` if the path doesn't exist — guard with `pathExistsAsync` if the
path might be missing.

## A few common shapes

### Read-or-default config

```ts
import { getJsonFileAsync, fileExistsAsync } from "@warlock.js/fs";

async function loadConfig(): Promise<Config> {
  if (await fileExistsAsync("./config.json")) {
    return getJsonFileAsync<Config>("./config.json");
  }

  return defaultConfig;
}
```

### Read a JSON file, modify, write it back

```ts
import { getJsonFileAsync, putJsonFileAsync } from "@warlock.js/fs";

const state = await getJsonFileAsync<State>("./state.json");
state.counter += 1;
await putJsonFileAsync("./state.json", state);
```

If two callers run this in parallel, they can lose updates — `putJsonFile`
isn't a CAS operation. For shared state across processes, use
[`atomicWriteJsonAsync`](./write-atomically) and consider a distributed
lock.

### Cache "last seen" mtime to skip work

```ts
import { lastModifiedAsync, getJsonFileAsync, putJsonFileAsync } from "@warlock.js/fs";

const current = (await lastModifiedAsync("./input.json")).toISOString();
const cache = await getJsonFileAsync<{ mtime: string }>("./.cache.json").catch(() => ({ mtime: "" }));

if (cache.mtime === current) {
  return;
}

await runPipeline();
await putJsonFileAsync("./.cache.json", { mtime: current });
```

For content-based invalidation (more robust than mtime), use
[`hashFileAsync`](./hash-files) instead.

## Related

- [Write atomically](./write-atomically) — for files other processes read.
- [Manage directories](./manage-directories) — list, copy, delete.
- [Hash files](./hash-files) — fingerprint for cache invalidation.
- [Reference / API](../reference/api) — full signatures.
