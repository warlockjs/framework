---
title: "Your first write"
description: Five-minute walkthrough — ensure a directory, write a JSON manifest, read it back, hash it for cache invalidation.
sidebar:
  order: 3
  label: "Your first write"
---

Five minutes from `yarn add` to a working read/write/hash flow. The
example below is a tiny build-manifest emitter — common enough that you'll
recognize the shape from your own projects.

## The scenario

A build script produces some files under `./dist`. You want to:

1. Make sure `./dist` exists.
2. Write a `manifest.json` describing the build.
3. Read the manifest back to verify it.
4. Hash it for cache invalidation downstream.

## The full script

```ts
import {
  ensureDirectoryAsync,
  putJsonFileAsync,
  getJsonFileAsync,
  hashFileAsync,
} from "@warlock.js/fs";

type Manifest = {
  version: string;
  builtAt: string;
  files: string[];
};

async function emitManifest() {
  // 1. Make sure the output dir is there.
  await ensureDirectoryAsync("./dist");

  // 2. Write the manifest — pretty-printed JSON, parent dirs auto-created.
  const manifest: Manifest = {
    version: "1.0.0",
    builtAt: new Date().toISOString(),
    files: ["bundle.js", "styles.css"],
  };

  await putJsonFileAsync("./dist/manifest.json", manifest);

  // 3. Read it back, fully typed.
  const readBack = await getJsonFileAsync<Manifest>("./dist/manifest.json");
  console.log(`Wrote manifest v${readBack.version} with ${readBack.files.length} files`);

  // 4. Hash for cache invalidation. SHA-256 default, hex digest.
  const digest = await hashFileAsync("./dist/manifest.json");
  console.log(`Manifest digest: ${digest.slice(0, 12)}...`);
}

emitManifest();
```

Run it. You should see two log lines, and `./dist/manifest.json` on disk
with the expected content.

## What each call did

**`ensureDirectoryAsync`** — recursive `mkdir`. Idempotent. If `./dist`
already existed, this was a no-op; if it didn't, it created it. You can
chain `./dist/cache/v2` and it'll create each segment.

**`putJsonFileAsync`** — serialised the object to JSON (2-space indent),
created any missing parent directories under the file path, wrote it as
UTF-8. One call, the full write story.

**`getJsonFileAsync<Manifest>`** — read the file, parsed it as JSON, typed
it as `Manifest`. The generic is yours; the runtime parse is `JSON.parse`
with no extra validation, so if the file is malformed you get a
`SyntaxError` to handle. Run it through `@warlock.js/seal` if you want
schema-checked reads.

**`hashFileAsync`** — streamed the file through SHA-256 and returned the
hex digest. Streaming means a 100 MB file doesn't blow the heap — same
call works for tiny configs and large bundles.

## Could you skip ensureDirectoryAsync?

Yes. `putJsonFileAsync` already does `mkdir({ recursive: true })` on the
file's parent directory. The example used `ensureDirectoryAsync`
explicitly to make the directory creation visible, but in real code you
can drop it:

```ts
// Equivalent — putJsonFileAsync creates ./dist if missing.
await putJsonFileAsync("./dist/manifest.json", manifest);
```

When you **do** want `ensureDirectoryAsync`: creating an empty directory
ahead of time (e.g. you're about to copy a bunch of files into it), or
making the intent explicit in a script with several steps.

## Next

- [The helpers](../essentials/01-the-helpers) — a tour of the full
  surface.
- [Atomic vs non-atomic writes](../essentials/02-atomic-vs-non-atomic) —
  when `putFileAsync` is fine and when you want `atomicWriteAsync`.
- [Read and write files](../guides/read-and-write-files) — the read/write
  guide in depth.
