---
title: "Custom connector"
description: Plug a new subsystem (queue worker, scheduler, search client, custom broker) into Warlock's lifecycle — extend `BaseConnector`, pick a priority, decide Early vs Late, register it with connectorsManager, and get graceful SIGINT shutdown for free.
sidebar:
  order: 4
  label: "Custom connector"
---

A **connector** is a long-lived subsystem owned by the framework's lifecycle — `boot` → `start` → (run) → `shutdown`. The built-in ones are the logger, mailer, database, herald (message broker), cache, HTTP server, storage, socket, notifications, and access (authorization). Adding your own lets you plug a new subsystem into the same lifecycle: priority-based startup, graceful SIGINT shutdown, dev-server restart on config change. This recipe walks you through building one — we'll wire a background queue worker that depends on the database.

## When a connector is the right answer

A connector is the right shape when:

- The subsystem needs to **start once at boot** and **shut down once at exit** — not per-request.
- It has **external dependencies** (a TCP connection, a worker pool, a scheduled job) that need cleanup.
- Other parts of the app expect it to be **ready by the time `routes.ts` is loaded**.

A connector is the **wrong** shape for per-request work (use middleware), config loading (use `src/config/`), or background jobs you fire from inside a request handler (use Cascade events or the dispatcher pattern).

## The shape

```ts title="src/connectors/queue-worker-connector.ts"
import {
  BaseConnector,
  ConnectorLifecyclePhase,
  type ConnectorName,
} from "@warlock.js/core";

export class QueueWorkerConnector extends BaseConnector {
  public readonly name: ConnectorName = "queueWorker";
  public readonly priority = 10;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  protected readonly watchedFiles = ["src/config/queue.ts"];

  public async start(): Promise<void> {
    // open the connection, register handlers, start the worker pool…
    this.active = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    // drain queues, close connections, flush state…
    this.active = false;
  }
}
```

That's the entire shape. Put the file under `src/connectors/<name>.ts` (a convention, not a requirement) and register it with `connectorsManager.register(...)` — see [Registering the connector](#registering-the-connector) below. Five things to know — covered below in order.

## The required surface

Every `BaseConnector` subclass declares five members. Two are required readonly properties; one is a watched-files array; two are lifecycle methods.

| Member          | Type                          | Notes                                                                                |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `name`          | `ConnectorName`               | Unique. Used in preload lists (`preload: { connectors: ["queueWorker"] }`).          |
| `priority`      | `number`                      | Lower starts first. See the built-in `ConnectorPriority` enum for the existing ordering. |
| `lifecyclePhase`| `ConnectorLifecyclePhase`     | `Early` (default) or `Late`. Semantics below.                                        |
| `watchedFiles`  | `string[]` (protected)        | Relative paths; touching any triggers a restart in dev mode.                         |
| `start()`       | `() => Promise<void>`         | The work that brings the subsystem online. Set `this.active = true` on success.      |
| `shutdown()`    | `() => Promise<void>`         | Inverse — close connections, drain queues. Set `this.active = false`.                |

Optional overrides:

- **`boot()`** — runs before `start()`. Use for construction-only work that doesn't touch external state (build clients, populate the DI container). The built-in `HttpConnector` uses `boot` to construct Fastify and register plugins, then `start` to scan routes and call `listen()`.
- **`shouldRestart(changedFiles)`** — default checks `watchedFiles` (exact match, or glob match if the entry contains `*`). Override for custom logic.
- **`restart()`** — default is `shutdown()` + `start()`. Override if you need a re-`boot()` step in between.

`isActive()` is read-only on `BaseConnector`; flip the protected `this.active` flag inside `start`/`shutdown` instead.

## Picking a priority

Connectors start in ascending order of `priority` and shut down in reverse. The built-in ordering, from the `ConnectorPriority` enum:

| Connector       | Priority | Phase   |
| --------------- | -------- | ------- |
| `logger`        | `0`      | Early   |
| `mailer`        | `1`      | Early   |
| `database`      | `2`      | Early   |
| `herald`        | `3`      | Early   |
| `cache`         | `4`      | Early   |
| `http`          | `5`      | **Late** |
| `storage`       | `6`      | Early   |
| `socket`        | `7`      | **Late** |
| `notifications` | `8`      | Early   |
| `access`        | `9`      | Early   |

(The priority **constant** for herald is `COMMUNICATOR`, but the connector's runtime name is `herald`.)

Pick a number that places your connector where it belongs:

- **Queue worker that depends on the database**: `priority: 10`. After DB (2), after cache (4), before nothing in particular. The exact number doesn't matter as long as it's > 2.
- **A logger replacement**: `priority: -1`. Wins against `logger` (0).
- **Something that has to start before everything**: `priority: -10`. The project's `src/connectors/custom-connector.ts` does exactly this — it's the catch-all earliest slot.
- **Something that has to start after HTTP**: pick `> 5` (e.g. `priority: 50`) and `lifecyclePhase: Late`. To run after socket (7), pick something higher like `priority: 100` and `Late`.

There's no priority registry and no clash detection — two connectors with the same priority just run in registration order. The built-ins occupy `0`–`9`, so spread your project's connectors out by 10s (10, 20, 30) above that range so you can squeeze new ones in later without renumbering.

## Early vs Late phase

`ConnectorLifecyclePhase` exists because **HTTP and socket need user code loaded first**: they scan the router (which `routes.ts` files populate) and the DI container (which `main.ts` files mutate). So the framework boots in two passes:

1. **Early phase** runs before user code imports — for things user code needs _at import time_ (database/cache so models work, logger so app modules can `log.info`).
2. **Late phase** runs after user code imports — for things that consume registrations user code just made (HTTP reads the router, socket reads HTTP's instance).

If your connector is a **self-contained service** (queue client, scheduler, search index client), `Early` is correct. If it **depends on app-level registrations** that happen at module-load time, `Late`. Default is `Early` — don't change it without a reason.

A scheduler that reads job definitions from `src/app/<module>/main.ts`? `Late`. A queue worker that talks to Redis and doesn't care what your routes are? `Early`.

## Registering the connector

There is **one** way to register a connector: call `connectorsManager.register(new YourConnector())`. There is no auto-discovery — the framework does **not** scan `src/connectors/` and instantiate classes for you. The built-in connectors are registered the same way, in the `ConnectorsManager` constructor; yours go through the same door from your app's `main.ts`:

```ts title="src/app/main.ts"
import { connectorsManager } from "@warlock.js/core";
import { QueueWorkerConnector } from "../connectors/queue-worker-connector";

connectorsManager.register(new QueueWorkerConnector());
```

`connectorsManager` is the singleton exported from `@warlock.js/core`. `register(...connectors)` appends and re-sorts by priority, so registration order doesn't matter — only the `priority` property does. Do this at module top-level: `main.ts` is auto-loaded once at boot, _before_ the manager starts the connectors.

Because registration is explicit, conditional registration is trivial — gate it behind a config key, an env flag, anything:

```ts title="src/app/main.ts"
import { config, connectorsManager } from "@warlock.js/core";
import { ExperimentalIndexerConnector } from "../connectors/experimental-indexer-connector";

if (config.get("search.experimental.enabled")) {
  connectorsManager.register(new ExperimentalIndexerConnector());
}
```

## A complete queue worker example

A worker pool that consumes jobs from a Redis-backed queue. Depends on the database (for state) and runs in `Early` phase.

```ts title="src/connectors/queue-worker-connector.ts"
import {
  BaseConnector,
  ConnectorLifecyclePhase,
  type ConnectorName,
} from "@warlock.js/core";
import { log } from "@warlock.js/logger";
import { startWorkerPool, stopWorkerPool } from "app/queue/services/worker-pool.service";

export class QueueWorkerConnector extends BaseConnector {
  public readonly name: ConnectorName = "queueWorker";
  public readonly priority = 10;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  protected readonly watchedFiles = ["src/config/queue.ts"];

  public async start(): Promise<void> {
    await startWorkerPool();
    log.info("connector", "queueWorker", "Worker pool online");

    this.active = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    log.info("connector", "queueWorker", "Draining worker pool…");
    await stopWorkerPool();

    this.active = false;
  }
}
```

The work lives in `worker-pool.service.ts` — the connector is just the lifecycle adapter. Keep it that thin.

## A scheduler that runs after HTTP

A cron-style scheduler that needs the application to be fully wired before it can read job definitions:

```ts title="src/connectors/scheduler-connector.ts"
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
      this.runDueJobs();
    }, 60_000);

    this.active = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.active = false;
  }

  protected async runDueJobs(): Promise<void> {
    // …read the registered jobs, run the due ones
  }
}
```

`Late` because the scheduler reads job registrations that `main.ts` files create during user-code load. The `timer` is held on the instance so `shutdown` can clear it.

## `watchedFiles` and dev restarts

In the dev server, the file watcher emits a list of changed paths after every save. The connectors manager iterates connectors and asks each `shouldRestart(changedFiles)`. The default implementation matches the file against `watchedFiles` (exact match, or glob if the entry contains `*`).

Typical patterns:

- **Config file**: `"src/config/<name>.ts"` — the connector's own config. Restart when it changes.
- **`.env`**: usually **omitted**. The framework reloads env separately and reboots the world; per-connector watching of `.env` causes duplicate restarts.
- **User code (`src/app/**`)**: **don't watch**. That's what HMR is for.

If you need custom restart logic (e.g. only restart when a specific job-definition file changes), override `shouldRestart`:

```ts
public override shouldRestart(changedFiles: string[]): boolean {
  return changedFiles.some((file) =>
    file.startsWith("src/app/") && file.endsWith(".job.ts"),
  );
}
```

## Graceful shutdown

`ConnectorsManager` wires SIGINT/SIGTERM (and SIGHUP on Windows) to a `gracefulShutdown` handler that calls `shutdown()` on every connector **in reverse priority order**. Your `shutdown()` should:

1. **Stop accepting new work** — close listening sockets, stop consuming queues.
2. **Drain in-flight work**, bounded by a timeout you own.
3. **Close external connections** — database pools, message brokers, file handles.
4. **Set `this.active = false`.**

The manager swallows errors from individual `shutdown()`s (logs and continues) — one slow connector doesn't block the rest. You do _not_ need to call `process.exit()` yourself; the manager does that after the loop.

A solid shutdown:

```ts
public async shutdown(): Promise<void> {
  if (!this.active) {
    return;
  }

  // 1. stop pulling new work
  this.consumer.pause();

  // 2. drain in-flight, bounded
  const deadline = Date.now() + 30_000;
  while (this.inflight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  // 3. close
  await this.consumer.close();

  // 4. mark inactive
  this.active = false;
}
```

## Gotchas

- **Set `this.active = true` only on success.** If `start()` throws partway through and you've flipped the flag too early, `shutdown()` thinks it has real work to do and may double-close half-initialized resources.
- **`shutdown()` must be idempotent.** SIGINT can fire twice on Windows. The manager guards re-entry with its own flag, but individual connectors get called once per shutdown loop — guard with `if (!this.active) return;`.
- **Don't reach across connector boundaries in `start()`.** The manager's loop runs all `boot()`s first, then all `start()`s — wiring across connectors goes through the DI container (`container.get("http.server")`), not through imports.
- **Registration is explicit — there is no auto-discovery.** Putting a file in `src/connectors/` does nothing on its own. You must call `connectorsManager.register(new YourConnector())` (typically from `src/app/main.ts`). The framework never scans the folder for connector classes.
- **`watchedFiles` is a restart trigger, not a dependency.** It says "I want to restart when this file changes." It does _not_ mean the framework reloads that file first — that's the file orchestrator's job.
- **Don't pick `name`s the framework already uses.** `"logger"`, `"mailer"`, `"database"`, `"herald"`, `"cache"`, `"http"`, `"storage"`, `"socket"`, `"notifications"`, and `"access"` are taken. Pick something distinctive.

## See also

- ``add-connector` skill` — concise reference covering the same surface
- [Connectors](../architecture-concepts/connectors.md) — the catalog of all ten built-ins, their priorities, phases, and watched config files
- [Bootstrap and connectors](../architecture-concepts/bootstrap-and-connectors.md) — how the framework boots and where connectors slot in
- ``configure-app` skill` — `warlock.config.ts`, config files, env
- ``use-app-context` skill` — checking the environment and resolving paths inside `start()`
- [Custom CLI command recipe](./custom-cli-command.md) — the cousin pattern for one-shot operations
