---
name: run-app
description: 'Three operational commands — `warlock dev` (HMR + type-gen + health checks), `warlock build` (esbuild bundle), `warlock start` (spawn the production bundle). All flags, all `warlock.config.ts` knobs that shape them. Triggers: `warlock dev`, `warlock build`, `warlock start`, `devServer`, `--fresh`, `--skip-typings`, `--skip-health`, `outdir`, `outFile`, `sourcemap`, `PortInUseError`, `assertPortIsAvailable`, `EADDRINUSE`; "start the dev server", "build for production", "run the bundle", "skip type generation", "tune watch globs", "dev server keyboard shortcuts", "press r to restart", "press q to quit", "restart the dev server", "port already in use"; typical config `warlock.config.ts > devServer / build`. Skip: writing a custom CLI — `@warlock.js/core/write-cli-command/SKILL.md`; config shape — `@warlock.js/core/configure-app/SKILL.md`; competing tooling `nodemon`, `tsx`, `ts-node-dev`, `esbuild` direct.'
---

# Warlock — run the app

Three commands move the app through its lifecycle: `dev` while you're editing, `build` once when you're ready to ship, `start` on the server. Each is a real `CLICommand` shipped in core — same factory and preload shape as any custom command you'd write.

## The shape

```bash
# Local development
yarn warlock dev

# Production build
yarn warlock build

# Run the built bundle
yarn warlock start
```

`dev` and `start` are **persistent** (long-running, no auto-exit). `build` is one-shot — it exits when the bundle is written.

## `warlock dev` — development server

Boots the framework in dev mode: file watcher, HMR-style module reload, on-disk transpile cache, background type generation, health checkers. The `runtimeStrategy` is set to `"development"` for the lifetime of the process.

### Flags

| Flag                  | Default | Purpose                                                                                                  |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `--fresh, -f`         | off     | Delete `.warlock/manifest.json` before start — forces a full re-parse from disk. Use after odd boot states. |
| `--skip-typings, -st` | off     | Skip background type generation **for this run**. Overrides `devServer.generateTypings` config.           |
| `--skip-health, -sh`  | off     | Skip file health checkers **for this run**. Overrides `devServer.healthCheckers` config.                  |

When a flag is **not** passed, the corresponding `warlock.config.ts > devServer.*` value applies. When passed, the flag wins.

### Keyboard shortcuts

Once the server is ready, `warlock dev` listens for single keypresses:

| Key      | Does                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| `r`      | Restart the server on a fresh process.                                     |
| `c`      | Clear the console.                                                         |
| `q`      | Graceful shutdown, exit `0` — the same path as `Ctrl+C`.                    |
| `h`      | Print the shortcuts that are armed right now.                              |
| `u`      | **Only while an update notice is showing** — update every `@warlock.js/*` package, install, and restart. See [`update-packages/SKILL.md`](../update-packages/SKILL.md). |
| `Ctrl+C` | Graceful shutdown, unchanged.                                              |

A "restart" is a fresh process (`r` and `u` both use it) — see [The supervisor](#the-supervisor) below for how that works.

Reading one key at a time needs stdin in **raw mode**, which takes `Ctrl+C` away from the terminal driver — the dev server re-raises `SIGINT` itself, and always leaves raw mode on shutdown (and while a package-manager install owns the terminal), so your shell is never left without line editing.

Shortcuts are **TTY-gated**: with piped stdin, in CI, or under a process supervisor, nothing is registered, no hint is printed, and stdin is never touched.

### The supervisor

`warlock dev` runs as **two processes**, not one:

```
shell
└─ warlock dev                      ← supervisor: owns the terminal, loads nothing
   └─ warlock dev (WARLOCK_DEV_WORKER=1)  ← the actual server, disposable
```

The supervisor spawns the worker with `stdio: "inherit"` and mirrors its exit code. To restart, the worker shuts down cleanly — freeing the http port — and exits `75`; the supervisor spawns a replacement. **The tree never gets deeper**, however many restarts happen.

The supervisor is chosen in the `dev` command's `preAction`, which runs *before* the preloaders — deliberately, so the supervisor never loads config or starts connectors. A supervisor holding a second database connection open for the session would be a real bug, not a cosmetic one.

Signals: `SIGINT` reaches the worker directly (same process group), so the supervisor ignores it and only notes that the next exit is final — acting on it would exit the parent while the worker was still draining. `SIGTERM` / `SIGHUP` are forwarded explicitly, since they don't propagate to the group on Windows. After any worker exits, the supervisor puts stdin back out of raw mode in case the worker was killed before it could.

`restartDevServer()` returns `false` instead of exiting when there is no supervisor — a programmatic `startDevelopmentServer()` call — so nothing kills a server it can't replace.

### Crash recovery

A worker that dies **after running healthily for at least 5s** — OOM, a native crash, a dead loader thread — is replaced automatically:

```
14:31:02 Development server was killed by SIGSEGV — restarting.
```

A worker that dies *sooner* than that failed to **boot** — a broken config, a port already taken — and it has already printed why. Restarting there would just reprint the same error and bury it, so the supervisor mirrors the exit code and stops.

A busy port is now caught *before* the bind attempt: the HTTP connector calls `assertPortIsAvailable(port, host)` immediately before `listen()`, so the failure is `Port <port> is already in use on <host>. Stop the dev server (or whatever else is listening on port <port>) and run again, or start on a free port…` — not a raw `EADDRINUSE` surfacing from inside Fastify. Same connector, same preflight, for `warlock start`.

Flapping is capped: more than 3 crashes inside 60s and the supervisor gives up rather than restarting behind your back.

An explicit restart (`r`, `u`, a config change) is a *request*, not a crash, so the uptime rule never swallows it.

### Restart on config change

`warlock.config.ts` and `.env*` are read at boot and feed every config that derives from them, so they cannot be hot-reloaded — a "reload" would leave running services on stale values. When one changes, the dev server restarts itself:

```
14:22:07 warlock.config.ts changed — restarting to apply.
```

Set `devServer.restartOnConfigChange: false` for the previous behaviour (a warning telling you to restart yourself). The same warning is printed if a restart is declined or isn't possible, and any ordinary code files that shared the batch still hot-reload normally.

### The generated loader hook

On first boot `warlock dev` bundles its ESM loader hook and writes it to **your project's** `.warlock/loader-hook.mjs` — the hook runs in a fresh Node worker thread with no TypeScript loader of its own, so it has to be plain, pre-bundled ESM.

Because that file lives in your directory rather than core's, every npm import inside it is rewritten at generation time to an **absolute path resolved from core's own install**. A bare `import "esbuild"` there would resolve from *your* `node_modules`, and `esbuild` / `get-tsconfig` are core's dependencies, not yours.

:::note[Fixed in 4.9.2 — pnpm users]
Before 4.9.2 those imports were left bare. npm and yarn hoist every transitive dependency into one flat tree, so they resolved by accident; pnpm's strict layout does not, and the dev server failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`. The workaround was declaring `esbuild` and `get-tsconfig` in your own `package.json` — no longer needed, and you can drop them.
:::

### What it preloads

```ts
preload: {
  runtimeStrategy: "development",
  config: true,        // all src/config/*.ts
  bootstrap: true,     // env + app + prestart hooks
  prestart: true,      // src/app/prestart.ts if present
  connectors: true,    // Early-phase connectors only (db, cache, logger, ...)
}
```

HTTP + Socket connectors are **Late** phase — they boot later in the dev-server startup sequence, after app modules load. That ordering is what guarantees `app.http` / `app.socket` are live by the time your `main.ts` runs.

**Runs on any Node version.** `warlock.config.ts` is loaded by transpiling it with esbuild when the runtime can't import `.ts` natively (Node < 22.18 / < 23.6) — so `build`/`start` work on older production Node without `--experimental-strip-types` or a newer Node.

**Boot failures are fatal and loud.** Anything that throws during preload — a bad import in a `src/config/*.ts` file, a removed package export, a connector that fails to start — stops `dev`/`start` immediately with the error message and the offending file/line, then exits `1`. A common cause is upgrading `@warlock.js/*` and hitting a removed export (e.g. a config file that pulls in a model importing a symbol the new version no longer exports). If `warlock dev` ever just freezes right after the banner with no message, treat it as a bug and report it — preload errors are meant to print, never hang.

### `devServer.*` config knobs

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    watch: {
      include: ["**/*.{ts,tsx}"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/.warlock/**", "**/.git/**"],
    },
    generateTypings: true,             // background type generation
    checkForUpdates: true,             // notify on a newer @warlock.js/core at dev start
    restartOnConfigChange: true,       // restart when warlock.config.ts / .env* changes
    healthCheckers: [...] /* or false */,
    transpileCacheDebug: false,        // name cache files <slug>.<hash>.js w/ // @source markers
  },
});
```

- **`watch.include` / `watch.exclude`** — globs piped into the file watcher. Override when you have non-`.ts(x)` files driving reloads (e.g. SQL fixtures), or to exclude a generated folder.
- **`generateTypings`** — turn off if you're committing generated typings and don't want them rewritten on every boot. The `--skip-typings` flag is the per-run version.
- **`healthCheckers`** — custom file health checker contracts (or `false` to disable). The `--skip-health` flag is the per-run version.
- **`transpileCacheDebug`** — diagnostic only. Names `.warlock/transpile/*.js` files `<slug>.<hash>.js` and appends `// @source <path>` markers so you can eyeball which cache entry came from which source. Leave off in normal use.
- **`checkForUpdates`** — on `warlock dev` start, check npm for a newer `@warlock.js/core` and print a one-line notice if one exists. Best-effort and non-blocking; auto-skipped in CI and non-TTY shells. In an interactive terminal the notice arms a **`u` shortcut** that updates every `@warlock.js/*` package, installs, and restarts the server; elsewhere it prints `npx warlock update` instead. The registry answer is cached for 24h in `.warlock/update-check.json`, so a day of restarts costs one lookup. See [`update-packages/SKILL.md`](../update-packages/SKILL.md).
- **`restartOnConfigChange`** — restart the dev server when `warlock.config.ts` or any `.env*` changes (default `true`). Set `false` to get a warning instead and restart by hand. Neither file can be hot-reloaded, so without a restart the running services keep the old values.

## `warlock build` — production bundle

esbuild bundle of the app down to a single JS file in `dist/`. No flags — every setting comes from `warlock.config.ts > build`.

### `build.*` config knobs

```ts title="warlock.config.ts"
export default defineConfig({
  build: {
    outdir: "dist",        // default — relative or absolute
    outFile: "app.js",            // default — bundle filename
    minify: true,                 // default — esbuild minify
    sourcemap: true,              // default — true | false | "inline" | "linked"
    singleBundle: false,          // default — one runnable file, deps inlined
    esmShim: true,                // default — require/__filename/__dirname for bundled CJS
  },
});
```

Defaults are sensible for the typical "Node service" deployment. Knobs to actually reach for:

- **`outdir`** — override when your deployment pipeline expects a different folder (e.g. `build/`, `.build/`). `outDirectory` is accepted as an alias (the docs used that name for several releases while the code only read `outdir`); `outdir` wins if both are set.
- **`outFile`** — override when bundling multiple Warlock apps into one image and they need distinct entry filenames.
- **`minify: false`** — flip to debug a production-only bug. Larger bundle, readable stack traces.
- **`sourcemap: "inline"`** — embed the source map in the bundle. Useful when your error reporter only captures the bundle and can't fetch a `.map` sidecar.
- **`sourcemap: false`** — skip source maps entirely. Smaller artifact, but stack traces in production logs lose their file:line precision (and `warlock start` will not enable `--enable-source-maps` since there's nothing to map).
- **`singleBundle: true`** — inline dependencies so `node dist/app.js` runs with no `node_modules` and no launcher. Sets `packages: "bundle"` + `splitting: false` as **defaults you can override**. ⚠ Native `.node` addons are still emitted alongside — "single bundle" is one JS file *plus* any native addons. Do NOT reach for it as the default: keeping deps external is right when you deploy the folder.
- **`esmShim: false`** — only if you are certain nothing in the graph is CommonJS. Leave it on.

⚠ **The trap this replaced.** Setting `packages: "bundle"` by hand used to produce a clean build whose process died on start with `Error: Dynamic require of "node:assert" is not supported`. The output is ESM; bundled CJS deps call `require(...)` and read `__dirname`, and neither exists in an ES module, so the bundler substitutes a throwing stub. **A green `warlock build` was not evidence the bundle ran.** `esmShim` now injects `createRequire(import.meta.url)` and friends automatically for any ESM build, so both `singleBundle` and a hand-written `packages: "bundle"` work. An existing hand-written `banner` is preserved — the shim is prepended, not substituted.

### What it preloads

Just `warlockConfig: true`. Build doesn't need the app booted — it reads `warlock.config.ts`, runs esbuild, writes the file. Fast.

### Where the bundle lands

```
<cwd>/<outdir>/<outFile>
└─ default: <cwd>/dist/app.js
```

`warlock start` uses the same `resolveBuildConfig()` helper to find the bundle, so the two commands stay in sync no matter how you override the config. If `build` and `start` disagree on where the bundle is, it's because `warlock.config.ts` is being read with different cwds — never the case in normal operation.

If the app uses `@warlock.js/web` page routes, a successful `warlock build` also writes `page-routes.manifest.json` next to the bundle (same `outdir`) — the snapshot `warlock routes:diff` compares the live dev surface against. See [`warlock-routes/SKILL.md`](../warlock-routes/SKILL.md#warlock-routesdiff--catch-page-route-drift-before-it-ships).

## `warlock start` — run the production bundle

Spawns `node <entryPath>` as a child process, forwarding signals (SIGINT / SIGTERM). `entryPath` is resolved from the same `build` config that produced the bundle.

### Behavior

```bash
yarn warlock start                        # → spawns node --enable-source-maps dist/app.js
yarn warlock start --inspect              # → spawns node --enable-source-maps --inspect dist/app.js
yarn warlock start --max-old-space-size=4096  # → spawns node --enable-source-maps --max-old-space-size=4096 dist/app.js
```

Everything you pass after `start` is forwarded to the spawned Node process. Use this to attach a debugger (`--inspect`), tune memory (`--max-old-space-size`), or pass any other Node flag without editing the command.

### Source maps

If `build.sourcemap !== false`, `warlock start` adds `--enable-source-maps` automatically. You see real `.ts` paths and lines in stack traces. If you set `sourcemap: false` in build config, source maps stay off in `start` too — the two configs are tied.

### What it preloads

Just `warlockConfig: true` — same as `build`. The actual app bootstrap happens inside the spawned child process, when the bundle imports and runs framework startup.

### Signal handling

- `SIGINT` (Ctrl+C) — passes through to the child naturally; both processes get it. The parent waits for the child to exit, then exits with the child's code.
- `SIGTERM` — explicitly forwarded to the child by the parent (Windows doesn't auto-propagate this one).

Means `docker stop` / `kubectl delete pod` works as expected: SIGTERM reaches the bundle, your graceful-shutdown hooks fire, then the parent exits.

### pnpm needs esbuild's install script allowed

pnpm 10+ will not run a dependency's install script unless the app names it. esbuild's script links its platform-native binary, and `warlock build` shells out to that binary — so the app installs cleanly and then cannot build:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.7
```

Fix it once in the app's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```

Note pnpm reads this from `pnpm-workspace.yaml`, **not** from `package.json`'s `pnpm` field — pnpm 11 warns that the field is ignored and then carries on, so settings left there fail silently.

Nothing else is needed for pnpm. Warlock never requires an app to declare a package it does not import: generated code is checked at build time against the app's own `dependencies`, so `warlock build` failing over an unfamiliar package name is a framework bug, not a missing dependency.

### Output streams — what a supervisor may trust

**A success line on stdout means the app is serving requests.** That is a contract, not a convention, and you can build a CI gate or a health probe on it.

| Stream     | Carries                                                        |
| ---------- | -------------------------------------------------------------- |
| **stdout** | the started banner, and start failures. Nothing else.           |
| **stderr** | progress (`🚀 Starting production server...`), diagnostics, the application's own logs |

The started banner prints **only** when the running application reports a completed boot — not when the command starts, not when the child is spawned. A child that dies before reporting is a failed start: the failure is written to **both** streams (stderr for humans and log collectors, stdout so a supervisor greping for the banner finds a failure rather than silence), and `warlock start` exits non-zero **even when the child itself exited `0`**.

```bash
# a CI gate can be this blunt, and it is now correct
yarn warlock start | grep -q "production server started"
```

### How readiness is reported

`warlock start` spawns the bundle with an IPC channel and sets `WARLOCK_BOOT_SIGNAL=1` on it. `Application.markBooted()` — which the production entry calls after the late-phase connectors (http, socket) are up — sends one versioned message and closes the channel:

```ts
{ type: "warlock:ready", version: 1, pid, at, environment, runtimeStrategy, bootDurationMs?, port? }
```

Three consequences worth knowing:

1. **A queue worker with no http connector still reports.** Readiness hangs on a completed boot, not on a bound port. `port` is simply absent.
2. **Running the bundle any other way changes nothing.** `node dist/app.js`, a Docker `CMD`, or pm2 — the signal is a strict no-op without both the IPC channel and the handshake flag, so Warlock never writes into a channel that belongs to another supervisor.
3. **A bundle built before 4.11.0 has no signal.** It starts and runs normally, and after ten seconds prints a note on **stderr only** telling you to re-run `warlock build`. An absent signal is never an error, never fails the run, and never kills a slow boot.

If you need the same fact inside the app, use `Application.onceBooted()` / `Application.whenBooted()` — the signal and your listeners fire from the same latch.

## Picking which mode you're in

`Application.environment` and `Application.runtimeStrategy` are separate axes:

| Mode             | `environment`   | `runtimeStrategy` | How                                       |
| ---------------- | --------------- | ----------------- | ----------------------------------------- |
| `warlock dev`    | `development`*  | `development`     | preload force-sets `runtimeStrategy`      |
| `warlock build`  | n/a (no app boots) | n/a            | only loads warlock.config.ts              |
| `warlock start`  | `production`*   | `production`*     | usually set via `NODE_ENV` in the env     |

`*` — `environment` follows `NODE_ENV`. The dev command doesn't force it, but the default in most projects is `development`. `start` doesn't force it either; deployments set `NODE_ENV=production` themselves.

If you need conditional behavior, branch on `Application.environment` (the orthogonal "what world am I talking to?" axis), not `runtimeStrategy` (the "how is the framework itself running?" axis). See [`use-app-context/SKILL.md`](../use-app-context/SKILL.md).

## Common patterns

### Standard `package.json` scripts

```json title="package.json"
{
  "scripts": {
    "dev": "warlock dev",
    "build": "warlock build",
    "start": "warlock start"
  }
}
```

Now `yarn dev` / `yarn build` / `yarn start`. Standard Node hosting providers (Render, Fly, Railway, Heroku) recognize this layout.

### Production Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn warlock build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/warlock.config.ts ./
ENV NODE_ENV=production
CMD ["yarn", "warlock", "start"]
```

Two-stage build trims `devDependencies` out of the runtime image. Keep `warlock.config.ts` in the runtime stage — `start` reads it to resolve the bundle path.

### Bundle into a different folder per environment

```ts title="warlock.config.ts"
import { defineConfig, env } from "@warlock.js/core";

export default defineConfig({
  build: {
    outdir: env("BUILD_OUT", "dist"),
    outFile: env("BUILD_FILE", "app.js"),
  },
});
```

CI sets `BUILD_OUT=build/<sha>` per pipeline. `warlock start` reads the same config and finds the bundle without any hardcoded paths.

**This recipe only started working in 4.11.0.** Before that, `warlock.config.ts` was evaluated *before* any `.env` file was read, so every `env()` call in it returned its default — silently, under every command. If you copied this recipe earlier and concluded that `BUILD_OUT` was ignored, it was.

**Which file the value comes from is decided by `NODE_ENV`, and no Warlock command sets it.** `env()` reads `.env.<NODE_ENV>` when that file exists and falls back to plain `.env`. So:

```bash
warlock build                       # NODE_ENV unset → reads .env
NODE_ENV=production warlock build   # → reads .env.production
NODE_ENV=staging warlock build      # → reads .env.staging
```

That is deliberate: `build` and `start` do **not** force `production`. Forcing it would silently change which file an existing `NODE_ENV=staging` pipeline reads, and would have the framework overriding an operator's explicit choice at the moment of deployment. Set `NODE_ENV` in your Dockerfile, CI job, or process manager — the same place you already set it for `Application.environment`.

### Skip type-gen on machines without write access

```bash
yarn warlock dev --skip-typings
```

Or persist it:

```ts title="warlock.config.ts"
export default defineConfig({
  devServer: {
    generateTypings: false,
  },
});
```

Useful in a containerized dev environment where `.warlock/typings.d.ts` is read-only.

### Memory-tune the production process

```bash
yarn warlock start --max-old-space-size=4096
```

Or via `NODE_OPTIONS` in the deployment env if you don't want to change the start invocation:

```bash
NODE_OPTIONS=--max-old-space-size=4096 yarn warlock start
```

## Gotchas

- **`warlock dev` is persistent — `Ctrl+C` to stop.** The framework's `persistent: true` flag keeps the process alive after `action` returns. Same for `start`.
- **`--fresh` only deletes the manifest, not the transpile cache.** If you're chasing a stale-compile bug, `rm -rf .warlock/` clears everything. The manifest restoring is what `--fresh` solves.
- **`warlock build` does NOT run migrations.** Production bundles ship the migration files but don't apply them. Run `yarn warlock migrate` against the production DB separately.
- **`warlock start` requires a built bundle.** Run `warlock build` first, or you'll spawn `node` against a non-existent file and crash immediately.
- **`outdir` is the directory, `outFile` is the filename within it.** A common mistake is putting the full path in one and leaving the other default — you end up with `<full-path>/app.js` or `dist/<full-path>`. They concatenate.
- **`sourcemap: false` cascades to `start`.** Stack traces lose `.ts` precision. Keep sourcemaps on unless artifact size is a hard constraint.
- **`NODE_ENV` is not set by these commands.** The deployment env (your Dockerfile, CI, hosting provider) sets it. Forget it on a production server and `Application.isProduction` returns `false`, which flips cookie security, CORS, logging — silently. Always set `NODE_ENV=production` in production deployments.
- **`prestart` runs once on dev boot, not on reload.** If you're seeding test data in `src/app/prestart.ts`, it fires on `warlock dev` startup only. HMR reloads don't re-run it.

## See also

- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — author a custom CLI command + the rest of the built-in commands (migrate / seed / generate.* / add / storage.put / jwt.generate).
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `warlock.config.ts` shape and `defineConfig`.
- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — `Application.environment` vs `Application.runtimeStrategy`.
- [`add-connector/SKILL.md`](../add-connector/SKILL.md) — Early vs Late connector phases (why HTTP/socket boot late in dev).
- [`update-packages/SKILL.md`](../update-packages/SKILL.md) — `warlock update` + the dev-server update notice (`devServer.checkForUpdates`).
- [`warlock-routes/SKILL.md`](../warlock-routes/SKILL.md) — `warlock routes` / `warlock routes:diff`, the latter comparing live page routes against the manifest `warlock build` writes.
