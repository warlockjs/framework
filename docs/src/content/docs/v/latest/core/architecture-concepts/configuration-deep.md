---
title: "Configuration — deep dive"
description: Inside the config layer — config.get / config.key, special handlers that react to certain keys, env() coercion gotchas, merge order, and how subsystems pick up your settings.
sidebar:
  order: 6
  label: "Configuration (deep)"
---

The shape of Warlock config — `warlock.config.ts` for the framework, `src/config/*` for app subsystems, `.env` for environment values — is covered in [Getting started → Configuration](../getting-started/03-configuration.md). This page is the deep dive into the layer that makes it work at runtime: how config is loaded, how `config.get(...)` and `config.key(...)` read it, what special handlers do behind the scenes, and the small but load-bearing gotchas you'll trip over once.

If you've never touched the config system before, read the getting-started page first. If you have and you're hitting "why isn't this picking up?", you're in the right place.

## The reading API

`config` is an object, not a function. Two methods:

```ts
import { config } from "@warlock.js/core";

config.get("http");                          // → entire HttpConfigurations object
config.key("http.port");                     // → 3000
config.key<number>("http.port", 8080);       // → typed read with default
config.key("http.cors.origin");              // → deep dot-notation
```

| Method                | When to use                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| `config.get(name)`    | Get the whole subsystem config — e.g. when handing it to a third-party SDK as one object |
| `config.key(path)`    | Get one value by dot-notation path — works for any depth                              |

The split is autocomplete-driven. `config.get` autocompletes the top-level subsystem names from the `ConfigRegistry` interface (auto-generated as you add config files). `config.key` accepts any dotted path and is the general-purpose accessor.

Both accept a default value as the second argument:

```ts
const port = config.key("http.port", 3000);          // → 3000 if unset
const driver = config.get("cache", { driver: "memory" });
```

The default fires when the key is missing or `undefined` — it does NOT fire on `null` or `false` or `0` (those are real values).

## Where the configs come from

Every `.ts` file in `src/config/*` becomes a top-level config namespace named after the file:

```
src/config/http.ts      →  config.get("http")
src/config/mail.ts      →  config.get("mail")
src/config/database.ts  →  config.get("database")
src/config/storage.ts   →  config.get("storage")
```

The default export's keys become the second-level paths:

```ts title="src/config/http.ts"
import { Application, env } from "@warlock.js/core";
import type { HttpConfigurations } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 3000),
  host: env("HTTP_HOST", "localhost"),
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

After this file loads, every consumer can reach for:

```ts
config.key("http.port");                  // → 3000 (or the env value)
config.key("http.cors.origin");           // → "*"
config.key("http.cookies.options.secure"); // → true in prod, false in dev
```

No registration step — the file is the wiring.

## How configs are loaded

Boot-time, the framework walks `src/config/` and loads every file:

```mermaid
flowchart LR
    discover["Discover src/config/*.ts"]
    load["Import each file (ESM)"]
    extract["Read default export"]
    register["Store under config.<filename>"]
    special["Run special handlers (locale setup, etc.)"]

    discover --> load
    load --> extract
    extract --> register
    register --> special
```

Two things to know about this flow:

1. **The filename — not anything inside the file — becomes the namespace.** Rename `http.ts` to `web.ts` and `config.get("http")` returns undefined; you'd reach for `config.get("web")` instead. The file is the contract.
2. **Default export is mandatory.** If a config file forgets `export default`, you get a clear error at boot — the framework won't silently leave the namespace empty.

In development, when you save a config file, the framework re-imports just that file and re-registers it. Subsequent `config.key(...)` calls see the new value. No manual cache busting.

## Special handlers

Some config files trigger framework-level reactions when they load. The `config-special-handlers.ts` module holds a registry mapping config-file names to handler functions; when a config loads, the registry runs the handler for that name.

The built-in handler is for `app.ts`:

```ts title="A config special-handler"
export const registerAppConfig = async (appConfig: AppConfigurations) => {
  const locales = appConfig.locales || ["en"];

  for (const locale of locales) {
    if (locale === "en") continue;

    try {
      await import(`dayjs/locale/${locale}.js`);
    } catch (error) {
      console.warn(`Failed to load dayjs locale: ${locale}`);
    }
  }
};

configSpecialHandlers.register("app", registerAppConfig);
```

When `src/config/app.ts` loads, the framework pulls the `locales` array and dynamically imports each dayjs locale module. This is the difference between `dayjs().format(...)` knowing how to spell "Wednesday" in Arabic vs. silently falling back to English.

You can register your own special handler if you have a subsystem whose config needs a side-effect when it loads:

```ts title="src/app/main.ts"
import { configSpecialHandlers } from "@warlock.js/core";

configSpecialHandlers.register("featureFlags", async (flagsConfig) => {
  await featureFlagsClient.preloadDefinitions(flagsConfig.definitions);
});
```

When `src/config/feature-flags.ts` loads (after boot), the handler runs and preloads. Two caveats:

- **Handlers run after the config is registered** — `config.get("featureFlags")` works inside the handler.
- **Handlers run on EVERY load** — including HMR reloads in dev. Make them idempotent.

## env() — the environment value reader

`env(key, default?)` reads from `process.env` with type coercion driven by the default:

```ts
import { env } from "@warlock.js/core";

const port = env("HTTP_PORT", 3000);          // number
const host = env("HTTP_HOST", "localhost");   // string
const log = env("DB_LOGGING", false);         // boolean
```

The coercion logic:

| Default type | `env("KEY")` returns                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| `number`     | `Number(value)` if set, else the default. `NaN` becomes the default.                |
| `boolean`    | `"true"` → `true`, `"false"` → `false`. Anything else coerces via `Boolean(value)`. |
| `string`     | The raw env string, or the default if unset.                                         |
| no default   | The raw env string (or `undefined`).                                                |

`env` is re-exported from `@mongez/dotenv` — calls flow through that package. The behaviour above is from that package; if you need to verify the exact coercion (especially around odd inputs), check `@mongez/dotenv`'s source.

### The "false" gotcha

If a `.env` line reads `DEBUG=false`, then:

```ts
env("DEBUG", true);       // → false (the string "false" is interpreted as the boolean)
env("DEBUG", "true");     // → "false" (string default; you got the string back)
```

If the default is boolean, you get booleans. If the default is a string, you get strings (and need to check `=== "true"` yourself). The default's TYPE drives the interpretation.

This trips people up most when porting a config from another framework that treats `.env` as always-string. Warlock's `env()` only coerces when the default tells it to.

### `null` and `undefined` in `.env`

`.env` files only hold strings. There's no way to express `null` from a `.env` line — `KEY=null` produces the string `"null"`. If you need a nullable config value, branch in the config file:

```ts title="src/config/app.ts"
import { env } from "@warlock.js/core";

const localeFromEnv = env("DEFAULT_LOCALE");

export default {
  defaultLocale: localeFromEnv === "null" ? null : localeFromEnv ?? "en",
};
```

Or just leave the env var unset and read `env("KEY")` without a default — you'll get `undefined`, which most code handles.

## Merge order

Three sources contribute to runtime config:

```
.env                    ←  values (strings only)
  ↑ env(key, default)
src/config/*.ts         ←  subsystem-shaped: typed contracts; reads from env
  ↑ default export
config.get / config.key ←  what app code reads at runtime

warlock.config.ts       ←  project-shaped: framework-only
  ↑ defineConfig(...)
framework internals     ←  not for app code
```

The `.env` file feeds `src/config/*` via `env()` calls. Subsystem configs feed app code via `config.get/key`. The two layers are separate — `warlock.config.ts` doesn't merge into `config.get(...)`, and `src/config/*` doesn't merge into `warlockConfig.get(...)`.

The merge ORDER within subsystem configs is "last write wins" — the framework loads `src/config/*` in directory order. In practice you don't override the same key twice — each config file is its own namespace — so the order rarely matters.

## Composing config — the `Application` references

A common pattern: a config file reads `.env` for the bulk of its values but branches on `Application.isProduction` for security-sensitive defaults:

```ts title="src/config/http.ts"
import { Application, env } from "@warlock.js/core";
import type { HttpConfigurations } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 3000),
  host: env("HTTP_HOST", "localhost"),
  cookies: {
    secret: env("COOKIE_SECRET", "super-secret-key-change-me"),
    options: {
      httpOnly: true,
      secure: Application.isProduction,    // HTTPS-only cookies in prod
      path: "/",
    },
  },
};

export default httpConfigurations;
```

`Application.isProduction` is evaluated when this file loads — once, at boot. If you change `NODE_ENV` mid-process (rare), the value baked into the config object doesn't update. That's intentional: config is read-once.

The same pattern shows up in mail (different SMTP for prod vs. dev), in CORS (allowlist in prod, `*` in dev), in cache TTLs (short in dev for iteration, long in prod for performance).

## Real-world examples

The reference codebase has fifteen config files. A representative sample:

### Database — driver + connection options

```ts title="src/config/database.ts"
import type {
  ConnectionOptions,
  MongoClientOptions,
  MongoDriverOptions,
} from "@warlock.js/cascade";
import { env } from "@warlock.js/core";

const databaseConfigurations: ConnectionOptions<MongoDriverOptions, MongoClientOptions> = {
  driver: env("DB_DRIVER", "mongodb"),
  name: "default",
  database: env("DB_NAME"),
  logging: env("DB_LOGGING", false),
  host: env("DB_HOST", "localhost"),
  port: env("DB_PORT", 27017),
  username: env("DB_USERNAME"),
  password: env("DB_PASSWORD"),
  authSource: env("DB_AUTH"),
  uri: env("DB_URL"),

  driverOptions: {
    autoGenerateId: true,
    counterCollection: "counters",
  },

  modelOptions: {
    timestamps: true,
    strictMode: "strip",
  },
};

export default databaseConfigurations;
```

`env("DB_PORT", 27017)` coerces to number (default is a number). `env("DB_LOGGING", false)` coerces to boolean. `env("DB_NAME")` is a string (no coercion needed).

### Mail — pure env passthrough

```ts title="src/config/mail.ts"
import type { MailConfigurations } from "@warlock.js/core";
import { env } from "@warlock.js/core";

const mailConfigurations: MailConfigurations = {
  host: env("MAIL_HOST"),
  username: env("MAIL_USERNAME"),
  password: env("MAIL_PASSWORD"),
  port: env("MAIL_PORT"),
  secure: env("MAIL_SECURE"),
  from: {
    name: env("MAIL_FROM_NAME"),
    address: env("MAIL_FROM_ADDRESS"),
  },
};

export default mailConfigurations;
```

No defaults — if a mail env var is unset, the field is `undefined` and the mailer connector won't connect (and the connector handles that gracefully).

### Auth — uses imports beyond `env`

```ts title="src/config/auth.ts"
import { type AuthConfigurations } from "@warlock.js/auth";
import { env } from "@warlock.js/core";
import { User } from "app/users/models/user";

const authConfigurations: AuthConfigurations = {
  userType: {
    user: User,
  },
  jwt: {
    secret: env("JWT_SECRET"),
    expiresIn: "1h",
    refresh: {
      expiresIn: "30d",
      enabled: true,
      secret: env("JWT_REFRESH_SECRET"),
    },
  },
};

export default authConfigurations;
```

Config files can import from anywhere — your models, framework types, third-party SDKs. The only constraint: don't `config.get(...)` inside another config file. The config you're reading might not be loaded yet (order is alphabetical, not dependency-based).

## When to use a custom config file

Anything that:

1. Is configurable per-environment, AND
2. Is consulted from multiple places.

If only one module reads it, it can live on a constant in that module. If two modules read it, it should be a config file. If it's per-environment, it should pull from `.env` via `env(...)`.

A custom config file shows up as `config.get("<name>")` automatically once it's in `src/config/`:

```ts title="src/config/feature-flags.ts"
import { env } from "@warlock.js/core";

export default {
  enabled: env("FEATURE_FLAGS_ENABLED", true),
  endpoint: env("FEATURE_FLAGS_ENDPOINT", "https://flags.internal/api"),
  defaults: {
    newCheckoutFlow: false,
    aiTagging: true,
  },
};
```

Then anywhere:

```ts
const flagsEnabled = config.key("featureFlags.enabled");
const newCheckout = config.key("featureFlags.defaults.newCheckoutFlow");
```

The framework regenerates `ConfigRegistry` typings on dev-server boot (when `devServer.generateTypings` is enabled in `warlock.config.ts`), so autocomplete picks up `config.get("featureFlags")` without you doing anything.

## Gotchas

- **`config` is an object with `.get` and `.key`, not a callable function.** `config("http.port")` throws — use `config.key("http.port")` for paths and `config.get("http")` for whole groups.
- **`env()` coerces by the default's type.** Pass `env("FLAG", false)` to get a boolean back; pass `env("FLAG", "false")` to get the raw string. Mismatched expectations are the #1 source of "why is my config a string and not a number" debugging.
- **Configs load in alphabetical order, not dependency order.** Don't `config.get(...)` inside another config file's top-level — at the moment the file is evaluated, the other namespace may not exist yet. Read from `.env` and external imports.
- **A missing default export silently breaks the namespace.** The framework prints an error but keeps booting. If `config.get("foo")` returns `undefined` unexpectedly, check that `src/config/foo.ts` has `export default ...`.
- **Special handlers run on every load — including HMR.** If you register a handler that does side effects (preloading caches, opening sockets), make it idempotent or guard with a "have I run already?" flag.
- **Changes to `.env` require a restart, not an HMR reload.** The dev server doesn't re-read `.env` mid-run by default — `env()` calls run when the config file imports, not on every `config.key(...)` call. Add `.env` to a connector's `watchedFiles` if you need restart-on-env-change behaviour for that connector.
- **Config is read-once.** There's no public `setConfig(...)` API exported from `@warlock.js/core`. The framework's loader writes during boot via the underlying `@mongez/config` package; app code reads. If you need runtime overrides for tests, set up a test setup file that imports and mutates explicitly — but treat it as a smell, not a pattern.

## See also

- **[`getting-started/03-configuration.md`](../getting-started/03-configuration.md)** — the two-layer overview every reader should know first.
- **[`warlock-config.md`](./warlock-config.md)** — the parallel project-level config that lives in `warlock.config.ts`.
- **[`application.md`](./application.md)** — `Application.isProduction` and friends, which configs branch on.
- **[`bootstrap-and-connectors.md`](./bootstrap-and-connectors.md)** — when configs are loaded relative to the rest of boot.
