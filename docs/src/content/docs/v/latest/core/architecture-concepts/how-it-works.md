---
title: "How it works"
description: A surface-level tour of the framework's internals — dev server, HMR loop, transpile cache, ESM loader hook, production bundler, manifest, type generation. What you'd want to know without extending any of it.
sidebar:
  order: 2
  label: "How it works"
---

You don't need to read this page to use Warlock. The framework is designed to be invisible — write a controller, hit a URL, ship a feature. None of the moving parts below appear in your code.

But if you've ever opened your editor in a fresh checkout and wondered why type completion just works on `config.get("database")`, why the dev server boots a 200-file project in two seconds, or what `.warlock/` is doing in your project root — this page is for you. We'll do a quick tour of each major internal system: what it does, why it exists, what it means for your day-to-day. Two to four sentences each. Enough to know.

**A caveat up front.** Internals change between minor versions. If you're trying to extend the framework — write a custom file watcher, hook into the bundler, override the loader — start with the deep dives linked at the bottom; this page won't be enough. If you're trying to use the framework, you're done after this.

## The dev server's file watcher

The dev server uses [`chokidar`](https://www.npmjs.com/package/chokidar) to watch `src/`, `.env*`, and `warlock.config.ts`. When a file changes, the change goes into a batch — chokidar fires fast, and the watcher debounces multiple writes (the kind your editor does during "save") into one update event. The batch then drives the HMR loop.

The watch list is intentionally narrow. Files under `node_modules/`, `dist/`, and `.warlock/` are ignored — you don't care about them, and watching them would tank performance.

## The HMR loop

When a file changes, the dev server doesn't restart. It figures out the dependency graph (who imports what), invalidates the changed file *and* every file that transitively imports it, then re-imports the affected chain. Routes get re-registered, listeners get re-attached, your controllers reload — all without bouncing the database connection or the HTTP server.

The mechanism is a per-import `?v=N` query string that Node treats as a cache key. Bump the version, Node treats the URL as a new module, the file gets re-loaded with the latest contents. No userland module cache to manage, no native-ESM cycle weirdness.

What it means for you: save a file, the change appears within a hundred milliseconds. Cold reboots are rare — you'd need to change `warlock.config.ts` (which loads earlier than HMR can reach) or restart manually.

## The transpile cache

TypeScript transpilation is fast — fast enough that you don't notice it on one file. Across a 500-file project on a fresh boot, those milliseconds add up. The transpile cache stores the JS output of every successfully-transpiled file, keyed by a hash of the source content plus a transform-options fingerprint (esbuild version, a cache-format epoch, and your `tsconfig` `compilerOptions`).

The cache is persisted to disk under `.warlock/transpile/`, content-hash addressed — entries are sharded by the first two hex chars of the key, and the on-disk filename is opaque (the source identity lives only inside the source map). Because it survives between processes, files that haven't changed hit the cache and skip transpilation on the *next* boot, not just within the current session. Change a file's content and you get a different key, so a fresh transpile — there's no stale-output risk.

## The ESM loader hook

Node's [`module.register` API](https://nodejs.org/api/module.html#moduleregisteroptions) lets a process customize how `import` statements get resolved. Warlock uses one to wire two things into the import pipeline: the `?v=N` cache-busting layer (HMR) and the transpile cache (cold-boot speed).

The hook runs in a worker thread, communicates with the main process via a `MessageChannel`, and delegates the actual TypeScript transpilation to [`tsx`](https://www.npmjs.com/package/tsx). The whole loader system is custom but the transpiler isn't — that's a battle-tested off-the-shelf piece.

What it means for you: zero config. TypeScript files just work in `import` statements. The "I need a build step in dev" problem doesn't exist.

## The production builder

For production, the dev server's loader hook is the wrong tool — it's optimized for fast change-and-reload cycles, not bundle size. `warlock build` uses [`esbuild`](https://esbuild.github.io/) to bundle your project into the `dist/` folder (or wherever `warlock.config.ts > build.outDirectory` points — it defaults to `"dist"`).

The builder generates a single combined `bootstrap.ts`, a config loader, route registrations, and an entry file, then esbuild produces the final bundle. `warlock start` runs that bundle with `node --enable-source-maps`. No `tsx`, no loader hook, no watch — just a Node process running a bundled artifact.

What it means for you: prod is a clean separation. Dev runs through the custom loader; prod runs through esbuild output. Production stack traces map back to TypeScript source via the source maps.

## The manifest cache

The manifest module keeps a `.warlock/commands.json` file that records each registered CLI command's metadata — its source (`framework`, `plugin`, or `project`), description, alias, and option definitions. On subsequent boots, the dev server loads this file and skips re-parsing command registrations that haven't changed — only fresh or modified files get re-read from disk.

The `--fresh` flag on `warlock dev` clears the cache before starting, forcing a full re-parse. You'd do that after pulling a branch with significant restructuring, or when the dev server is behaving in ways the cache could plausibly explain.

What it means for you: boot times stay fast even as your project grows. The cache is invisible until it goes wrong — at which point `warlock dev --fresh` is the lever.

## Type generation

The `.warlock/typings/` folder holds generated `.d.ts` files that augment Warlock's public types based on *your* project. The `ConfigRegistry` augmentation makes `config.get("database")` autocomplete with your actual config keys. The route augmentations type your URL patterns. The storage augmentation types your driver names.

The generator runs in the background as part of `warlock dev` (and can be re-run on demand with `warlock generate.typings`). The TypeScript Compiler API parses your config files, extracts the exported keys, and writes a module augmentation. Your IDE picks it up automatically.

What it means for you: autocomplete works on your own data. Adding a new config file gives you `config.get("my-new-config")` typed without doing anything else.

## The bootstrap and connectors

When a Warlock app starts (dev or prod), the bootstrap phase loads `.env`, the configs, and the warlock-config, then `connectorsManager` starts each registered connector in priority order. Connectors are the framework's lifecycle hooks for subsystems — the HTTP server, database, cache, mailer, storage, socket, herald.

Each connector has an `Early` or `Late` phase. Most run `Early` (database, cache, storage). The ones that need user code to have loaded — `http` (for route registrations) and `socket` (for connection listeners) — run `Late`, after your modules have been imported.

What it means for you: the order of operations is deterministic. By the time your `main.ts` runs, every Early-phase subsystem is up. By the time the first request lands, every Late-phase subsystem is up too. See [Bootstrap and connectors](./bootstrap-and-connectors.md) for the full lifecycle.

## Decorators, models, and registries

Cascade's `@RegisterModel()` decorator adds each model class to a global registry at import time. Same idea for relations (`@BelongsTo`, `@HasMany`, `@MorphTo`). The dev server eagerly imports model files at boot — before route registrations run — so decorator side-effects populate the registries first.

If you've seen a "model not registered" error at runtime, it's almost always one of two things: the model file isn't in `src/app/<module>/models/`, or `experimentalDecorators` isn't set in `tsconfig.json`.

## Where to dig deeper

If you need to extend any of this — write a custom loader, plug into the bundler, add a file watcher kind — the user-facing docs end here. The next step is the design docs.

## A note on stability

The dev server, the manifest, the loader hook, the production builder — these are internals. The team treats their *behavior* as stable but their *interfaces* as not. Reaching into core's internal modules (the dev server, manifest, loader, production builder) from a user project will work today and break in two months. If you find yourself wanting to do that, file an issue first — there's usually a public-API path we can extend instead.
