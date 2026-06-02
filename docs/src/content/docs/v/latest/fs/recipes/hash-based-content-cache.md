---
title: "Hash-based content cache"
description: Skip expensive work when an input file hasn't actually changed — using content hashes instead of mtimes. Robust against touch-without-edit.
sidebar:
  order: 2
  label: "Hash-based content cache"
---

The pattern: an expensive pipeline (transcoding, transpiling, syncing,
indexing) that should re-run only when its input actually changes. Using
`mtime` for this is fragile — `touch` updates the mtime without changing
content, and some tools rewrite a file with identical bytes. Hashing the
content directly is robust.

## The recipe

```ts
import {
  hashFileAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
} from "@warlock.js/fs";

async function processIfChanged(inputPath: string, processor: () => Promise<void>) {
  const sentinelPath = `${inputPath}.digest`;

  const currentDigest = await hashFileAsync(inputPath);
  const previousDigest = (await fileExistsAsync(sentinelPath))
    ? await getFileAsync(sentinelPath)
    : null;

  if (currentDigest === previousDigest) {
    return { skipped: true, digest: currentDigest };
  }

  await processor();
  await putFileAsync(sentinelPath, currentDigest);

  return { skipped: false, digest: currentDigest };
}

const result = await processIfChanged("./data/source.json", async () => {
  await rebuildSearchIndex();
});

if (result.skipped) {
  console.log(`Skipped — input unchanged (${result.digest.slice(0, 8)})`);
}
```

## Why each piece

**Sibling sentinel file (`${path}.digest`).** Stores the digest of the
last successfully-processed version. Co-located with the input so it
travels with the data — if you copy `./data/` to another machine, the
cache state goes with it.

**`hashFileAsync`.** Streams the input file through SHA-256. Constant
memory regardless of file size. Stable: the same content always produces
the same digest.

**Compare strings.** A digest comparison is cheap. Even on a 1 GB input,
the only "work" you do on a skip is one stream-hash read — typically
disk-bound, no CPU.

**Update sentinel after processing.** Critically, **after**. If you
update it before, a crash mid-processing leaves the sentinel claiming
"done" when it isn't. Doing it after means a crash leaves you in the same
state as if you'd never tried — next run sees a digest mismatch and
re-processes. Idempotent processors are required for this to be safe.

## Variation: many inputs, one output

Often you've got multiple inputs feeding one output, and want to skip
work if *any* of them haven't changed:

```ts
import { hashFileAsync } from "@warlock.js/fs";

async function combinedDigest(paths: string[]): Promise<string> {
  const digests = await Promise.all(paths.map((path) => hashFileAsync(path)));
  return digests.join("|");   // order-sensitive — fine if `paths` is stable
}

async function buildIfChanged() {
  const inputs = ["./src/a.ts", "./src/b.ts", "./config.json"];

  const current = await combinedDigest(inputs);
  const previous = (await fileExistsAsync("./.build-digest"))
    ? await getFileAsync("./.build-digest")
    : null;

  if (current === previous) return;

  await runBuild();
  await putFileAsync("./.build-digest", current);
}
```

The `join("|")` produces a stable composite key. For a tidier digest of
digests, run the joined string through `hashString`:

```ts
import { hashString } from "@warlock.js/fs";

const composite = hashString(digests.join("|"));
```

## Variation: cache the output too, not just the gate

If your pipeline produces an output you want to keep around (a parsed
AST, a compiled artifact), store it under a content-addressed path:

```ts
import { hashFileAsync, fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";

async function compileWithCache(inputPath: string): Promise<string> {
  const digest = await hashFileAsync(inputPath);
  const cachePath = `./.cache/compiled/${digest}.js`;

  if (await fileExistsAsync(cachePath)) {
    return getFileAsync(cachePath);   // cache hit
  }

  const compiled = await compile(await getFileAsync(inputPath));
  await putFileAsync(cachePath, compiled);

  return compiled;
}
```

Content-addressed paths give you free cache deduplication — two inputs
with identical bytes share a cache entry. And cache invalidation is
implicit: you never delete the cache, just write a new path when the
content changes. Garbage-collect old entries on a schedule by listing
`./.cache/compiled/` and dropping anything older than N days.

## When NOT to use this

- **Inputs that change every run no matter what.** Hashing buys nothing
  if the file has a timestamp in it. Use mtime, or remove the timestamp
  from the input.
- **Very small, very fast pipelines.** If the pipeline takes less time
  than the hash read does, you're losing the trade. Hash is roughly
  disk-IO bound (~500 MB/s on a modern SSD); below that pipeline time,
  just always run.
- **Streaming inputs.** Hash needs the whole file. For an unbounded
  stream, use mtime or input checksums computed incrementally.

## Related

- [Hash files](../guides/hash-files) — the hashing surface in depth.
- [Read and write files](../guides/read-and-write-files) — the
  `getFile` / `putFile` calls used here.
