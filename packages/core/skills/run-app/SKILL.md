---
name: run-app
description: 'Three operational commands — `warlock dev` (HMR + type-gen + health checks), `warlock build` (esbuild bundle), `warlock start` (spawn the production bundle). All flags, all `warlock.config.ts` knobs that shape them. Triggers: `warlock dev`, `warlock build`, `warlock start`, `devServer`, `--fresh`, `--skip-typings`, `--skip-health`, `outDirectory`, `outFile`, `sourcemap`; "start the dev server", "build for production", "run the bundle", "skip type generation", "tune watch globs"; typical config `warlock.config.ts > devServer / build`. Skip: writing a custom CLI — `@warlock.js/core/write-cli-command/SKILL.md`; config shape — `@warlock.js/core/configure-app/SKILL.md`; competing tooling `nodemon`, `tsx`, `ts-node-dev`, `esbuild` direct.'
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
    healthCheckers: [...] /* or false */,
    transpileCacheDebug: false,        // name cache files <slug>.<hash>.js w/ // @source markers
  },
});
```

- **`watch.include` / `watch.exclude`** — globs piped into the file watcher. Override when you have non-`.ts(x)` files driving reloads (e.g. SQL fixtures), or to exclude a generated folder.
- **`generateTypings`** — turn off if you're committing generated typings and don't want them rewritten on every boot. The `--skip-typings` flag is the per-run version.
- **`healthCheckers`** — custom file health checker contracts (or `false` to disable). The `--skip-health` flag is the per-run version.
- **`transpileCacheDebug`** — diagnostic only. Names `.warlock/transpile/*.js` files `<slug>.<hash>.js` and appends `// @source <path>` markers so you can eyeball which cache entry came from which source. Leave off in normal use.
- **`checkForUpdates`** — on `warlock dev` start, check npm for a newer `@warlock.js/core` and print a one-line notice if one exists. Best-effort and non-blocking; auto-skipped in CI and non-TTY shells. Run `warlock update` to upgrade. See [`update-packages/SKILL.md`](../update-packages/SKILL.md).

## `warlock build` — production bundle

esbuild bundle of the app down to a single JS file in `dist/`. No flags — every setting comes from `warlock.config.ts > build`.

### `build.*` config knobs

```ts title="warlock.config.ts"
export default defineConfig({
  build: {
    outDirectory: "dist",        // default — relative or absolute
    outFile: "app.js",            // default — bundle filename
    minify: true,                 // default — esbuild minify
    sourcemap: true,              // default — true | false | "inline" | "linked"
  },
});
```

Defaults are sensible for the typical "Node service" deployment. Knobs to actually reach for:

- **`outDirectory`** — override when your deployment pipeline expects a different folder (e.g. `build/`, `.build/`).
- **`outFile`** — override when bundling multiple Warlock apps into one image and they need distinct entry filenames.
- **`minify: false`** — flip to debug a production-only bug. Larger bundle, readable stack traces.
- **`sourcemap: "inline"`** — embed the source map in the bundle. Useful when your error reporter only captures the bundle and can't fetch a `.map` sidecar.
- **`sourcemap: false`** — skip source maps entirely. Smaller artifact, but stack traces in production logs lose their file:line precision (and `warlock start` will not enable `--enable-source-maps` since there's nothing to map).

### What it preloads

Just `warlockConfig: true`. Build doesn't need the app booted — it reads `warlock.config.ts`, runs esbuild, writes the file. Fast.

### Where the bundle lands

```
<cwd>/<outDirectory>/<outFile>
└─ default: <cwd>/dist/app.js
```

`warlock start` uses the same `resolveBuildConfig()` helper to find the bundle, so the two commands stay in sync no matter how you override the config. If `build` and `start` disagree on where the bundle is, it's because `warlock.config.ts` is being read with different cwds — never the case in normal operation.

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
    outDirectory: env("BUILD_OUT", "dist"),
    outFile: env("BUILD_FILE", "app.js"),
  },
});
```

CI sets `BUILD_OUT=build/<sha>` per pipeline. `warlock start` reads the same config and finds the bundle without any hardcoded paths.

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
- **`outDirectory` is the directory, `outFile` is the filename within it.** A common mistake is putting the full path in one and leaving the other default — you end up with `<full-path>/app.js` or `dist/<full-path>`. They concatenate.
- **`sourcemap: false` cascades to `start`.** Stack traces lose `.ts` precision. Keep sourcemaps on unless artifact size is a hard constraint.
- **`NODE_ENV` is not set by these commands.** The deployment env (your Dockerfile, CI, hosting provider) sets it. Forget it on a production server and `Application.isProduction` returns `false`, which flips cookie security, CORS, logging — silently. Always set `NODE_ENV=production` in production deployments.
- **`prestart` runs once on dev boot, not on reload.** If you're seeding test data in `src/app/prestart.ts`, it fires on `warlock dev` startup only. HMR reloads don't re-run it.

## See also

- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — author a custom CLI command + the rest of the built-in commands (migrate / seed / generate.* / add / storage.put / jwt.generate).
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `warlock.config.ts` shape and `defineConfig`.
- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — `Application.environment` vs `Application.runtimeStrategy`.
- [`add-connector/SKILL.md`](../add-connector/SKILL.md) — Early vs Late connector phases (why HTTP/socket boot late in dev).
- [`update-packages/SKILL.md`](../update-packages/SKILL.md) — `warlock update` + the dev-server update notice (`devServer.checkForUpdates`).
