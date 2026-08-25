---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Edit files in place"
description: The read-modify-write family — fs.files.edit / editJson / mergeJson / ensureJson / appendJsonLine. Patch a file in one call instead of get + transform + put by hand.
sidebar:
  order: 2
  label: "Edit files in place"
---

Every project ends up doing the same dance: read a file, change one thing,
write it back. Bump a version. Flip a flag. Push a log line. Done by hand
that's three steps and a variable you have to name. The facade turns each
of those into **one call** — you pass a function, `fs` handles the read and
the write.

```ts
import { fs } from "@warlock.js/fs";

await fs.files.editJson("package.json", (pkg) => ({ ...pkg, version: "4.7.0" }));
```

That's the whole read-modify-write loop. No `getJson`, no temp variable, no
`putJson`. This guide is the tour of that family.

## `edit(path, text => text)` — patch a text file

`edit` reads the file as a string, hands it to your function, and writes
whatever you return.

```ts
await fs.files.edit("README.md", (md) => md.replaceAll("4.6", "4.7"));
```

Compare that to doing it by hand — the thing you'd otherwise write:

```ts
const md = await fs.files.get("README.md");
await fs.files.put("README.md", md.replaceAll("4.6", "4.7"));
```

Same result, but `edit` names the pattern for you: the argument *is* the
current contents, the return value *is* the new contents. Nothing to
mistype, nothing to forget to write back.

## `editJson(path, obj => obj)` — transform a JSON document

`editJson` is `edit` for JSON: it parses, calls your function with the
parsed object, and writes the (pretty-printed) result. This is the killer
one — bumping a version, retargeting a field, rewriting a nested value.

```ts
await fs.files.editJson<Pkg>("package.json", (pkg) => ({
  ...pkg,
  version: bumpPatch(pkg.version),
}));
```

Because you get the whole document, you can do anything — including push
into an array, which nothing else in the family does:

```ts
await fs.files.editJson<Manifest>("manifest.json", (m) => ({
  ...m,
  files: [...m.files, "styles.css"],
}));
```

:::tip[Reach for `editJson` when the change depends on the old value]
Bumping a number, appending to a list, renaming a key based on another
key — anything where the new value is *computed from* the current one is
`editJson`'s job. If you're just setting known fields, [`mergeJson`](#mergejsonpath-partial--deep--patch-a-config-object)
is shorter.
:::

## `mergeJson(path, partial, { deep? })` — patch a config object

When you only want to set a few fields and leave the rest alone, you don't
need a whole transform function — hand `mergeJson` a partial object and it
merges it in. **Shallow by default**; pass `{ deep: true }` to recurse into
nested objects.

```ts
await fs.files.mergeJson("config.json", { flags: { queues: true } });
```

The `deep` flag is the whole story. Say `config.json` starts as:

```json title="config.json (before)"
{ "flags": { "cache": true }, "port": 3000 }
```

A **shallow** merge replaces `flags` wholesale — the old keys inside it are gone:

```ts title="shallow (default)"
await fs.files.mergeJson("config.json", { flags: { queues: true } });
```

```json title="config.json (after — shallow)"
{ "flags": { "queues": true }, "port": 3000 }
```

A **deep** merge recurses into `flags` and keeps `cache`:

```ts title="deep"
await fs.files.mergeJson("config.json", { flags: { queues: true } }, { deep: true });
```

```json title="config.json (after — deep)"
{ "flags": { "cache": true, "queues": true }, "port": 3000 }
```

:::note[Shallow is the default on purpose]
Shallow merge is predictable — top-level keys you name get replaced, the
rest are untouched. Only opt into `deep` when you genuinely want nested
objects merged rather than overwritten.
:::

`__proto__` / `constructor` / `prototype` keys are dropped from both sides of the merge (at every depth) rather than merged — so `mergeJson`ing an untrusted partial (a request body, say) can't prototype-pollute the merged object or the file written back to disk.

## `ensureJson(path, fallback)` — get-or-create config

Loading a config file that might not exist yet? `ensureJson` returns the
parsed document if it's there, or writes `fallback` and returns that.

```ts
const config = await fs.files.ensureJson("config.json", {
  port: 3000,
  host: "localhost",
});
```

No `exists` check, no try/catch around a missing-file read. First run
writes the defaults; every run after reads them. Pair it with the family
above — `ensureJson` to get the doc into existence, `mergeJson` / `editJson`
to evolve it from there.

## `appendJsonLine(path, value)` — NDJSON logs

Not every JSON file is one document. A log is a *stream* of records, one
per line — [NDJSON](https://github.com/ndjson/ndjson-spec). `appendJsonLine`
serializes one value and appends it as a single line.

```ts
await fs.files.appendJsonLine("events.ndjson", { type: "signup", at: Date.now() });
```

Each call adds exactly one line:

```json title="events.ndjson"
{"type":"signup","at":1719800000000}
{"type":"login","at":1719800600000}
```

This is *not* the same as pushing into an array with `editJson`. The array
approach re-reads and re-writes the entire file on every append — O(n) and
increasingly slow as the log grows. `appendJsonLine` just appends bytes.

:::tip[Read NDJSON back one record at a time]
Use [`fs.files.readLines(path)`](./the-fs-facade) — an async iterator — so
you never hold the whole log in memory.
:::

## The JSON family — pick the right one

| Method | When |
| --- | --- |
| `getJson(path, { schema?, default? })` | read a document (optionally validate + fall back when missing) |
| `putJson(path, value, { indent? })` | overwrite the whole document |
| `mergeJson(path, partial, { deep? })` | set a few known fields; leave the rest (shallow, or `deep`) |
| `editJson(path, fn)` | transform based on the old value — bump, compute, push into an array |
| `ensureJson(path, fallback)` | read it, or create it if missing |
| `appendJsonLine(path, value)` | one record per line (a log) — **not** one document |

Rough rule: reading → `getJson`; replacing → `putJson`; patching known
fields → `mergeJson`; computing from the current value → `editJson`;
first-run defaults → `ensureJson`; a growing log → `appendJsonLine`.

## Handles, not paths

Every method here also lives on a [`fs.file()` handle](./the-fs-facade), so
if you're already holding one you skip repeating the path:

```ts
const pkg = fs.file("package.json");
await pkg.editJson<Pkg>((p) => ({ ...p, version: "4.7.0" }));
await pkg.mergeJson({ private: true });
```

:::caution[These are sugar, not a lock]
The whole family read-then-writes. Two callers editing the same file in
parallel will **race** — last write wins, and an update can be silently
lost. The `{ atomic: true }` option only makes the *write* atomic; it does
**not** make the read+write pair atomic. `@warlock.js/fs` has no file
locking. For state shared across processes, serialize the writes yourself
or reach for a real lock.
:::

## Related

- [The fs facade](./the-fs-facade) — the full `fs.*` surface these live on.
- [Read and write files](./read-and-write-files) — plain `get` / `put` when there's nothing to transform.
- [Write atomically](./write-atomically) — for files other processes read mid-write.
- [Reference / API](../reference/api) — full signatures.
