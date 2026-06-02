---
title: "Configuration"
description: Warlock has two config layers — warlock.config.ts at the project root and src/config/* per subsystem — both driven by .env values.
sidebar:
  order: 3
  label: "Configuration"
---

Warlock splits configuration into two layers. They have different shapes and different jobs, and once you've seen both you'll never confuse them again.

| Layer                  | Where                  | What it controls                                                      | Loaded by            |
| ---------------------- | ---------------------- | --------------------------------------------------------------------- | -------------------- |
| **Project config**     | `warlock.config.ts`    | The server, the build, the dev server, the CLI, top-level migrations  | Once at boot         |
| **Subsystem config**   | `src/config/*.ts`      | One file per subsystem: `http`, `mail`, `storage`, `cache`, `auth`, … | Once at boot, merged |

Both pull values from `.env` via the `env()` helper. Both are typed. Both are read-only once boot finishes.

## `warlock.config.ts` — project-level config

Lives at the project root next to `package.json`. Returns the project-wide configuration via `defineConfig()`:

```ts title="warlock.config.ts"
import {
  authMigrations,
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  cli: {
    commands: [registerJWTSecretGeneratorCommand(), registerAuthCleanupCommand()],
  },
  database: {
    migrations: authMigrations,
  },
});
```

What you can put in here:

- **`server`** — port, host, retry-other-port-on-conflict.
- **`build`** — output directory, minify, sourcemaps for the production build.
- **`cli`** — custom CLI commands your app registers on top of the built-ins.
- **`devServer`** — file-watch globs, type generation, health checkers, transpile-cache debug.
- **`database`** — migrations from packages outside your `src/` tree (e.g. `authMigrations` from `@warlock.js/auth`).

`defineConfig()` is just `(config: WarlockConfig) => config` — its job is to give you full type inference on the object literal so IDE completions and TypeScript errors guide you.

## `src/config/*.ts` — subsystem config

Every file in `src/config/` exports a default config object for one subsystem. The file's name becomes the config namespace:

```ts title="src/config/http.ts"
import type { HttpConfigurations } from "@warlock.js/core";
import { Application, env } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 3000),
  host: env("HTTP_HOST", "localhost"),
  log: true,
  fileUploadLimit: 12 * 1024 * 1024,
  rateLimit: {
    max: 260,
    duration: 60 * 1000,
  },
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  },
  cookies: {
    secret: env("COOKIE_SECRET", "super-secret-key-change-me"),
    options: {
      httpOnly: true,
      secure: Application.isProduction,
      path: "/",
    },
  },
};

export default httpConfigurations;
```

A scaffolded project has one file per subsystem in `src/config/`:

```
src/config/
  app.ts           app name, timezone, base URL, locale
  auth.ts          JWT secret, token TTL, password policy
  cache.ts         driver, prefix, TTLs
  database.ts      driver (mongo|postgres), connection string, pool
  http.ts          port, CORS, cookies, rate-limit, uploads
  log.ts           channels, levels, redaction
  mail.ts          SMTP host/port/auth, default from, react templates
  repository.ts    repository defaults (cache strategy, pagination)
  storage.ts       disks (local, s3, …), default disk
  tests.ts         test runner settings, fixtures path
  validation.ts    schema defaults, custom rules
```

The default export's keys become reachable from anywhere via the `config` object — two methods:

```ts
import { config } from "@warlock.js/core";

// config.get(namespace) — the whole subsystem config
const httpConfig = config.get("http");      // → entire HttpConfigurations object

// config.key(path) — one value by dot-notation
const port = config.key("http.port");        // → 3000
const fromAddress = config.key("mail.from");
const dbDriver = config.key("database.driver"); // → "mongo" | "postgres"
const corsOrigin = config.key("http.cors.origin"); // → deep paths work too
```

`config.get(name)` autocompletes the subsystem name from the auto-generated `ConfigRegistry`. `config.key(path)` is the general-purpose dotted accessor. Both take an optional default as the second argument:

```ts
config.key("http.port", 3000);     // → 3000 if http.port is unset
config.key("http.missingThing");   // → null when the path resolves to nothing and no default is given
```

A key that resolves to nothing returns `null` (not `undefined`) when you don't pass a default — handy to know when you branch on the result. See **[Configuration (deep)](../architecture-concepts/configuration-deep.md)** for the full surface.

## `.env` — environment values

The bottom layer. Loaded by `@mongez/dotenv` at the very start of bootstrap. Both `warlock.config.ts` and `src/config/*.ts` read from it via `env()`:

```ts
import { env } from "@warlock.js/core";

const port = env("HTTP_PORT", 3000);              // number with default
const debug = env("DEBUG", false);                // boolean with default
const baseUrl = env("BASE_URL", "http://localhost:3000");
```

The second argument is the default — `env()` coerces to the default's type. `env("FLAG", false)` always returns a boolean, even if `FLAG=1` in the `.env`.

## How the layers compose

```
.env                       ←  values
  ↑ env(...)
src/config/*.ts            ←  subsystem-shaped: typed by the contract types from @warlock.js/core
  ↑ default export
config.get(name) /         ←  what your app code reads at runtime
config.key(path)

warlock.config.ts          ←  project-shaped: read by the framework itself (server, build, CLI)
  ↑ defineConfig(...)
framework internals        ←  not for app code
```

The split keeps app concerns (port, mail-from, DB connection) separate from framework concerns (CLI extensions, build output, dev-server flags). When you change `HTTP_PORT=4000` in `.env`, you change app behaviour — `warlock.config.ts` doesn't move. When you register a new CLI command, you touch `warlock.config.ts` — your app code stays put.

## Next

Continue to **[First route](./04-first-route.md)** — the page where Warlock actually does something.
