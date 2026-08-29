---
name: add-connector
description: 'Extend Warlock with a `BaseConnector` subclass and register its instance in `warlock.config.ts > connectors`. Covers runtime lifecycle (`boot`, `start`, `shutdown`, priority, phase, watched files) and the optional static `build.generate` / `build.emit` contribution used by `warlock build`. Triggers: `BaseConnector`, `connectors`, `ConnectorLifecyclePhase`, `ConnectorBuildContribution`, `build.generate`, `build.emit`; "add a queue worker", "wire a subsystem into bootstrap", "contribute files to warlock build", "control startup ordering", "graceful shutdown hook". Skip: app context accessors — `@warlock.js/core/use-app-context/SKILL.md`; general config shape — `@warlock.js/core/configure-app/SKILL.md`; competing pattern: hand-rolled process signal blocks, NestJS lifecycle hooks.'
---

# Warlock — add a connector

A **connector** is a long-lived subsystem owned by the framework: database, HTTP server, cache, storage, mailer, logger, herald (message broker), socket. The lifecycle is identical across all of them — `boot` → `start` → (run) → `shutdown` — and `ConnectorsManager` orchestrates the order. Adding your own lets you plug a new subsystem (queue worker, scheduler, search client) into the same lifecycle.

## The shape

```ts title="src/connectors/queue-connector.ts"
import {
  BaseConnector,
  ConnectorLifecyclePhase,
  type ConnectorName,
} from "@warlock.js/core";

export class QueueConnector extends BaseConnector {
  public readonly name: ConnectorName = "queue";
  public readonly priority = 10;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  protected readonly watchedFiles = ["src/config/queue.ts"];

  public async start(): Promise<void> {
    // open the connection, register handlers, prime caches…
    this.active = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.active) return;
    // drain queues, close connections, flush state…
    this.active = false;
  }
}
```

That's the connector class. The file's home is `src/connectors/<name>.ts` by convention — but **placing it there does not register it**. Add an instance to `warlock.config.ts > connectors` (see [Registering a connector](#registering-a-connector) below).

## `BaseConnector` — required surface

| Member          | Type                          | Notes                                                                                |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `name`          | `ConnectorName`               | Unique. Used in preload lists (`preload.connectors: ["queue"]`).                     |
| `priority`      | `number`                      | Lower starts first. See built-in `ConnectorPriority` enum for the existing ordering. |
| `lifecyclePhase`| `ConnectorLifecyclePhase`     | `Early` (default) or `Late`. See phase semantics below.                              |
| `watchedFiles`  | `string[]` (protected)        | Relative paths; touching any triggers a restart in dev.                              |
| `start()`       | `() => Promise<void>`         | The work that brings the subsystem online. Set `this.active = true` on success.     |
| `shutdown()`    | `() => Promise<void>`         | Inverse — close connections, drain queues. Set `this.active = false`.                |

Optional overrides:

- `boot()` — runs before `start()`. Use for construction-only work that doesn't touch external state (build clients, populate `container`). The built-in `HttpConnector` uses `boot` to construct Fastify and register plugins, then `start` to scan routes and call `listen()`.
- `shouldRestart(changedFiles)` — default checks `watchedFiles`. Override for custom logic (HTTP excludes `routes.ts` because HMR handles it).
- `restart()` — default is `shutdown()` + `start()`. Override if you need a re-`boot()` step.

`isActive()` is read-only on `BaseConnector`; flip the protected `this.active` flag inside `start`/`shutdown` instead.

## Priority — when does it start?

Lower number = earlier. The built-in ordering, from `ConnectorPriority` in `@warlock.js/core/src/connectors/types.ts`:

| Connector     | Priority | Phase   |
| ------------- | -------- | ------- |
| `logger`      | 0        | Early   |
| `mailer`      | 1        | Early   |
| `database`    | 2        | Early   |
| `communicator`| 3        | Early   |
| `cache`       | 4        | Early   |
| `http`        | 5        | **Late**|
| `storage`     | 6        | Early   |
| `socket`      | 7        | **Late**|
| `notifications`| 8       | Early   |
| `access`      | 9        | Early   |
| `ai`          | 10       | Early   |

Pick a number that places your connector where it belongs. If your queue needs the database, set `priority > 2` (e.g. `11`). If you replace the cache, set `< 4` to win.

> **Built-in `AiConnector` (priority `ConnectorPriority.AI = 10`, Early).** A reference example of a config-driven, lazy-import connector: it reads the ejected `src/config/ai.ts` and applies it via `ai.config(...)`, lazy-importing `@warlock.js/ai` only when the config is present (so core carries no hard dependency). The config file (ejected by `warlock add ai`) holds an auto-managed `// >>> warlock:ai-packages` import block where the `ai-tools` / `ai-panoptic` / `ai-workspace` satellite features link their side-effect imports. See `src/connectors/ai-connector.ts`.

Negative priorities are fine for "start before everything" — the project's `src/connectors/custom-connector.ts` example uses `priority: -10`.

## Phases — `Early` vs `Late`

`ConnectorLifecyclePhase` exists because **HTTP and socket need user code loaded first**: they scan the router (which user `routes.ts` files populate) and the container (which app `main.ts` files mutate). So the framework boots in two passes:

1. **Early phase** runs before user code imports — for things user code needs *at import time* (database/cache so models work, logger so app modules can `log.info`).
2. **Late phase** runs after user code imports — for things that consume registrations user code just made (HTTP reads the router, socket reads HTTP's instance).

If your connector is a self-contained service (queue client, scheduler), `Early` is correct. If it depends on app-level registrations, `Late`. Default is `Early` — don't change it without a reason.

## Registering a connector

`warlock.config.ts > connectors` is the canonical source for both runtime boot and production-build contributions. Nothing scans `src/connectors/` automatically.

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";
import { QueueConnector } from "./src/connectors/queue-connector";

export default defineConfig({
  connectors: [new QueueConnector()],
});
```

Order the array deliberately: runtime startup still follows connector priority, while build hooks are drained sequentially in array order. Names must be unique and must not claim a built-in connector name; Warlock rejects either mistake before boot or build work begins.

## Optional production-build contribution

A connector may expose a static `build` object with `generate` and/or `emit`. Import `ConnectorBuildContribution` as a type and add the following property to the connector class. `warlock build` reads it from the configured instance without calling runtime `boot()` or `start()`.

```ts title="inside your connector class"
public readonly build: ConnectorBuildContribution = {
  generate: async context => {
    // Write generated server files beneath context.productionDir.
    // Import optional build tooling inside this hook, not at module scope.
    return {
      entryImports: ['await import("./pages");'],
      esbuild: { external: ["optional-server-peer"] },
    };
  },
  emit: async context => {
    // Emit non-esbuild artifacts after the server bundle is complete.
  },
};
```

- `generate(context)` runs before esbuild. It may write into `context.productionDir`, append generated-entry imports, and return a narrow esbuild patch (`jsx`, `jsxImportSource`, `define`, `external`, or `loader`). Generated files are dependency-checked again before bundling.
- `emit(context)` runs after esbuild and before `.warlock/production` is removed; use it for artifacts esbuild does not produce, such as a client bundle or manifest.
- Hooks are awaited sequentially in configured array order. A throw names the connector and fails the build.
- The `build` object is closed to these two hooks. Construct plugins, pipelines, and aliases inside a hook via dynamic import so build-only dependencies do not enter the connector's runtime import graph.
- Contributor esbuild patches merge before the user's `build` config; user values win. `define` and `loader` merge by key, while `external` concatenates and deduplicates.

## `watchedFiles` and dev restarts

In the dev server, the file watcher emits a list of changed paths after every save. The manager iterates connectors and asks each `shouldRestart(changedFiles)`. Default implementation matches the file against `watchedFiles` (exact match, or glob if the entry contains `*`).

Typical patterns:

- Config file: `"src/config/<name>.ts"` (the connector's own config — restart when it changes).
- `.env`: usually omitted. The framework reloads env separately and reboots the world; per-connector watching of `.env` causes duplicate restarts.
- Don't watch user code (`src/app/**`). That's what HMR is for.

## Graceful shutdown

`ConnectorsManager` wires SIGINT/SIGTERM (and SIGHUP on Windows) to a `gracefulShutdown` handler that calls `shutdown()` on every connector **in reverse priority order**. Your `shutdown()` should:

1. Stop accepting new work (close listening sockets, stop consuming queues).
2. Drain any in-flight work, bounded by a timeout you own.
3. Close external connections.
4. Set `this.active = false`.

The manager swallows errors from individual `shutdown()`s (logs and continues) — one slow connector doesn't block the rest from shutting down. You do not need to call `process.exit()` yourself; the manager does that after the loop.

## Common patterns

### Queue worker (depends on DB)

```ts title="src/connectors/queue-worker-connector.ts"
import {
  BaseConnector,
  ConnectorLifecyclePhase,
  type ConnectorName,
} from "@warlock.js/core";
import { startWorker, stopWorker } from "app/queue/services/worker.service";

export class QueueWorkerConnector extends BaseConnector {
  public readonly name: ConnectorName = "queueWorker";
  public readonly priority = 10;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  protected readonly watchedFiles = ["src/config/queue.ts"];

  public async start(): Promise<void> {
    await startWorker();
    this.active = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.active) return;
    await stopWorker();
    this.active = false;
  }
}
```

### Scheduler (Late — wants the router up first)

```ts
import {
  BaseConnector,
  ConnectorLifecyclePhase,
  type ConnectorName,
} from "@warlock.js/core";

export class SchedulerConnector extends BaseConnector {
  public readonly name: ConnectorName = "scheduler";
  public readonly priority = 15;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Late;

  protected readonly watchedFiles = ["src/config/scheduler.ts"];

  protected timer?: NodeJS.Timeout;

  public async start(): Promise<void> {
    this.timer = setInterval(() => {
      // run scheduled jobs
    }, 60_000);
    this.active = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.active) return;
    if (this.timer) clearInterval(this.timer);
    this.active = false;
  }
}
```

### Feature-flagged registration

See the [Registering a connector](#registering-a-connector) section above for the canonical `if` pattern. The flag is read via `config.key("...")` (dot-notation) — `config.get("...")` returns whole namespaces, not nested values.

## Gotchas

- **Set `this.active = true` only on success.** If `start()` throws partway, leaving `active` true means `shutdown()` thinks it has work to do and may double-close half-initialized resources.
- **`shutdown()` must be idempotent.** SIGINT can fire twice on Windows. The manager guards re-entry with its own flag, but individual connectors get called once per shutdown loop — guard with `if (!this.active) return`.
- **Don't reach across connector boundaries in `start()`.** The manager's `start()` loop runs all `boot()`s first, then all `start()`s — wiring across connectors goes through the `container` (`container.get("http.server")`), not through imports.
- **Production build still needs config registration.** Placing the connector under `src/connectors/<name>.ts` does not auto-register it. Put the same instance in `warlock.config.ts > connectors`; that array is what build-time contribution discovery and runtime boot share.
- **`watchedFiles` is restart-trigger, not dependency.** It says "I want to restart when this file changes." It does *not* mean the framework reloads that file first — that's the file orchestrator's job.

## See also

- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `warlock.config.ts`, config files, env.
- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — checking environment + paths inside `start()`.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, canonical imports.
