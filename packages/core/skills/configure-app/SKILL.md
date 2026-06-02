---
name: configure-app
description: 'Configure a Warlock app — the two layers (`warlock.config.ts` for framework-level wiring, `src/config/*.ts` for subsystems), `.env` + `env()`, and the `config()` getter for runtime reads. Triggers: `defineConfig`, `config.get`, `config.key`, `env`, `ConfigRegistry`, `HttpConfigurations`, `AppConfigurations`; "add a new config file", "warlock.config.ts vs src/config", "read env values", "runtime config lookup"; typical import `import { defineConfig, config, env } from "@warlock.js/core"`. Skip: cache driver registration — `@warlock.js/cache/cache-basics/SKILL.md`; mail config — `@warlock.js/core/send-mail/SKILL.md`; storage config — `@warlock.js/core/store-file/SKILL.md`; competing libs `dotenv` direct, `convict`, `node-config`.'
---

# Warlock — configure the app

Two config layers, one source of env, one read API. Get those four mental model bits straight and the rest is filing.

## The shape

**Layer 1 — framework wiring.** One file at the project root: `warlock.config.ts`. Exports a `defineConfig({...})` call. Governs the bootstrap/server/build/devServer/cli/database hooks.

**Layer 2 — subsystem config.** One file per subsystem in `src/config/<name>.ts`. Each file `export default` a typed config object. Auto-loaded; registered under the file's basename (`http.ts` → `config.get("http")`).

```ts title="warlock.config.ts"
import { authMigrations, registerAuthCleanupCommand } from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    healthCheckers: false,
    generateTypings: false,
  },
  cli: {
    commands: [registerAuthCleanupCommand()],
  },
  build: {
    minify: true,
  },
  database: {
    migrations: authMigrations,
  },
});
```

```ts title="src/config/http.ts"
import type { HttpConfigurations } from "@warlock.js/core";
import { Application, env } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 3000),
  host: env("HTTP_HOST", "localhost"),
  log: true,
  fileUploadLimit: 12 * 1024 * 1024 * 1024,
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

## Which layer holds what

| Setting                                                | Layer                          |
| ------------------------------------------------------ | ------------------------------ |
| Build/bundler options (minify, sourcemap, outFile)     | `warlock.config.ts > build`    |
| Dev server (HMR scope, health checkers, typings)       | `warlock.config.ts > devServer`|
| Package migrations (external `@warlock.js/*` packages) | `warlock.config.ts > database` |
| CLI commands (registered via `warlock <cmd>`)          | `warlock.config.ts > cli`      |
| HTTP server tuning per env (port, host, retry)         | `warlock.config.ts > server`   |
| HTTP runtime (CORS, cookies, rate limits, upload size) | `src/config/http.ts`           |
| App identity (name, baseUrl, timezone, locales)        | `src/config/app.ts`            |
| Subsystem configs (auth, mail, storage, cache, ai, …)  | `src/config/<name>.ts`         |

Heuristic: if the setting changes how the framework **boots, builds, or scaffolds**, it goes in `warlock.config.ts`. If it changes how a **subsystem behaves at runtime**, it goes in `src/config/`.

## `.env` and `env()`

`env(key, default?)` reads from `process.env` and **auto-coerces** known shapes:

- `"true"` / `"false"` → `boolean`
- Numeric strings → `number`
- Falls back to the `default` argument when unset

```ts
import { env } from "@warlock.js/core";

env("HTTP_PORT", 3000);             // number
env("CACHE_LOGGING", false);        // boolean
env("BASE_URL", "http://localhost:3000"); // string
env("REDIS_URL");                   // undefined if unset
```

`env` is re-exported from `@warlock.js/core` (sourced from `@mongez/dotenv`). Use this — not `process.env.X` — so callers consistently get coerced values.

`.env.local` overrides `.env`. Project ships a `.env.example` listing the keys.

## Reading config at runtime — `config()`

`config` has two methods. Both accept a default:

```ts
import { config } from "@warlock.js/core";

// Whole group — typed by ConfigRegistry augmentation
const http = config.get("http");
const httpPort = http.port;

// Dot-notation key
const port = config.key<number>("http.port", 3000);
const baseUrl = config.key("app.baseUrl");
```

Use `config.get("name")` when you need the whole subsystem object; `config.key("a.b.c")` for a single value.

The `ConfigRegistry` interface is augmented by generated typings — once you add `src/config/foo.ts` and rerun typings, `config.get("foo")` autocompletes. Until then, pass an explicit generic.

## Anatomy of a `src/config/<name>.ts`

1. Import the typed shape (`HttpConfigurations`, `AppConfigurations`, `CacheConfigurations<DriverNames>`, `MailConfigurations`, `StorageConfigurations`, …) from `@warlock.js/core` (or `@warlock.js/cache` for cache).
2. Build the object, typed as that shape — TS will surface missing keys.
3. Pull values from `env(...)` where they belong in `.env`. Hard-code immutable choices.
4. `export default` the object.

That's the contract. Filename → config key. No registration, no manifest, no side effects.

## Special handlers

Some subsystems need to do extra work when their config loads (e.g. set the active locale, register a driver). Those have a special handler attached internally — for the most part you don't see them. The takeaway: changing a config file at dev time fires the handler again automatically.

## Multi-file or conditional config

A config file is just a TS module. Branch on `env(...)` if production should differ from development:

```ts title="src/config/storage.ts"
import {
  env,
  type StorageConfigurations,
  storageConfigurations,
  storagePath,
} from "@warlock.js/core";

const storageOptions: StorageConfigurations = {
  default: env("STORAGE_DRIVER", "local"),
  drivers: {
    local: storageConfigurations.local({
      root: storagePath(),
      urlPrefix: "/uploads",
    }),
    r2: storageConfigurations.r2({
      bucket: env("R2_BUCKET"),
      endpoint: env("R2_ENDPOINT"),
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      accountId: env("R2_ACCOUNT_ID"),
      region: env("R2_REGION", "auto"),
      publicDomain: env("R2_BASE_URL"),
    }),
  },
};

export default storageOptions;
```

Same shape — TS validates the union; runtime picks the `default` key.

## Per-env knobs

For one-off switches gated on environment, the canonical pattern is `Application.isProduction` (also `isDevelopment`, `isTest`):

```ts
import { Application } from "@warlock.js/core";

const config = {
  cookies: {
    secure: Application.isProduction,
  },
};
```

Avoid scattering `process.env.NODE_ENV === "production"` checks — they don't get the same default-handling.

## Common patterns

### Adding a new subsystem

1. Create `src/config/<name>.ts` exporting a default object.
2. (Optional) Augment `ConfigRegistry` in a `.d.ts` if you want `config.get("<name>")` to autocomplete.
3. Read it where needed: `config.get("<name>")` or `config.key("<name>.field")`.

That's the whole flow. No barrel, no register call.

### Per-tenant config

For multi-tenancy, don't put per-tenant values in `src/config/`. Resolve at runtime from the tenant context and pass into the subsystem's per-call options (e.g. `Mail.config(tenant.mailSettings)`).

### Package config

Internal `@warlock.js/*` packages read from `config.get("<name>")` the same way app code does. When wiring a package config (e.g. `src/config/cache.ts`), the package surface (`cache.init()`) reads the registered values on boot.

## Gotchas

- **One `default` export per config file.** Anything else won't be picked up. A named export is invisible to the loader.
- **`env(key)` returns the env value coerced, not the literal string.** `env("HTTP_LOG")` returns `true`/`false`, not `"true"`. Type the default to match.
- **Don't mutate `config` at runtime.** It's read-only by convention. For dynamic overrides, fold into the call-site options (e.g. `cache.set(key, val, { driver: "redis" })`).
- **`Application.isProduction` is preferred over `process.env.NODE_ENV` checks** in config files — same source, but it survives `setEnvironment(...)` and reads consistently.
- **`warlock.config.ts` is the boot config; `src/config/` is the runtime config.** Putting runtime tuning into `warlock.config.ts` doesn't crash but won't be visible via `config.get(...)`.

## See also

- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, canonical imports, framework-wide invariants.
- [`@warlock.js/cache/pick-cache-driver/SKILL.md`](../../../cache/skills/pick-cache-driver/SKILL.md) — picking and registering a cache driver in `src/config/cache.ts`.
- [`send-mail/SKILL.md`](../send-mail/SKILL.md) — the `src/config/mail.ts` shape.
- [`store-file/SKILL.md`](../store-file/SKILL.md) — the `src/config/storage.ts` shape.
