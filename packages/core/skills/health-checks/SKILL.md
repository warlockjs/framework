---
name: health-checks
description: 'Built-in liveness (`/health`) and readiness (`/ready`) endpoints plus graceful HTTP request draining for zero-downtime deploys — the `health` registry (`health.addCheck`/`removeCheck`), the `http.health.*` and `http.gracefulShutdown.*` config, and how readiness ties into `Application.isShuttingDown`. Triggers: `health`, `health.addCheck`, `health.removeCheck`, `HealthCheck`, `/health`, `/ready`, `http.health`, `http.gracefulShutdown`, `forceCloseConnections`, "liveness probe", "readiness probe", "graceful shutdown", "drain in-flight requests", "zero-downtime deploy", "kubernetes health check", "503 until ready"; typical import `import { health } from "@warlock.js/core"`. Skip: the `Application.onShutdown` / `onceBooted` lifecycle hooks — `@warlock.js/core/use-app-context/SKILL.md`; maintenance-mode 503s — `@warlock.js/core/use-middleware/SKILL.md`; connector lifecycle — `@warlock.js/core/add-connector/SKILL.md`; competing libs `@fastify/under-pressure`, `terminus`, hand-rolled `/health` controllers.'
---

# Warlock — health checks & graceful shutdown

Two endpoints and a drain, so a load balancer never routes to an instance that isn't ready and a deploy never kills an in-flight request. All built in; no controller to hand-roll.

## The two endpoints

The HTTP connector registers them on the Fastify server during boot (before route scanning), so they exist by the time the server listens:

| Path | Probe | 200 when | 503 when |
| --- | --- | --- | --- |
| `/health` | liveness | the process is up | shutdown has begun |
| `/ready` | readiness | booted **and** not shutting down **and** every check passes | before boot, during shutdown, or any failing check |

**Liveness** answers "should the orchestrator RESTART me?" — it ignores dependency checks (a failing DB doesn't mean restart the pod). **Readiness** answers "should the load balancer ROUTE to me?" — it gates on boot completion, shutdown state, and your registered checks.

```
GET /health → 200 {"status":"ok"}
GET /ready  → 200 {"status":"ok","checks":{"db":true}}
            → 503 {"status":"error","checks":{"db":false}}
```

### Config

```ts title="src/config/http.ts"
const httpConfigurations: HttpConfigurations = {
  health: {
    enabled: true,          // default; set false to remove both endpoints
    path: "/health",        // liveness path
    readinessPath: "/ready", // readiness path
  },
};
```

## Readiness checks

Readiness is `isBooted && !isShuttingDown` plus every registered check. Register a check from a connector, a `main.ts`, or anywhere:

```ts
import { health } from "@warlock.js/core";

health.addCheck("db", async () => {
  return database.isConnected();
});

health.removeCheck("db"); // unregister later if needed
```

A check returns `boolean | Promise<boolean>`. **A thrown error counts as a failed check** (it's surfaced in the `checks` map + the 503, not logged — probes poll often, so a failure is a normal signal, not an error event). Keep checks cheap and fast; they run on every `/ready` poll.

## Graceful shutdown (request draining)

On SIGINT/SIGTERM the framework tears down in order: **app `onShutdown` hooks → connectors in reverse priority**. The HTTP connector's teardown drains instead of dropping:

1. `Application.isShuttingDown` flips `true` at the very start → `/ready` immediately returns 503, so the load balancer stops sending new traffic.
2. Fastify stops accepting new requests (answers 503 while closing) and lets in-flight ones finish.
3. Draining is bounded by a timeout so one stuck request can't hang the deploy — after it, the server force-closes and a warning is logged.

```ts title="src/config/http.ts"
const httpConfigurations: HttpConfigurations = {
  gracefulShutdown: {
    timeout: 10_000,              // ms to wait for in-flight drain (default 10s)
    forceCloseConnections: "idle", // close idle keep-alives, let active finish (default)
  },
};
```

`forceCloseConnections`: `"idle"` (default) closes idle keep-alive connections and lets active requests finish; `true` force-closes everything immediately; `false` waits for every connection.

## The zero-downtime deploy flow

```
SIGTERM → isShuttingDown = true → /ready returns 503
        → LB stops routing new requests to this instance
        → in-flight requests drain (up to gracefulShutdown.timeout)
        → app onShutdown hooks already ran (db/cache still up)
        → connectors close in reverse → process exits
```

For an even smoother handoff, give the load balancer time to observe the 503 before the server closes — e.g. an `onShutdown` hook with a short `sleep` matched to your LB's health-check interval.

## Gotchas

- **`/health` is registered straight on Fastify, not the app router.** It's infra, so it's immune to HMR and route scanning — but if your app also defines a `/health` route you'll have a collision. Rename via `http.health.path`.
- **Readiness needs a finished boot.** Before `Application.isBooted` (e.g. while late-phase connectors are still starting) `/ready` is 503 by design — that's the point.
- **A hanging `onShutdown` hook delays the drain.** App hooks run before connector teardown and are only bounded by your process manager's kill timeout; keep them fast. The HTTP drain itself is bounded by `gracefulShutdown.timeout`.
- **The `maintenance` middleware is a different 503.** It allowlists `/health` by default so probes pass during maintenance — but maintenance mode is operator-toggled downtime, not readiness. See `@warlock.js/core/use-middleware/SKILL.md`.

## See also

- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — `Application.onShutdown` / `onceBooted` / `isShuttingDown`, the lifecycle hooks the endpoints build on.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — the `src/config/http.ts` shape.
- [`add-connector/SKILL.md`](../add-connector/SKILL.md) — connector boot/shutdown order, where draining slots in.
- [`use-middleware/SKILL.md`](../use-middleware/SKILL.md) — maintenance mode and other built-in middleware.
