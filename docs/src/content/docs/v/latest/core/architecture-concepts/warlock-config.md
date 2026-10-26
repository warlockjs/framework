---
title: "warlock.config.ts"
description: The project-level config the framework reads — server, build, dev server, CLI commands, package migrations. Loads before any subsystem, types itself via defineConfig.
sidebar:
  order: 5
  label: "warlock.config.ts"
---

`warlock.config.ts` is the project-level config the framework reads before anything else. It sits at the project root next to `package.json` and answers a different question from `src/config/*` — not "how does my mailer work?" but "how does the framework itself behave on this project?"

Server port to listen on (when no `src/config/http.ts` sets one). Build output for the production bundler. Dev-server file-watch globs. Custom CLI commands your project adds to the `warlock` binary. Package-level migrations from third-party libraries that aren't auto-discovered. All of these live here.

This page covers every field, when to use this file vs. `src/config/*`, and the gotchas around it loading earlier than your app code.

## The 30-second look

```ts title="warlock.config.ts"
import {
  authMigrations,
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    healthCheckers: false,
    generateTypings: false,
  },
  cli: {
    commands: [registerJWTSecretGeneratorCommand(), registerAuthCleanupCommand()],
  },
  build: {
    minify: true,
  },
  database: {
    migrations: authMigrations,
  },
});
```

That's the actual `warlock.config.ts` from the reference codebase. Four fields, all opt-in — every one has sensible defaults.

The export is `defineConfig(...)` — a helper that gives you full type inference on the object literal. You can technically `export default { ... }` directly with the right typings imported, but `defineConfig` is the conventional path.

## When to use this file

The contrast with `src/config/*`:

| You want to...                                 | File                                                    |
| ---------------------------------------------- | ------------------------------------------------------- |
| Change the HTTP port your app listens on       | `src/config/http.ts` → `port: ...`                      |
| Add a new CLI command to `npx warlock`         | `warlock.config.ts` → `cli.commands`                    |
| Configure your cache driver                    | `src/config/cache.ts`                                   |
| Skip dev-server health checks                  | `warlock.config.ts` → `devServer.healthCheckers: false` |
| Pull migrations from `@warlock.js/auth`        | `warlock.config.ts` → `database.migrations`             |
| Set mailer SMTP credentials                    | `src/config/mail.ts`                                    |
| Tune the production bundler's minify/sourcemap | `warlock.config.ts` → `build`                           |

The shorthand: `warlock.config.ts` is the framework's setup; `src/config/*` is the app's setup. If a config field is consumed by the framework BEFORE app code loads (the dev server, the build pipeline, the CLI, migrations the framework discovers at startup), it lives here. Otherwise it lives in `src/config/*`.

## The full surface

`defineConfig({...})` takes a `WarlockConfig` shape. Every field is optional.

### `server` — top-level server hints

```ts
server: {
  port: 3000,
  host: "0.0.0.0",
  retryOtherPort: true,
}
```

| Field            | Purpose                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `port`           | Default port the framework binds to when no `src/config/http.ts` overrides |
| `host`           | Bind address — `localhost`, `0.0.0.0`, or any specific IP                  |
| `retryOtherPort` | If the configured port is in use, try the next port up                     |

Usually you set the port in `src/config/http.ts` via `env("HTTP_PORT", 3000)` instead — that gives you per-environment control. `warlock.config.ts → server.port` is for when you want a project-default that doesn't depend on `.env`.

### `build` — production bundler

```ts
build: {
  outdir: "dist",
  outFile: "app.js",
  minify: true,
  sourcemap: true,
}
```

| Field          | Default      | Purpose                                                              |
| -------------- | ------------ | -------------------------------------------------------------------- |
| `outdir`       | `<cwd>/dist` | Where the bundled output goes (alias: `outDirectory`)                |
| `outFile`      | `"app.js"`   | The name of the bundled file                                         |
| `minify`       | `true`       | Whether the production bundle is minified                            |
| `sourcemap`    | `true`       | Sourcemap mode — `true`, `false`, `"inline"`, or `"linked"`          |
| `singleBundle` | `false`      | Inline dependencies into one runnable file — see below               |
| `esmShim`      | `true`       | Recreate `require` / `__filename` / `__dirname` for bundled CommonJS |

`outDirectory` is accepted as an alias for `outdir`. Earlier docs used that name while the code only ever read `outdir`, so configs written from them were silently ignored — both work now, and `outdir` wins if you set both.

`sourcemap: true` produces a `.js.map` next to the bundle (linked). `"inline"` embeds the sourcemap into the bundle (larger but no separate file). Set it to `false` only if you're shipping to an environment where source maps would leak source code via debuggers.

#### `singleBundle` — one file you can just run

By default the bundle keeps your dependencies as real `import` specifiers and resolves them from `node_modules` at runtime. That's what you want when you deploy the folder. When you'd rather ship **one file**, set:

```ts
build: {
  singleBundle: true,
}
```

```bash
warlock build
node dist/app.js        # no node_modules, no launcher
```

It sets `packages: "bundle"` and `splitting: false` **as defaults you can still override** — write `splitting: true` yourself and yours wins.

The output also works for an app that uses `@warlock.js/web`: the server pages and routes are inlined into `dist/app.js`, `React` and the framework packages are bundled, and the browser bundle sits in `dist/client/`. Copy `dist/` anywhere and run `node app.js`; the process finds its `client/` folder next to the bundle, whatever its working directory is. The production server never loads Vite.

**Optional integrations need no `external` list.** The framework reaches S3, database drivers, mail transports, `jiti` and similar packages through `import()` calls that only run when you configure them. In a `singleBundle` build, an optional peer (or optional dependency) that a framework package lists, that your `package.json` does not declare and that is imported lazily stays a lazy runtime import instead of failing the bundle. The build prints the list. "Declares" means `dependencies`, `optionalDependencies` or `peerDependencies`; a package that only appears in `devDependencies` is not part of what runs in production, so it does not count. A package your app declares is always bundled, and anything your own code imports that cannot be resolved still fails the build.

**Native addons are staged for you.** Packages with a compiled `.node` binary (and napi loaders whose platform package holds one) cannot be inlined. The build keeps them external and copies each into `dist/node_modules/<package>`, with only what it needs to load (its JavaScript, binaries and data files, the dependencies it loads and the platform packages that match the build machine), and names them in the build output. Build on the platform you deploy to. Because `dist/node_modules` sits beside `app.js`, `node dist/app.js` finds them with no `node_modules` anywhere above `dist/`.

**Aliased native packages keep the name that is imported.** The package is copied to `dist/node_modules/<name>` where `<name>` is the name the code imports, which is the folder name in `node_modules`. With `"node-pty": "npm:@lydell/node-pty"` in your `package.json`, the build stages `dist/node_modules/node-pty` (its own `package.json` still says `@lydell/node-pty`), so `import("node-pty")` resolves from `dist/`. Only native packages that the finished bundle still imports are staged. If a native package cannot be copied, for example because its `os` or `cpu` fields exclude the build machine, or one of its dependencies is not on disk, the build prints a warning that names it instead of skipping it silently.

**Build-time tools are never bundled or staged.** `vite`, `rolldown`, `lightningcss`, `esbuild`, `oxc-parser`, `@vitejs/*`, `@babel/*` (except `@babel/runtime`) and their platform packages are used to build and develop an app, not to run it. A lazy `import()` of one from any package stays a runtime import that a production server never reaches, a module-level import from a `@warlock.js/*` package stays external, and a module-level import of `oxc-parser` gets a module that throws if called. This holds even when you list one of them under `dependencies`, so you do not need to add `vite` to `build.external`. A third-party library that imports one of them at module level (for example a library that statically imports `@babel/parser`) needs it to run, so it is bundled like any other dependency. Your own source files are not affected: if your code imports one of these packages, it is resolved like any other.

Build-time tools that framework code imports but only the build and check commands call (the `oxc-parser` native parser) are left out and replaced by a module that throws if called, and the page scanner and Vite are not part of the bundle, so a typical app stages no native package at all. React's production build is selected: `process.env.NODE_ENV` is settled to `"production"` inside `react`, `react-dom` and `scheduler` only (set `process.env.NODE_ENV` in `build.define` to take over).

When the build finishes it prints the number of files and the total size of `dist/`.

`singleBundle` does not change how the browser bundle is built. For a desktop or offline app, see the [desktop and offline app recipe](../digging-deeper/deployment.md#desktop-and-offline-apps).

:::note[Imports in `warlock.config.ts` ship in the bundle]
The server bundle imports `warlock.config.ts` to register your connectors, so whatever that file imports is bundled too. Keep imports that only the build needs (Vite plugins, for example) in a module the config loads lazily.
:::

#### `esmShim` — why a bundled build used to crash at runtime

Warlock's production output is an ES module. Bundled CommonJS dependencies call `require(...)` and read `__dirname` to find their own assets, and **neither exists in an ES module** — so the bundler replaces them with a stub that throws:

```
Error: Dynamic require of "node:assert" is not supported
```

The build reported success; the process died on start. Warlock now injects a small prelude that recreates `require`, `__filename` and `__dirname` via `createRequire(import.meta.url)`.

**This applies to any ESM build, not just `singleBundle`** — so setting `packages: "bundle"` by hand works too. It's on by default; set `esmShim: false` only if you're certain nothing in your dependency graph is CommonJS. If you already hand-wrote a `banner` to do this, keep it: your banner is merged after the shim rather than replacing it.

### `cli` — custom commands

```ts
cli: {
  commands: [
    registerJWTSecretGeneratorCommand(),
    registerAuthCleanupCommand(),
    mySeedCommand(),
  ],
}
```

Each entry is a `CLICommand` produced by a framework helper or package. The reference codebase pulls two from `@warlock.js/auth` — they show up as `npx warlock auth.generateJWTSecret` and `npx warlock auth.cleanup` after this file loads.

Use this for:

- **CLI commands from external packages** that aren't auto-discovered (most `@warlock.js/*` packages export `registerXxxCommand()` factories).
- **Project-level commands** you've written that don't fit inside a module's scope (seeding the database from a fixture, generating sample data, project-wide diagnostics).

For module-internal CLI commands, keep them inside `src/app/<module>/commands/` and register from the module's `main.ts` — `warlock.config.ts` should stay free of module-level imports.

### `devServer` — dev-mode behaviour

```ts
devServer: {
  watch: {
    include: ["**/*.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
  healthCheckers: false,
  generateTypings: true,
  transpileCacheDebug: false,
}
```

| Field                   | Default                                                                | Purpose                                                            |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `watch.include`         | `["**/*.{ts,tsx}"]`                                                    | Glob patterns the file watcher tracks                              |
| `watch.exclude`         | `["**/node_modules/**", "**/dist/**", "**/.warlock/**", "**/.git/**"]` | Patterns to ignore                                                 |
| `healthCheckers`        | (enabled with defaults)                                                | Built-in switches, custom checker array, or `false` to disable     |
| `generateTypings`       | `true`                                                                 | Auto-regenerate ConfigRegistry / route typings on dev-server boot  |
| `checkForUpdates`       | `true`                                                                 | Check npm for a newer `@warlock.js/core` at dev-server start       |
| `restartOnConfigChange` | `true`                                                                 | Restart the dev server when `warlock.config.ts` or `.env*` changes |
| `transpileCacheDebug`   | `false`                                                                | Name cache files by source path for debugging the transpile cache  |

You'll usually leave these alone. The defaults are tuned for typical TypeScript projects.

`healthCheckers: false` disables every background file check; `warlock dev --skip-health` does the same for one run. An array still replaces the default list with custom checkers. For individual built-ins, use `healthCheckers: { typescript: true, oxlint: true }`. TypeScript runs by default; Oxlint needs its app-installed package and app-root configuration. See [background file health checks](../cli/file-health-checks).

`generateTypings: false` skips the typings regeneration at dev-server boot. Speeds up cold starts in big projects; turn off only if you don't rely on the autocomplete it produces.

`restartOnConfigChange: false` turns the automatic restart back into a warning. `warlock.config.ts` and `.env*` are read at boot, so a hot reload would leave your running services on stale values — the restart is what actually applies the change.

`transpileCacheDebug: true` names entries in `.warlock/transpile/` as `<slug>.<hash>.js` (last 3 path segments) and appends a `// @source <path>` marker — purely cosmetic, useful only when you're chasing a transpile cache bug.

### `database` — package migrations

```ts
database: {
  migrations: authMigrations,
}
```

Migrations from `src/app/<module>/models/<entity>/migrations/*.migration.ts` are auto-discovered. But migrations shipped INSIDE an external package — `@warlock.js/auth` ships its own auth-schema migrations, for instance — aren't on the disk you scan. This field is how you opt them into your project's migration runs.

The value is an array of `MigrationConstructor` (the class produced by `Migration` decorators in `@warlock.js/cascade`). External packages export named arrays you import:

```ts
import { authMigrations } from "@warlock.js/auth";

export default defineConfig({
  database: {
    migrations: authMigrations,
  },
});
```

If you need migrations from multiple packages, concatenate:

```ts
database: {
  migrations: [...authMigrations, ...analyticsMigrations],
}
```

After this, `npx warlock migrate` runs both the project's discovered migrations and these package migrations in order.

### `testing` — test discovery (optional)

```ts
testing: {
  include: ["src/shared/**/*.test.ts"],
  exclude: ["**/*.integration.test.ts"],
}
```

Additional globs for the test runner. Most apps don't need this — the defaults pick up `**/*.spec.ts` and `**/*.test.ts` everywhere. Use this when your project has a non-standard test location (a shared test root, integration tests in a separate folder, etc.).

### `release` — deploy pipeline

```ts
release: {
  gate: { checks: [{ name: "test", command: "npx warlock test" }] },
  restart: { command: "pm2 reload my-app" },
  verify: { url: "http://127.0.0.1:2030/health" },
}
```

Settings for `warlock release`: the gate checks, the migration proof targets, the restart command you own and the health URL to verify. Every field is optional. See [Deploying with `warlock release`](../cli/release.md).

## The `defineConfig` helper

```ts
import { defineConfig } from "@warlock.js/core";

export default defineConfig({ ... });
```

`defineConfig` does two things:

1. **Gives you type inference** on the object literal. IDE autocomplete works, typos become errors, you don't have to write `: WarlockConfig` annotations yourself.
2. **Merges with `defaultWarlockConfigurations`** — sane defaults for `build` (out dir, minify, sourcemap). Your config overrides on conflict.

The implementation is one line:

```ts
export function defineConfig(options: WarlockConfig) {
  return merge(defaultWarlockConfigurations, options);
}
```

There's no validation, no schema enforcement, no side effects. It's purely a typing helper plus a merge.

You can `export default { ... } as WarlockConfig` without `defineConfig` and it works — you just lose the default-merge and write the type annotation yourself. Most projects stick with `defineConfig`.

## When this file loads

Earlier than anything else. The framework reads `warlock.config.ts` before any subsystem connector starts, before `src/config/*` loads, before any app code imports. This matters because:

- **You can't `config.get(...)` from inside `warlock.config.ts`.** The subsystem configs aren't loaded yet.
- **You can't import from `src/app/*` either.** The app code doesn't run until after the framework reads this file.
- **You CAN import from `@warlock.js/*` packages, `node:*` builtins, and any utility module that doesn't depend on the subsystem configs.**

Practically, that means `warlock.config.ts` reads:

```ts
import { defineConfig } from "@warlock.js/core"; // ✅ framework helper
import { authMigrations } from "@warlock.js/auth"; // ✅ package export
import { join } from "node:path"; // ✅ Node builtin
```

But not:

```ts
import { config } from "@warlock.js/core"; // ❌ not yet loaded
import { User } from "src/app/users/models/user"; // ❌ app code not imported
```

If you find yourself wanting one of these in `warlock.config.ts`, you've probably mixed up which config layer this is. Push the read to `src/config/*` or to module init code.

### Local TypeScript imports

A config may import its own local TypeScript that does not depend on app state — a custom connector, a shared constant — written the TypeScript way, without an extension or through a tsconfig `paths` alias:

```ts
import { LocalConnector } from "./src/connectors/local"; // ✅ extensionless
import { storageRoot } from "app/shared/paths"; // ✅ tsconfig paths alias
```

`warlock dev` resolves these through its loader. Where the runtime cannot import the config as written — `build`/`start` on Node without native TypeScript, or native type stripping meeting an extensionless or aliased import, or TypeScript it cannot strip (an `enum`, a parameter property) — Core bundles the config with its **local** import graph through esbuild and imports that once:

- packages (`@warlock.js/*`, npm, `node:*`) stay real imports, so `BaseConnector`, the container and other registries are the application's own instances. A `paths` alias is inlined only when it resolves outside `node_modules`, so a catch-all pattern such as `"*": ["./types/*"]` never pulls a package into the bundle;
- each inlined module keeps its own `import.meta.url`, `import.meta.dirname` and `import.meta.filename`, so `new URL("./asset.json", import.meta.url)` still points beside that module. Only real `import.meta` expressions are replaced; the same words inside a string or comment are left alone. `import.meta.resolve()` is not rewritten: resolve from `import.meta.url` instead;
- an error thrown by your config is rethrown unchanged, and the temporary `.warlock.config.*.mjs` beside it is removed either way. A loading error in the bundled config (a missing package, say) names `warlock.config.ts`, not the temporary file.

A package that is genuinely not installed is not a fallback case: the native import's error is rethrown as is.

## HMR reload behaviour

`warlock.config.ts` is one of the watched files in the dev server. When you save it:

1. The dev server re-imports `warlock.config.ts`.
2. The framework picks up the new values.
3. Some changes apply immediately (dev-server flags like `transpileCacheDebug`).
4. Some changes require a hard restart of the dev server (server port, build flags).
5. CLI command changes take effect on the next `npx warlock <command>` invocation; running commands aren't restarted.

In practice, the safe pattern: when you change `warlock.config.ts`, stop the dev server (Ctrl+C) and restart. The reload story is best-effort and not every field is HMR-friendly.

## Common patterns

### Per-environment build tuning

```ts
import { defineConfig } from "@warlock.js/core";

const isCI = process.env.CI === "true";

export default defineConfig({
  build: {
    minify: !isCI, // skip minify during CI builds (faster, easier to diff)
    sourcemap: isCI ? "linked" : true,
  },
});
```

You can branch on `process.env` directly here because it's already loaded by the framework's startup script before `warlock.config.ts` runs. (Don't expect dotenv to be loaded yet, though — only the shell's env vars are reliable at this point.)

### Pulling migrations from multiple packages

```ts
import { authMigrations } from "@warlock.js/auth";
import { analyticsMigrations } from "@warlock.js/analytics";

export default defineConfig({
  database: {
    migrations: [...authMigrations, ...analyticsMigrations],
  },
});
```

The migration runner picks these up alongside your project's own auto-discovered migrations.

### Custom CLI command stack

```ts
import { defineConfig } from "@warlock.js/core";
import { generateSitemapCommand } from "./scripts/generate-sitemap";
import { rebuildSearchIndexCommand } from "./scripts/rebuild-search-index";

export default defineConfig({
  cli: {
    commands: [generateSitemapCommand(), rebuildSearchIndexCommand()],
  },
});
```

Each command factory returns a `CLICommand`. The framework registers them under `npx warlock <namespace>.<name>`.

### Tightening file watching

```ts
export default defineConfig({
  devServer: {
    watch: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.spec.ts", "src/legacy/**"],
    },
  },
});
```

Watch fewer files for a faster dev server, especially in monorepos where the default `**/*.{ts,tsx}` would track sibling packages.

## Gotchas

- **`config.key(...)` doesn't work here.** This file loads before `src/config/*`. If you need an env value, use `process.env.X` directly — and even then, only the SHELL env vars (not `.env`) are reliable, because dotenv hasn't loaded yet.
- **Imports from `src/app/*` will fail.** App code isn't loaded yet. Keep imports limited to `@warlock.js/*` packages and Node builtins.
- **HMR is best-effort.** Some fields apply instantly; some require a hard restart. When in doubt, restart.
- **Missing file = warning, not error.** If `warlock.config.ts` doesn't exist, the framework prints a "highly recommended to create it" warning and boots with default config. Most projects want the file even when most fields stay at defaults — keeps the option open.
- **No special handler hook for `warlock.config.ts`.** Unlike `src/config/*`, there's no `configSpecialHandlers.register(...)` equivalent here. The framework reads the values directly during boot.
- **Don't `await` anything that hits a subsystem.** No database calls, no fetches, no file I/O against project state. The whole file should be synchronous data — async imports are fine; async I/O is not.
- **`defineConfig` merges into framework defaults; it doesn't deeply merge with your own previous configs.** Calling `defineConfig({ build: { sourcemap: false } })` does NOT cumulatively merge with the default `build` — it overrides. If you want a partial override, spread the defaults yourself.

## See also

- **[`configuration-deep.md`](./configuration-deep.md)** — the parallel layer for app subsystem configs.
- **[`getting-started/03-configuration.md`](../getting-started/03-configuration.md)** — the two-layer overview.
- **[`bootstrap-and-connectors.md`](./bootstrap-and-connectors.md)** — when `warlock.config.ts` loads relative to bootstrap and the connectors.
- **[`application.md`](./application.md)** — `Application.runtimeStrategy` reflects whether you're in dev vs. the built bundle, which interacts with `build` settings.
