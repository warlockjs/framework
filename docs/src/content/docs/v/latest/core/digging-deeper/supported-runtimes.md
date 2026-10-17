---
title: "Supported runtimes"
description: Which Warlock commands run on Node, Bun and Deno — dev and build on Node, the production build started on Node, Bun 1.4.3 or Deno 2.9.7 — with the exact start commands CI verifies.
sidebar:
  order: 11
  label: "Supported runtimes"
---

Warlock is developed and built on Node. The **production build** it produces also starts and serves on Bun and Deno, through their Node compatibility layers. This page says which command runs where, gives the exact start commands, and lists what the verification covers.

## The matrix

| Command                  | Node.js 22.15+       | Bun 1.4.3                        | Deno 2.9.7                       |
| ------------------------ | -------------------- | -------------------------------- | -------------------------------- |
| `warlock dev`            | ✔ supported          | ✖ refused with an error          | ✖ refused with an error          |
| `warlock build`          | ✔ supported          | runs, prints a notice — use Node | runs, prints a notice — use Node |
| `warlock start`          | ✔ supported          | ✔ supported                      | ✔ supported                      |
| the built entry directly | ✔ `node dist/app.js` | ✔ `bun dist/app.js`              | ✔ `deno run -A dist/app.js`      |

The Bun and Deno versions are the ones the `runtimes` CI workflow pins and tests on every pull request. Newer patch releases are expected to work; a version not listed has not been verified.

## Why `dev` is Node only

`warlock dev` compiles TypeScript on the fly and hot-reloads modules through Node's module loader hooks (`module.register` and `module.registerHooks`). Bun does not provide `registerHooks`, and neither runtime runs Node's loader hooks the way the dev server needs them. Rather than start a half-working server, `warlock dev` stops before doing anything on Bun or Deno:

```text
✖ warlock dev runs on Node.js only — this process is Bun 1.4.3.
  The development server compiles TypeScript and hot-reloads modules through Node's module loader hooks.
  Run it with Node.js 22.15 or newer: npx warlock dev
  Bun can run the production build: build it with Node (npx warlock build),
  then start it with bun dist/app.js.
```

The process exits with code 1.

## Build on Node

`warlock build` is plain esbuild and Vite work, and it usually completes on Bun and Deno too. Only the Node build is verified, so on Bun or Deno the command prints a notice on stderr and carries on:

```text
! warlock build is verified on Node.js; this process is Deno 2.9.7.
  Build with Node (npx warlock build) for a supported artifact. Starting the built app on Deno is supported.
```

Build in CI or on the deploy host with Node, then ship `dist/` together with `node_modules` (the bundle keeps packages external) and your `.env` files — exactly as for a Node deployment. See [Deployment & production](./deployment.md).

## Start on Bun

Either run the built entry directly:

```bash
NODE_ENV=production bun dist/app.js
```

or run the CLI with Bun, which keeps `warlock start`'s readiness banner, `--role`/`--sites` handling and signal forwarding:

```bash
NODE_ENV=production bun node_modules/@warlock.js/core/bin/warlock.js start
NODE_ENV=production bun node_modules/@warlock.js/core/bin/warlock.js start --role=api
```

`bun --bun run start` (with `"start": "warlock start"` in `package.json`) works too: `--bun` makes the `warlock` shim run on Bun instead of the `node` on your `PATH`. A plain `bun run start` runs the CLI on Node. The CLI starts the server with the runtime it is running on, so the server runs on Bun whenever the CLI does.

## Start on Deno

```bash
NODE_ENV=production deno run -A dist/app.js
```

or through the CLI:

```bash
NODE_ENV=production deno run -A node_modules/@warlock.js/core/bin/warlock.js start
```

Deno picks up `node_modules` from the `package.json` next to it, so no extra compatibility flag is needed. `-A` grants every permission: a Warlock app reads `.env` and config, binds its port, reads environment variables, writes logs, cache and uploads under `storage/`, and the CLI spawns the server process. A narrower `--allow-*` set is possible but is not what CI verifies.

## What the verification covers

The `runtimes` workflow builds the framework packages from the commit under test, installs a fixture app (`packages/core/tests/acceptance/runtime-app`) from those tarballs, runs `warlock build` on Node, then starts the build on each runtime — once directly and once through `warlock start` — and requires:

- a server-rendered React page (`@warlock.js/web`, streaming SSR with a loader);
- a JSON API route and a `POST` with a JSON body;
- a file-cache round trip and a file log channel;
- a file from `public/` and a hashed client asset from the build;
- `/health`, and a 404 for an unknown path;
- a clean shutdown on `SIGTERM` that releases the port.

Run the same check locally with Node, plus Bun and Deno on your `PATH`:

```bash
node packages/core/tests/acceptance/run-runtime-acceptance.mjs --runtimes=node,bun,deno
```

Database drivers, Redis, queues, sockets and native add-ons such as `sharp` are not part of the fixture. They go through the same compatibility layers, but they have not been verified on Bun or Deno.

## See also

- [Deployment & production](./deployment.md) — what `warlock build` emits and how `warlock start` runs it.
- [CLI commands](../cli/cli-commands.md) — every `warlock` command.
