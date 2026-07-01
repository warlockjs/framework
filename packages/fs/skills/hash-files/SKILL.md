---
name: hash-files
description: 'Compute hex digests — hashFile / hashFileAsync (streaming for large files), hashFileSmallAsync, hashString, hashBuffer. Defaults to SHA-256; supports sha1 / md5 / sha512. Triggers: `hashFile`, `hashFileAsync`, `hashFileSmallAsync`, `hashString`, `hashBuffer`, `HashAlgorithm`; "fingerprint a file for cache invalidation", "compute SHA-256 checksum", "compare two files for equality", "cache key from request input"; typical import `import { hashFileAsync, hashString } from "@warlock.js/fs"`. Skip: file IO — `@warlock.js/fs/read-and-write-files/SKILL.md`; competing libs `hasha`, `md5-file`, `crypto-hash`; native `node:crypto` `createHash`.'
---

# Compute file and content hashes

Hex-digest helpers backed by `node:crypto`. Picks the right strategy for the input size — streaming for files (memory stays flat), one-shot for in-memory content.

## Available algorithms

```ts
type HashAlgorithm = "sha256" | "sha1" | "md5" | "sha512";
```

Default is `"sha256"` — the right choice for cache-bust, content-addressable storage, and fingerprinting. Pick `"md5"` only when matching an external system that requires it; never for security.

## Hash a file

```ts
import { hashFile, hashFileAsync } from "@warlock.js/fs";

// Streaming — constant memory regardless of file size
const fingerprint = await hashFileAsync("./bundle.js");
// → "8a7d3e2f9b4c..."

// Sync, with custom algorithm
const md5 = hashFile("./small.txt", "md5");
```

`hashFileAsync` uses a stream, so a 1 GB file doesn't blow the heap. `hashFile` (sync) reads the whole file at once — fine for small files.

## Hash a small file in one shot

```ts
import { hashFileSmallAsync } from "@warlock.js/fs";

const digest = await hashFileSmallAsync("./icon.svg");
```

`hashFileSmallAsync` reads the file in a single `readFile` call before hashing. Slightly faster than streaming when the file is < ~1 MB; **don't** use it on large files (it'll load the whole thing into memory).

| Use | Reach for |
| --- | --- |
| Streaming async (default for files) | `hashFileAsync` |
| Small file, slightly faster async | `hashFileSmallAsync` |
| Sync (CLI / config loader only) | `hashFile` |
| In-memory string | `hashString` |
| In-memory Buffer / Uint8Array | `hashBuffer` |

## Hash in-memory content

```ts
import { hashString, hashBuffer } from "@warlock.js/fs";

const stringDigest = hashString("hello world");
const bufferDigest = hashBuffer(Buffer.from([0x01, 0x02, 0x03]));
```

Both sync, both default to SHA-256, both accept the algorithm override.

## Common shapes

### Cache key from request input

```ts
import { hashString } from "@warlock.js/fs";

const key = `report.${hashString(JSON.stringify(filters))}`;
await cache.set(key, report, "1h");
```

Stable, short, collision-resistant. JSON stringification is the gotcha — key order matters; sort keys if the input might arrive in different orders.

### Bust a CDN cache when a build artifact changes

```ts
import { hashFileAsync } from "@warlock.js/fs";

const digest = await hashFileAsync("./dist/bundle.js");
await renameFileAsync("./dist/bundle.js", `./dist/bundle.${digest.slice(0, 8)}.js`);
```

8 hex chars (≈32 bits) is enough for a single-app deployment — collisions on a per-build basis are vanishingly small.

### Skip work if content hasn't changed

```ts
import { hashFileAsync, fileExistsAsync, getFileAsync } from "@warlock.js/fs";

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

### Compare two files for equality

```ts
const same = (await hashFileAsync(a)) === (await hashFileAsync(b));
```

Cheaper than `cmp`-byte-comparing two large files when the result is "yes/no different" — and you cache the digests for later comparisons against other candidates.

## See also

- [`@warlock.js/fs/read-and-write-files/SKILL.md`](@warlock.js/fs/read-and-write-files/SKILL.md) — reading files before hashing in-memory content
- [`@warlock.js/cache/use-cached-hof/SKILL.md`](@warlock.js/cache/use-cached-hof/SKILL.md) — building cache keys from hashes

## Things NOT to do

- Don't use MD5 or SHA-1 for security purposes (password hashing, signature verification). Both are broken cryptographically — they're fine for cache keys and non-adversarial fingerprinting, nothing more.
- Don't truncate the digest below 32 bits (8 hex chars) for collision-sensitive uses. Two builds with the same prefix do happen; full digest is 64 hex chars for SHA-256.
- Don't load a large file via `getFileAsync` and then `hashString` it — that defeats the streaming optimization. Use `hashFileAsync` directly.
- Don't expect digests to compare lexically meaningfully — they're random hex. For ordering, hash and then `bigint`-convert if you really need sort.
