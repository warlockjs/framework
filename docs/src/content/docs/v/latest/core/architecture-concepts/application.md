---
title: "Application"
description: The static gateway to environment, runtime mode, framework version, the boot lifecycle, and every well-known path your app touches — read-only at runtime, set once at boot.
sidebar:
  order: 1
  label: "Application"
---

`Application` is the framework's static gateway to the global facts every Warlock app needs: what environment am I running in, where's the project root, what version of the framework is loaded, when did the process start. Every getter is read-only at runtime; everything that mutates is set once during bootstrap (or in a test setup file).

You'll reach for it everywhere — from config files branching on `isProduction`, from services building absolute file paths, from health checks reporting uptime, from a logger annotation that wants the framework version. One import, one class, everything global lives behind it.

```ts
import { Application } from "@warlock.js/core";
```

That's the only line. There's no `new Application()` — the class is purely static.

## The mental model

Think of `Application` as the framework's read-only header — the bits of state every part of the app needs to know but nobody owns. It's not a container, not a DI scope, not a service locator. It's a small fixed surface of getters that always answer.

| Layer            | What it knows                                        | Mutation                            |
| ---------------- | ---------------------------------------------------- | ----------------------------------- |
| Environment      | `development` / `production` / `test`                | `setEnvironment(env)` — bootstrap   |
| Runtime mode     | Is this `dev-server` or the production bundle?       | `setRuntimeStrategy(mode)` — framework |
| Boot & shutdown  | Run code after the late phase, or clean up before exit. | `onceBooted` / `whenBooted` / `onShutdown` — fired once by the framework |
| Process timing   | When did we start? How long have we been up?         | None — derived from `process.uptime()` |
| Framework version| What's the loaded `@warlock.js/core` version?        | Set once during boot                |
| Paths            | Root, src, app, storage, uploads, public             | None — anchored at `process.cwd()`  |

Each row gets a section below.

## Environment

The environment is one of three values:

```ts
type Environment = "development" | "production" | "test";
```

It's read from `process.env.NODE_ENV`, defaulting to `"development"` if unset.

```ts
import { Application } from "@warlock.js/core";

Application.environment;       // "development" | "production" | "test"
Application.isDevelopment;     // boolean
Application.isProduction;      // boolean
Application.isTest;            // boolean
```

The three `is*` getters are evaluated each time they're called — they read `process.env.NODE_ENV` live. No caching, no memoization, no need to invalidate.

You'll use this most often inside config files to branch on environment:

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

Same pattern in mailers (use the real SMTP service in prod, a sandbox in dev), in CORS (open `*` in dev, an allowlist in prod), in cache TTLs (short in dev for iteration, longer in prod for performance).

### Setting the environment

There are two ways `NODE_ENV` gets set:

1. **From the shell or process manager.** `NODE_ENV=production node ...`, an EC2 launch template, a Docker `ENV` line. This is how a deployed app picks up its mode — the framework just reads what's already there.
2. **Programmatically via `setEnvironment`.** Test runners set `"test"` before importing your app code:

```ts title="vitest.setup.ts"
import { Application } from "@warlock.js/core";

Application.setEnvironment("test");
```

`setEnvironment(env)` writes to `process.env.NODE_ENV`. Subsequent reads of `Application.environment` see the new value immediately. Call it BEFORE any code that branches on the environment — otherwise the branching ran against the old value.

Test framework caveat: `Application.isTest` returns `false` unless something explicitly set `NODE_ENV=test`. Most test runners (Vitest, Jest) don't set it for you — you need a setup file that calls `setEnvironment("test")` or you need to run `NODE_ENV=test vitest`.

## Runtime mode

A separate axis from environment — the framework runs your code via one of two strategies:

```ts
Application.runtimeStrategy;       // "production" | "development"
Application.setRuntimeStrategy("production");
```

| Strategy        | What it means                                                              |
| --------------- | -------------------------------------------------------------------------- |
| `"development"` | The dev server is hosting — file watching, HMR, transpile cache, etc.      |
| `"production"`  | The bundled production output is hosting — no watcher, no transpile cache. |

The framework sets this for you. You'll see it consulted internally — for example, the HTTP connector branches on it to decide between `router.scanDevServer()` and `router.scan()`. Most app code shouldn't read it; reach for `Application.environment` instead.

The split matters because `NODE_ENV=production` is one thing (it gates app behaviour: cookies, logs, caches) but the runtime strategy is another (it gates framework behaviour: HMR, watchers). You can run the production bundle with `NODE_ENV=development` for debugging, or the dev server with `NODE_ENV=production` for staging-like testing.

## Boot lifecycle

There's one moment every long-running app cares about: **everything is up**. Every connector in both phases has started, every `main.ts` / `events.ts` / `routes.ts` has been imported, every model is registered, and — crucially — the HTTP server is listening and the socket server is bound. `Application` exposes that moment as a small latch.

```ts
import { Application } from "@warlock.js/core";

Application.onceBooted(({ environment, runtimeStrategy, bootDurationMs }) => {
  // Runs once the app is fully booted — http listening, socket bound.
});

Application.isBooted;            // boolean — has boot finished?
await Application.whenBooted();  // Promise<BootContext> — await form
```

### Why not just put the code at the end of `main.ts`?

Because `main.ts` runs **too early**. The boot sequence imports your app code (locales, events, `main.ts`, routes) _between_ the early-phase connectors (database, cache, logger, …) and the late-phase connectors (http, socket). So at the moment `main.ts` executes, the HTTP server is not listening yet and `app.http` / `app.socket` are still `undefined`.

`onceBooted` solves this: it defers the callback until the late phase has finished. Register it at the top of `main.ts` and it runs at exactly the right time — when the server is actually up.

```ts title="src/app/main.ts"
import { Application, app } from "@warlock.js/core";
import { log } from "@warlock.js/logger";

Application.onceBooted(({ environment, bootDurationMs }) => {
  // app.http and app.socket are guaranteed populated here.
  log.success("app", "booted", `ready in ${environment}`, { bootDurationMs });
});
```

### It's a latch, not an event

A plain event listener that subscribes after the event fired misses it forever. `onceBooted` is a latch — it remembers that boot happened:

- **Register before boot** → the callback is queued and runs when boot completes.
- **Register after boot** → the callback runs immediately (on the next microtask).

So a lazily-imported module, a plugin, or any code that wires itself up after startup still gets the signal. You never have to reason about whether you subscribed "in time."

### The boot context

Every listener — and `whenBooted()`'s resolved value — receives a `BootContext`:

| Field             | Type                                       | Notes                                                        |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `environment`     | `"development" \| "production" \| "test"`  | The active environment at boot                              |
| `runtimeStrategy` | `"production" \| "development"`            | Dev server vs bundled output                                |
| `bootDurationMs`  | `number \| undefined`                      | How long boot took — dev server only; omitted in production |

Both the dev server and the production bundle fire the latch exactly once, after the late phase. App code only ever _reads_ it (`onceBooted` / `whenBooted` / `isBooted`); the internal `markBooted` is a framework concern — don't call it.

### What it's for

`onceBooted` is the home for work that must wait for a complete boot: warming a cache, registering a recurring job, pinging a readiness endpoint, opening an outbound connection that needs the HTTP server already listening, or simply logging a "ready" line with the boot duration. A throwing listener is caught and logged, so one bad hook can't break boot or the other hooks.

### Shutdown — release resources before the app stops

`Application.onShutdown(callback)` is the mirror of `onceBooted` — teardown that runs once when the process is shutting down (SIGINT/SIGTERM, or the dev server stopping), **before** the connectors (db, cache, http) close, so cleanup can still use them.

```ts title="src/app/main.ts"
import { Application } from "@warlock.js/core";

Application.onceBooted(() => {
  const consumer = startQueueConsumer();

  // Pair every resource you open at boot with its teardown.
  Application.onShutdown(async () => {
    await consumer.stop();
  });
});
```

Hooks run **LIFO** (reverse of registration — last opened, first closed), each is awaited, and a throwing hook is caught and logged so it can't block the rest. `Application.isShuttingDown` flips `true` the moment shutdown begins; the built-in `/ready` endpoint reads it to report not-ready so a load balancer drains the instance first. For the HTTP-side story — `/health`, `/ready`, and graceful request draining — see [Health checks & graceful shutdown](../digging-deeper/health-checks.md).

The framework triggers this for you (the connectors manager runs the hooks at the start of shutdown); app code only registers via `onShutdown`.

## Process timing

Two read-only getters tell you when the process started and how long it's been running:

```ts
Application.startedAt;     // Date — when the Node process started
Application.uptime;        // number — milliseconds since process start
```

`startedAt` is computed once at import time from `process.uptime()`. It's a `Date` — JSON-serializable, comparable, the usual moves.

`uptime` is computed each time you read it — `process.uptime()` returns seconds; this returns milliseconds.

Useful for health endpoints, logging at boot, and the kind of "this process has been alive for N hours, time to restart" cron logic that creeps into every long-lived deployment:

```ts title="src/app/health/controllers/health.controller.ts"
import type { RequestHandler } from "@warlock.js/core";
import { Application } from "@warlock.js/core";

export const healthController: RequestHandler = async (request, response) => {
  return response.success({
    status: "ok",
    environment: Application.environment,
    version: Application.version,
    uptimeMs: Application.uptime,
    startedAt: Application.startedAt.toISOString(),
  });
};
```

## Framework version

```ts
Application.version;       // string | null — e.g. "2.5.0"
```

Reads from `@warlock.js/core/package.json`. Returns `null` until the framework has loaded the version file (which it does early during boot). Once loaded, it's cached — subsequent reads are free.

Use it for log annotations, debug headers in development, error reports that include "which framework version was running when this happened":

```ts
import { Application } from "@warlock.js/core";
import { log } from "@warlock.js/logger";

log.info("boot", "framework", `Warlock ${Application.version} starting`);
```

## Paths

Six absolute paths cover the well-known locations in a Warlock project. Every getter returns a fully-resolved string anchored at `process.cwd()`:

| Getter                | Resolves to                          | Use for                                              |
| --------------------- | ------------------------------------ | ---------------------------------------------------- |
| `Application.rootPath`   | `<cwd>`                              | Anything project-relative                            |
| `Application.srcPath`    | `<cwd>/src`                          | Targeting source — rarely needed at runtime          |
| `Application.appPath`    | `<cwd>/src/app`                      | Targeting modules — also rarely needed at runtime    |
| `Application.storagePath`| `<cwd>/storage`                      | Persistent disk artefacts (logs, cache, uploads root)|
| `Application.uploadsPath`| Either `<cwd>/storage/uploads` or the path set in `config.uploads.root` | The uploads bucket for user-submitted files |
| `Application.publicPath` | `<cwd>/public`                       | Static assets served via `router.directory(...)`      |

Each getter is a thin wrapper over the corresponding path helper. The helpers themselves accept extra path segments — if you want to compose deeper paths, import them directly:

```ts
import { storagePath, uploadsPath } from "@warlock.js/core";

const logsDir = storagePath("logs");
const userUploadPath = uploadsPath(`users/${userId}/avatar.jpg`);
```

The `Application.<name>Path` getters always return the root of that location; for sub-paths, the function form (`storagePath("foo/bar")`) is the right tool.

### When the uploads path differs from the default

If you've set `uploads.root` in your config — pointing to a CDN-mounted volume, a separate disk, a custom function — `Application.uploadsPath` returns that path instead of the default. This is the one path that's configurable.

```ts title="src/config/uploads.ts"
import { rootPath } from "@warlock.js/core";

export default {
  root: rootPath("..", "shared-uploads"),    // outside the project
  // or:
  // root: (relativePath: string) => `/mnt/uploads/${relativePath}`,
};
```

The function form is useful for sharded storage, per-tenant directories, or any case where the path depends on the relative target.

## Common patterns

### Branching on environment in a config

```ts title="src/config/cache.ts"
import { Application } from "@warlock.js/core";

export default {
  driver: Application.isProduction ? "redis" : "memory",
  ttl: Application.isProduction ? 3600 : 60,
};
```

The expression is evaluated when `src/config/cache.ts` is imported during boot. Changing `NODE_ENV` mid-process won't re-run this — config is read-once.

### Building an absolute path to a static asset

```ts
import { Application } from "@warlock.js/core";
import { join } from "node:path";

const seedFile = join(Application.rootPath, "seeds", "products.json");
```

`rootPath` is always your safe anchor. `srcPath` and `appPath` work too, but in a deployed bundle `src/` doesn't exist at runtime — only `rootPath` and `storagePath`/`uploadsPath`/`publicPath` are guaranteed.

### Reporting framework version at boot

```ts title="src/app/main.ts"
import { Application } from "@warlock.js/core";
import { log } from "@warlock.js/logger";

log.info(
  "boot",
  "framework",
  `Warlock ${Application.version} | ${Application.environment} | runtime: ${Application.runtimeStrategy}`,
);
```

Drop this into a module's `main.ts` and you'll get the boot annotation in your logs every restart. Useful for chasing "wait, which version was running when X broke?" tickets weeks later.

### Health check endpoint

```ts title="src/app/health/controllers/health.controller.ts"
import type { RequestHandler } from "@warlock.js/core";
import { Application } from "@warlock.js/core";

export const healthController: RequestHandler = async (request, response) => {
  return response.success({
    status: "ok",
    environment: Application.environment,
    version: Application.version,
    uptimeMs: Application.uptime,
    startedAt: Application.startedAt.toISOString(),
  });
};
```

Wire it up at `GET /health`. Load balancers, uptime probes, and humans tracking deploys all want this.

## Gotchas

- **`isProduction` is evaluated each call.** It reads `process.env.NODE_ENV` live. There's no need to cache its value in a module-scope `const` — call the getter where you need it.
- **`setEnvironment` only affects subsequent reads.** Code that already ran (boot-time configs, module-load-time branches) won't re-execute. Set the environment BEFORE you import the framework.
- **Test runners don't set `NODE_ENV=test` for you.** Vitest, Jest, etc. leave `NODE_ENV` as whatever the shell had. Add `Application.setEnvironment("test")` to your test setup file (or run `NODE_ENV=test vitest`).
- **`Application.version` returns `null` until the framework has loaded it.** The version file is loaded asynchronously early in boot — typical user code (inside a request handler) sees the cached value. But code that runs at the top of `bootstrap()` may see `null` for a window.
- **Paths are anchored at `process.cwd()`, not `import.meta.url`.** If you launch the process from outside the project root, every path getter is wrong. Always launch from the project root (the CLI does this for you).
- **`runtimeStrategy` is set by the framework, not by you.** Setting it manually from app code will confuse the HTTP connector and other internals. Read it; don't write to it.
- **`onceBooted` runs after the late phase; `main.ts` does not.** App files import _between_ the early and late connector phases, so code at the top level of `main.ts` runs before http/socket are listening. Defer anything that needs the server to `Application.onceBooted(...)`. It's a latch — registering after boot still fires (next microtask), so it never misses.
- **`onShutdown` runs before connectors close.** Cleanup can still use db/cache/http — but a hook that hangs delays teardown (bounded only by your process manager's kill timeout). Keep teardown fast; HTTP draining is already bounded by `http.gracefulShutdown.timeout`.

## See also

- **[`bootstrap-and-connectors.md`](./bootstrap-and-connectors.md)** — the boot sequence that sets up `runtimeStrategy`, loads env, and starts every connector.
- **[`configuration-deep.md`](./configuration-deep.md)** — config files that branch on `Application.isProduction` and friends.
- **[`getting-started/03-configuration.md`](../getting-started/03-configuration.md)** — the two-layer config story (warlock.config + src/config).
