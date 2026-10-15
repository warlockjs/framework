---
title: "Safely overwrite a JSON config"
description: Read a JSON config, change a field, write it back atomically with the fs facade — no half-written file ever observable to a watcher.
sidebar:
  order: 1
  label: "Safely overwrite a JSON config"
---

Every project ends up with a config file that something else is watching — a
dev server, a linter, your own hot-reload. You need to flip a field without
ever letting a truncated, half-written JSON file be observed.

## The recipe

The facade's `mergeJson` reads, patches, and writes in one call. Pass
`{ atomic: true }` so the write goes through a temp file and an atomic rename.

```ts title="src/set-feature.ts"
import { fs } from "@warlock.js/fs";

await fs.files.mergeJson(
  "config.json",
  { features: { "dark-mode": true }, updatedAt: new Date().toISOString() },
  { atomic: true },
);
```

Any watcher sees the old config or the new one, never a half-written one. A
crash between read and write leaves the file untouched.

## When the change isn't a simple patch

`mergeJson` spreads a partial over the top level. When you need to compute the
new value from the old one — bump a counter, push into an array — reach for
`editJson`:

```ts title="src/bump-build.ts"
import { fs } from "@warlock.js/fs";

await fs.files.editJson("config.json", (cfg) => ({
  ...cfg,
  builds: cfg.builds + 1,
}), { atomic: true });
```

:::tip[Missing file? Seed it first]
Both helpers read before they write. If the file might not exist yet, call
`fs.files.ensureJson("config.json", { features: {} })` once up front — it
returns the parsed doc or creates it from your fallback, never truncating an
existing file.
:::

## What atomic does *not* do

`atomic` makes the *write* safe to observe. It does **not** lock the
read-modify-write pair — two callers can both read the same starting state and
one write silently wins. `@warlock.js/fs` has no file locking by design.

If lost updates matter, serialize the whole operation:

- **In-process** — an `async`-aware mutex around the `mergeJson` call.
- **Cross-process** — `@warlock.js/cache`'s `cache.lock(key, ttl, fn)`,
  backed by Redis or Postgres.

## Related

- [Patch a JSON config](./patch-a-json-config) — deep merges and field bumps.
- [Write atomically](../guides/write-atomically) — the mechanism underneath
  `{ atomic: true }`.
- [The fs facade](../guides/the-fs-facade) — the full `fs.files.*` surface.
