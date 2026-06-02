---
name: use-app-context
description: 'Read app-wide context — the `Application` static class (env, version, uptime, runtime strategy) plus the `app` runtime accessor (live Fastify, socket.io, router, database via the DI container). Triggers: `Application.isProduction`, `Application.environment`, `Application.runtimeStrategy`, `Application.uptime`, `Application.version`, `app.http`, `app.socket`, `app.database`, `app.router`; "branch on environment", "reach the live Fastify instance", "framework version in health endpoint", "dev vs production runtime check"; typical import `import { Application, app } from "@warlock.js/core"`. Skip: path helpers — `@warlock.js/core/resolve-path/SKILL.md`; connector start order — `@warlock.js/core/add-connector/SKILL.md`; competing patterns: bare `process.env.NODE_ENV`, ad-hoc Fastify imports.'
---

# Warlock — use the application context

`Application` is the static class that exposes "where am I running, and where is everything?" without each call site re-parsing `process.env`, `process.cwd()`, or a package.json. Import it from `@warlock.js/core` and read off the static members directly — no instantiation.

## The shape

```ts
import { Application } from "@warlock.js/core";

if (Application.isProduction) {
  // …production-only behavior
}

const uploadsDir = Application.uploadsPath;
const uptimeMs   = Application.uptime;
const version    = Application.version;
```

Every member is a getter — values are computed on access, not snapshotted at boot. That's deliberate: tests flip the environment, the dev server flips the runtime strategy, and the framework caches its own version. You always read the current value.

## Environment

```ts
Application.environment      // "development" | "production" | "test"
Application.isProduction     // === "production"
Application.isDevelopment    // === "development"
Application.isTest           // === "test"
```

Backed by `process.env.NODE_ENV`. `setEnvironment` mutates it:

```ts
Application.setEnvironment("test");
```

Used internally by the CLI (`preload.environemnt: "production"` calls `setEnvironment` before the action runs) and by Vitest setups. Don't call it from request handlers — it's process-global.

The most common consumer is `src/config/http.ts`, picking the cookie security flag:

```ts title="src/config/http.ts"
import { Application, env, type HttpConfigurations } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  cookies: {
    secret: env("COOKIE_SECRET", "super-secret-key-change-me"),
    options: {
      httpOnly: true,
      secure: Application.isProduction,   // true on prod (HTTPS only), false in dev
      path: "/",
    },
  },
};

export default httpConfigurations;
```

## Runtime strategy

`runtimeStrategy` is a separate axis from `environment`. It marks how the *framework itself* is running:

- `"development"` — dev server (file watcher, HMR, transpile cache on disk).
- `"production"` — built bundle running from `dist/`.

```ts
Application.runtimeStrategy           // "production" | "development"
Application.setRuntimeStrategy("production");
```

The dev-server CLI command sets it to `"development"`. The `build` command and `start.production` set `"production"`. Use it inside connectors that need to behave differently in the bundled output — the built-in `HttpConnector` uses `router.scanDevServer()` in dev and `router.scan()` in production.

Most app code shouldn't care about `runtimeStrategy` — branch on `environment` instead, which is the orthogonal "what world is this code talking to?" axis.

## Paths

For path helpers (`appPath`, `configPath`, `uploadsPath`, …) anchored at `process.cwd()`, the `paths.*` aggregate, and the `uploads.root` config override, see [`resolve-path/SKILL.md`](../resolve-path/SKILL.md).

The most-used helpers are also surfaced as no-argument getters on `Application`:

```ts
Application.rootPath        // <cwd>
Application.srcPath         // <cwd>/src
Application.appPath         // <cwd>/src/app
Application.publicPath      // <cwd>/public
Application.storagePath     // <cwd>/storage
Application.uploadsPath     // <cwd>/storage/uploads (or override)
```

Reach for those when you want the directory itself; reach for the helpers (e.g. `appPath("orders/routes.ts")`) when you need a file inside.

## Version and uptime

```ts
Application.version        // "1.0.0" (semver, cached after first read)
Application.uptime         // ms since process start
Application.startedAt      // Date object — wall time when the process booted
```

`version` is the `@warlock.js/core` package version, lazily loaded once. `uptime` is `process.uptime() * 1000` — the Node-process uptime, not "the framework's uptime." If you spawn workers, each worker has its own.

`startedAt` is computed once at module load: `new Date(Date.now() - process.uptime() * 1000)`. Stable across the run.

The project's home page surfaces the version in a footer:

```tsx
<span>v{Application.version}</span>
```

## The `app` runtime accessor

`Application` exposes **static metadata** (env, paths, version). For **runtime infrastructure** — the live Fastify instance, socket.io server, router, database connection — use the separate `app` object exported from `@warlock.js/core`:

```ts
import { app } from "@warlock.js/core";

app.http        // Fastify instance (after http connector starts)
app.socket      // socket.io Server (after socket connector starts)
app.router      // the Router singleton
app.database    // Cascade's DataSource
```

Each property is a getter backed by the framework's DI container (`container.get("http.server")` etc.). The container is populated by connectors during their `boot()`/`start()` phase — read these accessors only after the relevant connector has run. Every getter is a thin `container.get(...)`, so before the connector boots it returns `undefined` (it does **not** throw); chaining off an `undefined` accessor is what blows up. `http` and `socket` are *late*-phase connectors — they boot **after** app code is imported, so these accessors are not populated at the top level of a module's `main.ts`. From inside controllers, services, use-cases, or any code that runs while a request is in flight, every accessor is safe.

Typical uses (note: from runtime code, after bootstrap — not at module-import time):

```ts title="src/app/chat/setup-chat-socket.ts — attach a socket.io namespace"
import { getSocketServer } from "@warlock.js/core";

export function setupChatSocket() {
  const io = getSocketServer();
  if (!io) return; // socket connector not booted yet

  io.of("/chat").on("connection", (socket) => {
    // …
  });
}
```

```ts title="raw DataSource for an out-of-Cascade query"
import { app } from "@warlock.js/core";

const result = await app.database.client.query("SELECT NOW()");
```

Reach for `app.*` as the escape hatch. If a typed framework primitive wraps the same thing (`router.get(...)` over `app.http.route(...)`, repository methods over raw `app.database` queries), prefer that — the typed surface keeps you on the rails the rest of the framework is designed around.

## Common patterns

### Environment-aware logging level

```ts title="src/config/log.ts"
import { Application, type LogConfigurations } from "@warlock.js/core";

const logConfig: LogConfigurations = {
  level: Application.isProduction ? "info" : "debug",
};

export default logConfig;
```

### Resolve a file relative to the app root

```ts
import { appPath } from "@warlock.js/core";
import { readFile } from "node:fs/promises";

const template = await readFile(appPath("mailers/templates/welcome.html"), "utf-8");
```

### Health endpoint

```ts title="src/app/system/controllers/health.controller.ts"
import { Application, type RequestHandler, type Response } from "@warlock.js/core";

export const healthController: RequestHandler = async (_request, response: Response) => {
  return response.success({
    status: "ok",
    environment: Application.environment,
    version: Application.version,
    uptimeMs: Application.uptime,
    startedAt: Application.startedAt,
  });
};
```

### Don't ship debug routes to production

```ts title="src/app/dev/routes.ts"
import { Application, router } from "@warlock.js/core";
import { dumpStateController } from "./controllers/dump-state.controller";

if (!Application.isProduction) {
  router.get("/__dev/state", dumpStateController);
}
```

(The framework's HMR diffs route registrations — wrapping `router.get()` in an `if` means the route exists or doesn't depending on env, which is fine for boot-time branches like this one.)

### CORS — relax in dev, lock down in prod

```ts title="src/config/http.ts"
cors: {
  origin: Application.isProduction
    ? ["https://app.example.com"]
    : "*",
}
```

## Gotchas

- **Don't cache `Application.isProduction` at module top-level.** Tests routinely flip `NODE_ENV` before importing modules; a cached snapshot survives the flip and produces stale behavior. Read the getter at use site.

  ```ts
  // ❌ cached at import time — wrong after env flips
  const isProd = Application.isProduction;

  export function logLevel() {
    return isProd ? "info" : "debug";
  }

  // ✅ read at use site
  export function logLevel() {
    return Application.isProduction ? "info" : "debug";
  }
  ```

- **`version` is `null` until the first `await`.** The version loader is async (it reads `package.json`). On a cold start before any framework code has run `getWarlockVersion()`, `Application.version` returns `null`. The framework does load it during bootstrap, so anywhere downstream of bootstrap is fine — controllers, services, connectors after `start()`. CLI commands without `preload.bootstrap` may see `null`.
- **`Application` is static, not a DI registration.** Don't try to inject it. There's nothing to inject — it's a class with only static members.
- **`app.*` accessors return `undefined` before their connector boots — they don't throw.** `app.socket` / `app.database` / `app.http` are populated by their respective connectors during boot; until then each getter returns `undefined` (a bare `container.get(...)`). Reading them earlier (eager module-load code, the top level of a `main.ts` for the late-phase `http`/`socket`, certain CLI commands without the right `preload.connectors`) hands you `undefined`, and chaining off it throws. Safe everywhere downstream of bootstrap.

## See also

- [`resolve-path/SKILL.md`](../resolve-path/SKILL.md) — path helpers (`appPath`, `configPath`, `uploadsPath`, …) and the `paths.*` aggregate.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/*.ts` and `warlock.config.ts`.
- [`add-connector/SKILL.md`](../add-connector/SKILL.md) — using `Application.runtimeStrategy` inside a connector's `start()`.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, where paths point to.
