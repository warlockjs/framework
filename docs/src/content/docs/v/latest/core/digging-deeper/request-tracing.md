---
title: "Request tracing"
description: "http.tracing — opt-in, vendor-neutral request tracing hooks: onRequestStart / onRequestEnd / onPhase, the five core phases plus web's page phases, trace id derivation from traceparent vs request.id, and zero overhead when disabled."
sidebar:
  order: 17
  label: "Request tracing"
---

**New in 5.12.** `http.tracing` gives every request a set of named phase spans and start/end events, delivered to plain callbacks you register in config — no `@opentelemetry/api` dependency in `@warlock.js/core`, in this release or later. An OTel (or other vendor) bridge is a separate, optional package that would subscribe to these hooks; it does not exist yet. Off by default, and a disabled app pays exactly one cached boolean check per call site — no context object is built, no `performance.now()` is called, nothing is allocated.

## Enabling it

```ts title="src/config/http.ts"
export default {
  tracing: {
    enabled: true, // default false
    hooks: [
      {
        onRequestStart(ctx) {
          // ctx: { traceId, requestId, method, route, path }
        },
        onPhase(ctx, phase) {
          // phase: { name, durationMs, attrs? }
        },
        onRequestEnd(ctx, result) {
          // result: { status?, durationMs, error? }
        },
      },
    ],
  },
};
```

`enabled` is resolved once at first read and cached for the process — flipping it requires a restart, the same trade-off as `http.maintenance.enabled` and `http.requestId.enabled`.

## The `TracingHooks` shape

```ts
type TracingContext = {
  traceId: string; // see "Trace id derivation" below
  requestId: string; // request.id
  method: string;
  route?: string; // matched pattern, e.g. "/users/:id" — undefined before routing
  path: string;
};

type TracingPhaseInfo = {
  name: string;
  durationMs: number;
  attrs?: Record<string, unknown>;
};

type TracingRequestEndInfo = {
  status?: number;
  durationMs: number;
  error?: unknown;
};

type TracingHooks = {
  onRequestStart?(ctx: TracingContext): void;
  onRequestEnd?(ctx: TracingContext, result: TracingRequestEndInfo): void;
  onPhase?(ctx: TracingContext, phase: TracingPhaseInfo): void;
};
```

Every verb is optional — a hook that only wants phase spans need not implement `onRequestStart`/`onRequestEnd`. Register as many hooks as you like via `hooks: TracingHooks[]`; each fires independently.

## Phase names

`core` wires five phases into the request lifecycle, in this order, for every HTTP request:

| Phase             | Fires around                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `route.match`     | Resolving the incoming path/method to a registered route                                          |
| `middleware`      | Each middleware in the route's chain — one `onPhase` call per middleware, with `attrs: { name, index }` |
| `validation`      | The route's input validation (`v.object(...)` / RESTful resource validation)                      |
| `handler`         | The route handler itself                                                                          |
| `response.write`  | The overall request span, closed once the response has settled (success or thrown error) — this is also where `onRequestEnd` fires |

`@warlock.js/web` page requests report through this same `onPhase` surface instead of adding a separate hook API. They add three phases:

| Phase          | Fires around                                                                       |
| -------------- | ------------------------------------------------------------------------------------ |
| `loader`       | Each loader level, once per app/layout/page, with `attrs: { level, layoutPath? }`  |
| `render.shell` | Time from render start until React's shell is ready to stream                       |
| `stream.end`   | The whole streamed response, including every `defer()` value settling               |

## Trace id derivation

`ctx.traceId` is derived once per request:

1. If the inbound `traceparent` header is a valid W3C version-`00` header (`00-<32 hex>-<16 hex>-<2 hex>`, trace id not all-zero), `traceId` is that header's trace id — so a request already inside someone else's distributed trace keeps the same id through Warlock.
2. Otherwise `traceId` falls back to `request.id` (the framework's own per-request correlation id — see [Security → Request-id correlation](./security.md#request-id-correlation) for how that id is generated/inherited/echoed).

`ctx.requestId` is always `request.id`, regardless of which branch produced `traceId` — so a hook can always join back to the same id the framework logs and echoes on `X-Request-Id`, even when `traceId` came from an inbound header.

```ts
import { deriveTraceId, parseTraceparentTraceId } from "@warlock.js/core";

parseTraceparentTraceId("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
// -> "4bf92f3577b34da6a3ce929d0e0e4736"

deriveTraceId(undefined, "req-abc123");
// -> "req-abc123" (no traceparent, falls back to requestId)
```

## Correlating with `X-Request-Id`

Tracing does **not** add a response header of its own. `core` already echoes `request.id` back as a response header (`X-Request-Id` by default) on every response — apps correlate through that existing header. When a valid inbound `traceparent` is present, `ctx.traceId` inside your hooks carries that trace id even though the response header still reflects `request.id`; if you need the resolved `traceId` on the wire (e.g. to hand it back to a caller that sent `traceparent`), read it from your own `onRequestStart`/`onPhase` hook and set it yourself — `core` deliberately doesn't duplicate it into a second header.

## A throwing hook never breaks a request

Every hook call is wrapped: if a hook throws, the dispatcher catches it, reports it once per `(hook, verb)` pair per process to the error sink, and continues with the next hook. A hook that throws on every request does not flood your logs and never turns an observability bug into a 500 for real traffic.

## Zero overhead when disabled

`http.tracing.enabled` is resolved once (lazily, on first read) and cached — never re-read per request. Every instrumented call site checks that cached boolean **before** building a context object or calling `performance.now()`, so a disabled app pays exactly one boolean check per phase and allocates nothing extra.

## Example: log phases slower than a threshold

```ts title="src/config/http.ts"
import { log } from "@warlock.js/logger";

const SLOW_MS = 200;

export default {
  tracing: {
    enabled: env("TRACING_ENABLED") === "true",
    hooks: [
      {
        onPhase(ctx, phase) {
          if (phase.durationMs < SLOW_MS) return;

          log.warn("http", "slow-phase", {
            traceId: ctx.traceId,
            requestId: ctx.requestId,
            route: ctx.route,
            phase: phase.name,
            durationMs: phase.durationMs,
            attrs: phase.attrs,
          });
        },
      },
    ],
  },
};
```

## Gotchas

- **No OTel dependency, and none planned for `core`.** An OTel (or other vendor) bridge is a separate, optional package that subscribes to these hooks — never add `@opentelemetry/api` to `core` itself.
- **`web`'s phases aren't live in every release.** Confirm your installed `@warlock.js/web` version fires `loader`/`render.shell`/`stream.end` before relying on them; core's five phases fire unconditionally once tracing is enabled.
- **`route` is `undefined` until routing has matched.** There's no path where a hook fires before that, but code branching on `ctx.route` for an early-failing request (e.g. a 404 with no match) must handle `undefined`.
- **`traceId` is not a second correlation id to store separately by default.** It equals `requestId` unless the caller sent a valid `traceparent` — don't assume it's always a 32-hex OTel-shaped value.
- **Toggling `enabled` needs a restart.** It's resolved once per process, the same trade-off as `http.maintenance.enabled`.

## See also

- [Security](./security.md) — the rest of Warlock's transport and middleware security surface.
- [Logging](./logging.md) — structured logging; tracing hooks are the place to bridge phase timing into your log channel.
