---
banner:
  content: "This page documents Warlock v4. <a href='/v/latest'>View the latest docs.</a>"
title: "Patch a JSON config"
description: Merge or bump individual fields of a JSON file with fs.files.mergeJson and editJson — shallow patches, deep merges, and computed updates.
sidebar:
  order: 2
  label: "Patch a JSON config"
---

You rarely want to rewrite a whole config — you want to touch one field and
leave the rest alone. The facade gives you two tools for that: `mergeJson` for
declarative patches, `editJson` for computed ones.

## Shallow patch

`mergeJson` spreads a partial over the top level. Perfect for setting a couple
of known fields:

```ts title="src/patch.ts"
import { fs } from "@warlock.js/fs";

await fs.files.mergeJson("config.json", {
  host: "0.0.0.0",
  port: 8080,
});
```

Existing top-level keys you didn't mention survive untouched.

## Deep merge

By default the spread is shallow, so a nested object *replaces* rather than
merges. When you want the patch to recurse into nested objects, pass
`{ deep: true }`:

```ts title="src/patch-nested.ts"
import { fs } from "@warlock.js/fs";

// Only touches features.flags.queues — other flags under features stay put.
await fs.files.mergeJson(
  "config.json",
  { features: { flags: { queues: true } } },
  { deep: true },
);
```

:::caution[Shallow vs deep]
Without `deep`, `mergeJson("config.json", { features: { flags: { queues: true } } })`
would overwrite the *entire* `features` object with just
`{ flags: { queues: true } }`, dropping every other feature. Reach for
`{ deep: true }` whenever your patch is more than one level down.
:::

:::note[Safe against prototype pollution]
`mergeJson` drops `__proto__` / `constructor` / `prototype` keys from both sides of the merge, at every depth, instead of merging them — so patching straight from a request body (`mergeJson(configPath, req.body)`, a natural shape for a "PATCH this config" endpoint) can't poison the merged object or the file written back to disk. The rest of the payload merges as normal.
:::

## Computed update

When the new value depends on the old one — increment a version, append to a
list — `mergeJson` can't express it. Use `editJson`, which hands you the parsed
document and writes back whatever you return:

```ts title="src/bump-version.ts"
import { fs } from "@warlock.js/fs";

await fs.files.editJson("package.json", (pkg) => ({
  ...pkg,
  version: bump(pkg.version),
  scripts: { ...pkg.scripts, release: "pkgist release" },
}));
```

## Related

- [Safely overwrite a JSON config](./safely-overwrite-json-config) — the
  atomic-write story for these same helpers.
- [The fs facade](../guides/the-fs-facade) — the whole JSON family
  (`getJson` / `putJson` / `mergeJson` / `editJson` / `ensureJson`).
