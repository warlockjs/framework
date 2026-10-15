---
title: "Read and write files"
description: The everyday file IO toolkit — read text and JSON, write text and JSON with auto-parent-dirs, validate against a schema, check existence, and read metadata, all through the fs facade.
sidebar:
  order: 1
  label: "Read and write files"
---

Every Node project ends up doing the same handful of things: read a config
file, write a build artifact, check whether a state file exists. This is how
you do all of that with `@warlock.js/fs`.

The facade is the front door. File operations live under `fs.files.*`, and
each one is a single `await` — no imports to remember, no manual parent-dir
creation, no casts.

```ts title="read-write.ts"
import { fs } from "@warlock.js/fs";

const config = await fs.files.get("config.toml");
await fs.files.put("out/log.txt", "hello world\n");
```

:::note[Async-only — sync callers use the primitives]
The facade never blocks. Synchronous callers (CLI tools, code generators,
one-shot scripts) reach for the bare primitives instead — `getFile`,
`putFile`, and friends, documented in the [reference](../reference/api). The
facade delegates straight to them, so behavior matches; it just adds the
ergonomic surface on top.
:::

## Reading text

`fs.files.get` reads a file as a UTF-8 string — the common case in one call.

```ts
const readme = await fs.files.get("README.md");   // string
```

Need the raw bytes instead? Pass `{ encoding: null }` and you get a `Buffer`
back. The return type follows the option, so there's no cast either way.

```ts
const bytes = await fs.files.get("logo.png", { encoding: null });   // Buffer
```

It throws `ENOENT` if the file is missing. Don't try/catch that — gate the
read with an [existence check](#existence) instead.

## Reading JSON

`fs.files.getJson<T>` reads, parses, and hands you a typed value.

```ts
type Manifest = { version: string; files: string[] };

const manifest = await fs.files.getJson<Manifest>("manifest.json");
//    ^? Manifest
```

By default a missing file throws. Pass `{ default }` to get a fallback back
instead — perfect for optional config that may not exist yet.

```ts
const settings = await fs.files.getJson("settings.json", { default: {} });
// never throws on ENOENT — you get {} instead
```

### Validate while you read

The generic above is only a type assertion — `JSON.parse` returns whatever is
actually in the file. When you can't trust the source, pass a `schema` and the
parsed value is validated before it reaches you.

```ts title="load-config.ts"
import { v } from "@warlock.js/seal";
import { fs } from "@warlock.js/fs";

const config = await fs.files.getJson("config.json", {
  schema: v.object({ port: v.number(), host: v.string() }),
  default: { port: 3000, host: "localhost" },
});
```

The `schema` accepts any [Standard Schema](https://standardschema.dev)
validator — `@warlock.js/seal`, Zod, or Valibot all work, because
`@warlock.js/fs` calls the schema's own `~standard.validate` hook. That means
the package stays **zero-dependency**: nothing is bundled, and you bring your
validator of choice.

:::tip[Validation failures are typed]
When the data doesn't match, `getJson` throws `JsonSchemaValidationError` —
a distinct error you can catch and surface cleanly, instead of letting a bad
config leak downstream as an undefined field.
:::

## Writing text

`fs.files.put` writes a UTF-8 string and creates any missing parent
directories along the way. No `ensureDir` dance first.

```ts
await fs.files.put("out/nested/log.txt", "hello world\n");
// out/ and out/nested/ are created automatically
```

For files another process might read mid-write — a config a dev server
watches, a manifest a deploy script consumes — pass `{ atomic: true }`. The
write goes to a temp file and renames into place, so readers never see a
half-written file.

```ts
await fs.files.put("cache/data.json", "{}", { atomic: true });
```

By default `put` overwrites. Pass `{ overwrite: false }` to make it refuse to
clobber an existing file (it throws instead).

```ts
await fs.files.put("seed.txt", "initial", { overwrite: false });
```

## Writing JSON

`fs.files.putJson` serializes and writes in one step, with the same
auto-parents behavior.

```ts
await fs.files.putJson("out/manifest.json", {
  version: "1.0.0",
  files: ["bundle.js", "styles.css"],
});
```

Output is pretty-printed at 2-space indent by default. Control it with
`{ indent }` — pass `0` for minified output.

```ts
await fs.files.putJson("out/min.json", value, { indent: 0 });
```

## Create-if-absent

When you want to write a file *only* if it isn't there yet — a scaffolded
default, a seed record — use `create` / `createJson`. They're exactly `put` /
`putJson` with `{ overwrite: false }` baked in.

```ts
await fs.files.create("config.toml", defaultConfig);       // text
await fs.files.createJson("state.json", { counter: 0 });   // JSON
```

Both throw if the file already exists, so a re-run won't quietly wipe live
data.

<a id="existence"></a>

## Existence

`fs.files.exists` answers "is there a regular file here?".

```ts
if (!(await fs.files.exists("config.toml"))) {
  await fs.files.put("config.toml", defaultConfig);
}
```

Gating a write like this reads far better than catching `ENOENT` as control
flow. If you don't care whether the path is a file or a directory, use the
type-agnostic `fs.exists`.

```ts
await fs.exists("build-output");   // true for a file OR a directory
```

For directory-specific checks and the rest of the folder toolkit, see
[Manage directories](./manage-directories).

## Metadata

`fs.files.stats` returns a normalized `FileStats` object — the fields you
actually reach for, without the raw `fs.Stats` noise.

```ts
const info = await fs.files.stats("bundle.js");
// { path, name, size, type, lastModified, raw }
```

`size` is bytes, `lastModified` is a `Date`, `type` distinguishes file from
directory, and `raw` is the underlying `fs.Stats` if you need mode bits. When
size is all you want, `fs.files.size` skips straight to the number.

```ts
const bytes = await fs.files.size("bundle.js");   // number
```

Both throw `ENOENT` on a missing path — guard with `fs.files.exists` if the
file might not be there.

## Related

- [The fs facade](./the-fs-facade) — the full `fs.*` surface at a glance.
- [Write atomically](./write-atomically) — for files concurrent readers see.
- [Manage directories](./manage-directories) — list, copy, move, delete.
- [Hash files](./hash-files) — fingerprint for cache invalidation.
- [Reference / API](../reference/api) — full signatures, including the sync
  primitives.
