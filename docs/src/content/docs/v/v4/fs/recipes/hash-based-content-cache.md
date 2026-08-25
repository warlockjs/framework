---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Hash-based content cache"
description: Skip expensive work when an input file or folder hasn't actually changed — using fs.hash.file / fs.dirs.hash and checksumMatches instead of fragile mtimes.
sidebar:
  order: 5
  label: "Hash-based content cache"
---

You've got an expensive step — transpiling, indexing, syncing — that should
re-run only when its input genuinely changes. Using `mtime` for this is
fragile: `touch` bumps the timestamp without changing a byte, and some tools
rewrite a file with identical content. Hashing the content directly is robust.

## Gate on a file's content hash

`fs.hash.file` streams the file through SHA-256 in constant memory, no matter
how large. Store the last digest in a sibling sentinel and compare:

```ts title="src/process-if-changed.ts"
import { fs } from "@warlock.js/fs";

async function processIfChanged(input: string, run: () => Promise<void>) {
  const sentinel = `${input}.digest`;
  const digest = await fs.hash.file(input);

  // Only work when the recorded digest doesn't match the current content.
  if (await fs.files.exists(sentinel) && await fs.files.checksumMatches(sentinel, digest)) {
    return;
  }

  await run();
  await fs.files.put(sentinel, digest); // record AFTER, so a crash re-runs
}
```

`checksumMatches` compares a file's stored digest against the value you pass —
it's the read-and-compare half of the gate in one call.

:::caution[Write the sentinel last]
Record the digest *after* the work succeeds. Update it first and a crash
mid-run leaves the sentinel claiming "done" when it isn't. Doing it last means
a crash re-processes on the next run — so your step must be idempotent.
:::

## Gate on a whole directory

When the input is a tree, not a single file, `fs.dirs.hash` gives you a stable
fingerprint of the entire directory — filenames and contents folded together:

```ts title="src/dir-changed.ts"
import { fs } from "@warlock.js/fs";

const digest = await fs.dirs.hash("src");
const changed = !(await fs.files.checksumMatches(".src-digest", digest));

if (changed) {
  await rebuild();
  await fs.files.put(".src-digest", digest);
}
```

The fingerprint is stable: the same tree always produces the same digest, and
reordering the walk doesn't change it.

## Content-addressed output cache

For the digest of many small inputs, fold them once with the sync `fs.hash.string`:

```ts title="src/composite-key.ts"
import { fs } from "@warlock.js/fs";

const parts = await Promise.all(inputs.map((p) => fs.hash.file(p)));
const key = fs.hash.string(parts.join("|")); // one stable composite digest
```

Key a cache file by that digest and you get free deduplication — two inputs
with identical bytes land on the same cache entry, and invalidation is implicit
(a new digest is a new path).

## When not to bother

- **Inputs that change every run** (a timestamp baked in) — hashing buys
  nothing; use mtime or strip the timestamp.
- **Pipelines faster than the hash read** — the hash is roughly disk-bound;
  below that, just always run.

## Related

- [Hash files](../guides/hash-files) — the `fs.hash.*` surface in depth.
- [The fs facade](../guides/the-fs-facade) — `checksumMatches`, `fs.dirs.hash`,
  and friends.
