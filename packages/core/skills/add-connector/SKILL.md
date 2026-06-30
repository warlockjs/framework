---
name: add-connector
description: 'Extend Warlock''s lifecycle with a `BaseConnector` subclass — `name`, `priority`, `lifecyclePhase`, `start()`, `shutdown()`, `watchedFiles`. Register the instance via `connectorsManager.register(...)`; framework-level `warlock.config.ts > connectors` is planned but not shipped yet. Triggers: `BaseConnector`, `connectorsManager.register`, `ConnectorLifecyclePhase`, `ConnectorPriority`, `ConnectorName`; "add a queue worker", "wire a scheduler into bootstrap", "control startup ordering", "graceful shutdown hook"; typical import `import { BaseConnector, connectorsManager } from "@warlock.js/core"`. Skip: app context accessors — `@warlock.js/core/use-app-context/SKILL.md`; warlock.config.ts surface — `@warlock.js/core/configure-app/SKILL.md`; competing pattern: hand-rolled `process.on("SIGINT")` blocks, NestJS `OnModuleInit` lifecycle.'
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

That's the connector class. The file's home is `src/connectors/<name>.ts` by convention — but **placing it there does not register it**. Custom connectors must be registered explicitly via `connectorsManager.register(...)` (see [Registering a connector](#registering-a-connector) below).

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

`connectorsManager.register(new YourConnector())` is the only path today. Nothing scans `src/connectors/` automatically — the folder is a convention for *where the file lives*, not a discovery mechanism. Place the registration call in your project's `src/app/main.ts` (auto-loaded once at boot, before the manager runs the early-phase startup):

```ts title="src/app/main.ts"
import { connectorsManager } from "@warlock.js/core";
import { QueueConnector } from "../connectors/queue-connector";

connectorsManager.register(new QueueConnector());
```

`connectorsManager` is the singleton instance of `ConnectorsManager` exported from `@warlock.js/core`. `register(...connectors)` accepts one or many; it appends each to the list and re-sorts by priority.

Conditional registration is just an `if`:

```ts title="src/app/main.ts"
import { config, connectorsManager } from "@warlock.js/core";
import { ExperimentalIndexerConnector } from "../connectors/experimental-indexer-connector";

if (config.key("search.experimental.enabled")) {
  connectorsManager.register(new ExperimentalIndexerConnector());
}
```

> **Heads up — planned change.** A framework-level `warlock.config.ts > connectors: [...]` field is planned so connectors register the same way `cli.commands` do today. Once shipped, the canonical pattern becomes:
>
> ```ts title="warlock.config.ts (planned)"
> export default defineConfig({
>   connectors: [new QueueConnector(), new SchedulerConnector()],
> });
> ```
>
> Tracking: [`domains/core/plans/2026-05-23-connectors-in-warlock-config.md`](../../../../domains/core/plans/2026-05-23-connectors-in-warlock-config.md). Until that lands, use `connectorsManager.register(...)` in `main.ts`.

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
- **Production build still needs registration.** Placing the connector under `src/connectors/<name>.ts` doesn't auto-register it in dev or prod. The connector exists wherever its `connectorsManager.register(...)` call runs — typically `src/app/main.ts`. The production bundle picks up that registration because `main.ts` is auto-loaded.
- **`watchedFiles` is restart-trigger, not dependency.** It says "I want to restart when this file changes." It does *not* mean the framework reloads that file first — that's the file orchestrator's job.

## See also

- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `warlock.config.ts`, config files, env.
- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — checking environment + paths inside `start()`.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout, canonical imports.
