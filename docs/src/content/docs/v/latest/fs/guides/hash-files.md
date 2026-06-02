---
title: "Hash files"
description: Compute hex digests of files, strings, and buffers — SHA-256 by default. Streaming for large files, one-shot for small. Cache invalidation, ETags, integrity checks.
sidebar:
  order: 4
  label: "Hash files"
---

Hex-digest helpers backed by `node:crypto`. The package picks the right
strategy for the input — streaming for files (memory stays flat),
one-shot for in-memory content.

## Algorithms

```ts
type HashAlgorithm = "sha256" | "sha1" | "md5" | "sha512";
```

Default is `"sha256"`. That's the right pick for:

- Cache invalidation keys.
- Content-addressable storage paths.
- ETag generation.
- Build-artifact fingerprinting.
- Integrity verification against a known-good digest.

Reach for `"md5"` only when you're matching an external system that
requires it (legacy ETags, some CDN APIs). It's fine for non-adversarial
fingerprinting, broken for security.

Reach for `"sha512"` when you want longer digests for collision resistance
at scale (millions of artifacts). The CPU cost is real but not crazy.

`"sha1"` exists for compatibility (Git, some legacy webhook signatures).
Don't pick it for new code.

## Hash a file

```ts
import { hashFileAsync, hashFile } from "@warlock.js/fs";

// Streaming — constant memory regardless of file size
const fingerprint = await hashFileAsync("./bundle.js");
// → "8a7d3e2f9b4c..." (64 hex chars for SHA-256)

// Sync, custom algorithm
const md5 = hashFile("./small.txt", "md5");
```

`hashFileAsync` reads the file as a stream and feeds chunks into the
hash. A 1 GB file goes through with a flat memory profile — no risk of
heap explosion. This is the default you want for any file of unknown
size.

`hashFile` (sync) reads the whole file into memory before hashing.
Acceptable for tiny files in CLI scripts; bad idea for anything big.

## Hash a small file in one shot

```ts
import { hashFileSmallAsync } from "@warlock.js/fs";

const digest = await hashFileSmallAsync("./icon.svg");
```

`hashFileSmallAsync` does a single `readFile` then hashes. Slightly
faster than the streaming variant for files under ~1 MB — fewer event-loop
turns, no chunk overhead. **Don't** use it on large files; you'll load
the whole thing into memory.

| You have... | Reach for |
| --- | --- |
| File, async, unknown size | `hashFileAsync` |
| Small file (< ~1 MB), async, want speed | `hashFileSmallAsync` |
| File, sync (CLI / config loader) | `hashFile` |
| In-memory string | `hashString` |
| In-memory `Buffer` / `Uint8Array` | `hashBuffer` |

## Hash in-memory content

```ts
import { hashString, hashBuffer } from "@warlock.js/fs";

const fromString = hashString("hello world");
const fromBuffer = hashBuffer(Buffer.from([0x01, 0x02, 0x03]));
const fromUint8 = hashBuffer(new Uint8Array([1, 2, 3]));
```

Both sync, both default to SHA-256, both accept an algorithm override.
Don't pull a file into memory just to hash it — `hashFileAsync` streams,
which is the whole point. Use `hashString` / `hashBuffer` when the
content was already in memory for another reason.

## Common shapes

### Cache invalidation key from request input

The everyday use case: stable, short, collision-resistant key derived
from the inputs to a memoized computation.

```ts
import { hashString } from "@warlock.js/fs";

const filters = { region: "us-east", since: "2026-01-01" };
const key = `report.${hashString(JSON.stringify(filters))}`;
await cache.set(key, report, "1h");
```

**Gotcha.** `JSON.stringify` doesn't sort keys — `{a:1, b:2}` and
`{b:2, a:1}` stringify differently and hash differently. If your input
might arrive with shuffled keys, sort first:

```ts
function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

const key = `report.${hashString(stableStringify(filters))}`;
```

### Content-addressed bundle filenames (ETag / cache-bust)

```ts
import { hashFileAsync, renameFileAsync } from "@warlock.js/fs";

const digest = await hashFileAsync("./dist/bundle.js");
const versioned = `./dist/bundle.${digest.slice(0, 8)}.js`;
await renameFileAsync("./dist/bundle.js", versioned);
```

Eight hex chars (≈32 bits of entropy) is plenty for a single-app
deployment. For larger systems where many artifacts share a namespace,
use 16 or the full 64.

### Skip work if content hasn't changed

```ts
import {
  hashFileAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
} from "@warlock.js/fs";

const inputDigest = await hashFileAsync("./input.json");
const cachedDigest = (await fileExistsAsync("./.last-input-digest"))
  ? await getFileAsync("./.last-input-digest")
  : null;

if (inputDigest === cachedDigest) {
  return;   // input unchanged — skip the expensive pipeline
}

await runPipeline();
await putFileAsync("./.last-input-digest", inputDigest);
```

This pattern is more robust than mtime-based cache invalidation — a file
that was rewritten with identical content has a new mtime but the same
digest, and you correctly skip the rebuild.

### Compare two files for equality

```ts
import { hashFileAsync } from "@warlock.js/fs";

const same = (await hashFileAsync(a)) === (await hashFileAsync(b));
```

For a one-off comparison this is wasteful compared to a byte-by-byte
`cmp` — you read both files twice (once for each digest) and compute two
hashes. But if you're comparing one file against many candidates, the
digests cache: hash each candidate once, compare strings cheaply
thereafter.

### Integrity verification

You've downloaded a file from a CDN. The CDN published its SHA-256.

```ts
import { hashFileAsync } from "@warlock.js/fs";

const expected = "8a7d3e2f9b4c..."; // from the CDN's manifest
const actual = await hashFileAsync("./downloaded.tar.gz");

if (actual !== expected) {
  throw new Error(`Integrity check failed: expected ${expected}, got ${actual}`);
}
```

Use SHA-256 or SHA-512 for this. MD5/SHA-1 are broken for any adversarial
context (a determined attacker can craft a colliding file).

## What hashes don't do

- **They don't prove freshness.** Two files with the same content hash
  the same, even if one was written today and one in 2010. If you need
  to detect changes regardless of content, use mtime / inode metadata.
- **They don't compare meaningfully.** Hex digests are random; sorting
  them gives you nothing useful. If you need ordering, hash and
  bigint-convert (and even then, the order is essentially random).
- **They're not encryption.** A digest can't be reversed to recover the
  content, but anyone with the same content can recompute the digest.
  Don't use a hash as a "secret token".
- **They're not password hashes.** SHA-256 is fast — that's a feature for
  fingerprinting, a footgun for storing passwords. Use `bcrypt`,
  `scrypt`, or `argon2` for password hashing.

## Related

- [Read and write files](./read-and-write-files) — reading content into
  memory before hashing in-place.
- [Reference / API](../reference/api) — full signatures.
