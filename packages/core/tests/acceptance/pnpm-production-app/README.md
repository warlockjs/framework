# pnpm production acceptance app

The smallest possible Warlock app whose only job is to **fail** when the
framework ships an artifact a real consumer cannot boot.

## Why this exists

`warlock build` bundles with esbuild's `packages: "external"`, so every bare
specifier the builder writes survives verbatim into `dist/app.js` and resolves
against the **consuming app's** `node_modules`. When the builder emitted
`import config from "@mongez/config"` — one of *core's* dependencies, never the
app's — npm and yarn resolved it by accident through flat hoisting. pnpm's
strict layout does not, so the shipped bundle died with `ERR_MODULE_NOT_FOUND`
for a package the app never imported and had no reason to declare.

Every acceptance run until then had used `warlock dev`. Production mode had
never once run. That is the actual defect this app exists to prevent.

## The rules that make it a real test

1. **It declares `@warlock.js/core` and nothing else.** Adding any other
   dependency to satisfy a build failure defeats the entire test — the failure
   *is* the finding. A consumer must never have to declare a package it does
   not import in order to boot our artifact.
2. **Core is installed from a packed tarball, not a directory.** A `file:` or
   `link:` dependency pointing at a sibling folder makes pnpm create a symlink
   into the monorepo, which restores exactly the accidental resolution this
   test is checking for. `vendor/warlock-core.tgz` is a real, extracted install.
3. **It is not a workspace member.** The root `package.json` lists workspace
   directories by name, and `core/tests/**` is not among them, so a root
   install cannot hoist anything into this app's `node_modules`.
4. **`private: true`** — it is never published.

## Running it

```bash
node core/tests/acceptance/run-pnpm-acceptance.mjs
```

The script builds core, packs it, installs here with pnpm, then runs
`warlock build` and `warlock start` and requests an endpoint. It also runs the
negative case: a deliberately reintroduced undeclared import must fail
`warlock build` rather than produce an unbootable bundle.

`vendor/`, `node_modules/`, `dist/` and `.warlock/` are all generated — nothing
under them is committed.
