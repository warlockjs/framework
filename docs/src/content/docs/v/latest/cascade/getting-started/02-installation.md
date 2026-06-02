---
title: "Installation"
sidebar:
  order: 2
  label: "Installation"
---

Five minutes from zero to a project that loads Cascade. No conceptual content on this page — pure mechanics. Three steps: install the packages, install your driver, turn on decorators. If you're done before your coffee finishes brewing, that's the right amount of time.

## Prerequisites

- **Node.js 20+** (current active LTS).
- **TypeScript 5+** in the project.
- **A database** — either MongoDB or PostgreSQL — running locally or reachable by connection string. If you don't have one yet, install [MongoDB](https://www.mongodb.com/docs/manual/installation/) or [PostgreSQL](https://www.postgresql.org/download/) first. Cascade works the same against either.

## Step 1 — Install Cascade and seal

Cascade ships with `@warlock.js/seal` as a dependency, but you'll import directly from seal in your schemas (`v` and `Infer`). Install both explicitly so they're both in your `package.json` — stricter package managers (pnpm strict mode, Yarn PnP) need it.

import { Tabs, TabItem } from "@astrojs/starlight/components";

<Tabs groupId="package-manager">
  <TabItem label="npm">

```bash
npm install @warlock.js/cascade @warlock.js/seal
```

  </TabItem>
  <TabItem label="pnpm">

```bash
pnpm add @warlock.js/cascade @warlock.js/seal
```

  </TabItem>
  <TabItem label="yarn">

```bash
yarn add @warlock.js/cascade @warlock.js/seal
```

  </TabItem>
  <TabItem label="bun">

```bash
bun add @warlock.js/cascade @warlock.js/seal
```

  </TabItem>
</Tabs>

Both packages are now in your `package.json`. You'll import the ORM bits (`Model`, `RegisterModel`, relation helpers) from `@warlock.js/cascade`, and the schema bits (`v`, `Infer`) from `@warlock.js/seal`.

## Step 2 — Install your database driver

Cascade speaks MongoDB and PostgreSQL through separate peer dependencies. Install the one you're using:

**For MongoDB:**

```bash
npm install mongodb
```

**For PostgreSQL:**

```bash
npm install pg
```

That's the entire driver story from the install side. Cascade picks it up via configuration on the next page — you don't import it directly.

## Step 3 — Turn on decorators

Cascade uses `@RegisterModel()` to put each model into a global registry, and `@BelongsTo` / `@HasMany` / etc. to declare relations. If decorators don't run, the registry stays empty, decorator-based relations never hoist, and your models break at runtime with confusing errors.

So: turn decorators on. Mandatory, not optional.

Add this to your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
```

Three things this does:

- `experimentalDecorators` makes `@RegisterModel()` compile.
- `emitDecoratorMetadata` lets Cascade read decorator-attached metadata at runtime.
- `strict` catches the kind of schema-vs-class drift you want to know about at compile time, not at 2am.

## Recap

You've got:

- Cascade and seal installed
- One database driver installed (Mongo or Postgres)
- TypeScript ready for decorators

Nothing's running yet — that's the next page.

## Next

Continue to **[Configuration](./03-configuration.md)** to connect Cascade to your database.
