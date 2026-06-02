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

| You want to...                                       | File                                  |
| ---------------------------------------------------- | ------------------------------------- |
| Change the HTTP port your app listens on             | `src/config/http.ts` → `port: ...`    |
| Add a new CLI command to `yarn warlock`              | `warlock.config.ts` → `cli.commands`  |
| Configure your cache driver                          | `src/config/cache.ts`                 |
| Skip dev-server health checks                        | `warlock.config.ts` → `devServer.healthCheckers: false` |
| Pull migrations from `@warlock.js/auth`              | `warlock.config.ts` → `database.migrations` |
| Set mailer SMTP credentials                          | `src/config/mail.ts`                  |
| Tune the production bundler's minify/sourcemap       | `warlock.config.ts` → `build`         |

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
  outDirectory: "dist",
  outFile: "app.js",
  minify: true,
  sourcemap: true,
}
```

| Field           | Default                  | Purpose                                                                 |
| --------------- | ------------------------ | ----------------------------------------------------------------------- |
| `outDirectory`  | `<cwd>/dist`             | Where the bundled output goes                                           |
| `outFile`       | `"app.js"`               | The name of the bundled file                                            |
| `minify`        | `true`                   | Whether the production bundle is minified                               |
| `sourcemap`     | `true`                   | Sourcemap mode — `true`, `false`, `"inline"`, or `"linked"`             |

`sourcemap: true` produces a `.js.map` next to the bundle (linked). `"inline"` embeds the sourcemap into the bundle (larger but no separate file). Set it to `false` only if you're shipping to an environment where source maps would leak source code via debuggers.

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

Each entry is a `CLICommand` produced by a framework helper or package. The reference codebase pulls two from `@warlock.js/auth` — they show up as `yarn warlock auth.generateJWTSecret` and `yarn warlock auth.cleanup` after this file loads.

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

| Field                  | Default                                                                    | Purpose                                                          |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `watch.include`        | `["**/*.{ts,tsx}"]`                                                        | Glob patterns the file watcher tracks                            |
| `watch.exclude`        | `["**/node_modules/**", "**/dist/**", "**/.warlock/**", "**/.git/**"]`     | Patterns to ignore                                               |
| `healthCheckers`       | (enabled with defaults)                                                    | Array of file health checkers, or `false` to disable             |
| `generateTypings`      | `true`                                                                     | Auto-regenerate ConfigRegistry / route typings on dev-server boot |
| `transpileCacheDebug`  | `false`                                                                    | Name cache files by source path for debugging the transpile cache|

You'll usually leave these alone. The defaults are tuned for typical TypeScript projects.

`healthCheckers: false` is for projects with custom build steps that interfere with the framework's health checks (the reference codebase sets this because it has unusual layout).

`generateTypings: false` skips the typings regeneration at dev-server boot. Speeds up cold starts in big projects; turn off only if you don't rely on the autocomplete it produces.

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

After this, `yarn warlock migrate` runs both the project's discovered migrations and these package migrations in order.

### `testing` — test discovery (optional)

```ts
testing: {
  include: ["src/shared/**/*.test.ts"],
  exclude: ["**/*.integration.test.ts"],
}
```

Additional globs for the test runner. Most apps don't need this — the defaults pick up `**/*.spec.ts` and `**/*.test.ts` everywhere. Use this when your project has a non-standard test location (a shared test root, integration tests in a separate folder, etc.).

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
import { defineConfig } from "@warlock.js/core";              // ✅ framework helper
import { authMigrations } from "@warlock.js/auth";            // ✅ package export
import { join } from "node:path";                             // ✅ Node builtin
```

But not:

```ts
import { config } from "@warlock.js/core";                    // ❌ not yet loaded
import { User } from "src/app/users/models/user";             // ❌ app code not imported
```

If you find yourself wanting one of these in `warlock.config.ts`, you've probably mixed up which config layer this is. Push the read to `src/config/*` or to module init code.

## HMR reload behaviour

`warlock.config.ts` is one of the watched files in the dev server. When you save it:

1. The dev server re-imports `warlock.config.ts`.
2. The framework picks up the new values.
3. Some changes apply immediately (dev-server flags like `transpileCacheDebug`).
4. Some changes require a hard restart of the dev server (server port, build flags).
5. CLI command changes take effect on the next `yarn warlock <command>` invocation; running commands aren't restarted.

In practice, the safe pattern: when you change `warlock.config.ts`, stop the dev server (Ctrl+C) and restart. The reload story is best-effort and not every field is HMR-friendly.

## Common patterns

### Per-environment build tuning

```ts
import { defineConfig } from "@warlock.js/core";

const isCI = process.env.CI === "true";

export default defineConfig({
  build: {
    minify: !isCI,             // skip minify during CI builds (faster, easier to diff)
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

Each command factory returns a `CLICommand`. The framework registers them under `yarn warlock <namespace>.<name>`.

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
