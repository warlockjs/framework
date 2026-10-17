---
title: no-js-import-extension
description: Disallow .js extensions in relative import paths.
sidebar:
  order: 7
---

**Recommended:** error · **Fix:** autofix

Warlock apps import relative modules without an extension
(`./user.model`). A `.js` (or `.jsx`) suffix on a TypeScript import names a file
that does not exist in `src/`, and breaks the dev server's module graph and
hot reload. Package subpaths (`some-package/index.js`) are not checked.

## Incorrect

```ts
import { User } from "./user.model.js";
export * from "./types.js";
```

## Correct

```ts
import { User } from "./user.model";
export * from "./types";
```
