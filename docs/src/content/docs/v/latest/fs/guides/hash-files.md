---
title: "Hash files"
description: "Fingerprint content with fs.hash.* — sync for strings/buffers, async for files/dirs — plus fs.files.checksumMatches for verifying downloads. SHA-256 by default."
sidebar:
  order: 5
  label: "Hash files"
---

Every project ends up fingerprinting something — a cache key, an ETag, a "did this file change?" check, a download you want to verify. `fs.hash.*` is the one place to reach for. It picks the right strategy for the input and defaults to SHA-256, so you rarely have to think about it.

```ts
import { fs } from "@warlock.js/fs";

fs.hash.string("hello world");      // sync   → "b94d27b9934d3e08..."
await fs.hash.file("./bundle.js");  // async  → digest of the file on disk
```

Two of the four are synchronous and two are asynchronous, for a simple reason explained below.

## Sync for memory, async for disk

`string` and `buffer` are **sync** — the content is already in memory, there's nothing to wait for, so there's no `await`:

```ts
const a = fs.hash.string("some text");
const b = fs.hash.buffer(Buffer.from([0x01, 0x02, 0x03]));
```

`file` and `dir` are **async** — they read from disk, and `fs.hash.file` streams the file so a 1 GB bundle hashes with a flat memory profile:

```ts
const fileDigest = await fs.hash.file("./video.mp4");   // streamed, constant memory
const treeDigest = await fs.hash.dir("./dist");         // stable tree fingerprint
```

:::note[Why the split matters]
Don't read a file into a `Buffer` just to call `fs.hash.buffer` on it — that loads the whole thing into memory. `fs.hash.file` streams, which is the entire point. Only reach for `buffer` when the bytes were already in memory for another reason.
:::

## Pick an algorithm

The default is `"sha256"`, and it's the right pick for cache keys, ETags, content-addressed filenames, and integrity checks. Every method takes an optional algorithm as its last argument:

```ts
fs.hash.string("data", "sha512");
await fs.hash.file("./legacy.bin", "md5");
```

| Algorithm | When |
| --- | --- |
| `"sha256"` (default) | cache keys, ETags, fingerprints, integrity checks |
| `"sha512"` | longer digests, collision resistance at scale (millions of artifacts) |
| `"md5"` | only to match an external system (legacy ETags, some CDN APIs) |
| `"sha1"` | compatibility only (Git, legacy webhook signatures) |

MD5 and SHA-1 are fine for non-adversarial fingerprinting but **broken for anything security-sensitive** — a determined attacker can craft a colliding file. Don't pick them for new integrity checks.

## Verify a download

You fetched a file and the publisher gave you its SHA-256. `fs.files.checksumMatches` does the compare for you — no manual string equality, no case gotchas:

```ts
const ok = await fs.files.checksumMatches("./release.tar.gz", expectedSha256);

if (!ok) {
  throw new Error("Integrity check failed — refusing to use this file");
}
```

Behind the scenes it hashes the file (streaming) and compares against `expected`. Pass an algorithm as the third argument if the publisher used something other than SHA-256.

## Fingerprint a whole directory

`fs.hash.dir` walks the tree and produces one **stable digest** for the entire directory — same contents always yield the same hash, regardless of when the files were written. That makes it a clean signal for cache invalidation and change detection:

```ts
const before = await fs.hash.dir("./src");
// ...some build step runs...
const after = await fs.hash.dir("./src");

if (before === after) {
  return; // nothing changed — skip the expensive rebuild
}
```

This is more robust than watching modification times: a file rewritten with identical content gets a new mtime but the same digest, so you correctly skip the work.

## Everyday shapes

A cache key from request input — stable, short, collision-resistant:

```ts
const filters = { region: "us-east", since: "2026-01-01" };
const key = `report.${fs.hash.string(JSON.stringify(filters))}`;
```

:::caution[`JSON.stringify` doesn't sort keys]
`{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` stringify differently and therefore hash differently. If inputs might arrive with shuffled keys, sort them first before hashing.
:::

A content-addressed filename for cache busting — the first 8 hex chars carry plenty of entropy for a single app:

```ts
const digest = await fs.hash.file("./dist/bundle.js");
const versioned = await fs.file("./dist/bundle.js")
  .rename(`bundle.${digest.slice(0, 8)}.js`);
```

## The low-level layer

The facade delegates to a set of bare primitives — reach for them only from **synchronous** code (CLI tools, config loaders, code generators) where the async facade doesn't fit:

```ts
import { hashString, hashFileAsync } from "@warlock.js/fs";

const inMemory = hashString("hello");        // sync primitive behind fs.hash.string
const fromDisk = await hashFileAsync("f");   // async primitive behind fs.hash.file
```

There's also `hashBuffer`, `hashFile` (sync, reads the whole file), and `hashFileSmallAsync` (one-shot read for files under ~1 MB). In app and runtime code, prefer `fs.hash.*` — it reads better and streams by default.

## What hashes don't do

:::caution[Never hash passwords with this]
`fs.hash.*` is built for **speed**, which is exactly what makes it wrong for passwords. Fast hashing means fast brute-forcing. Store credentials with a slow, salted algorithm — `bcrypt`, `scrypt`, or `argon2` — never a plain SHA/MD5 digest.
:::

- **They don't prove freshness.** Identical content hashes identically, whether written today or a decade ago. Use file metadata (mtime, size) when you truly need "when", not "what".
- **They aren't encryption.** A digest can't be reversed, but anyone with the same content recomputes the same digest — a hash is not a secret token.
- **They don't compare meaningfully.** Digests are effectively random; sorting them tells you nothing.

## Related

- [The fs facade](./the-fs-facade) — the full `fs.*` surface, including `fs.file()` / `fs.dir()` handles.
- [Read and write files](./read-and-write-files) — reading content into memory before hashing in place.
- [Manage directories](./manage-directories) — walking and fingerprinting trees.
- [Reference / API](../reference/api) — full signatures.
