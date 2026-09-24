---
name: request-tracing
description: 'Vendor-neutral request tracing hooks (`http.tracing`) — observe request start/end and named phase spans (`route.match`, `middleware`, `validation`, `handler`, `response.write`) without adopting an OTel/vendor dependency in `core`. Covers the `TracingHooks` shape, trace id derivation from an inbound W3C `traceparent` vs `request.id`, that a throwing hook is caught and reported once (never breaks the request), and zero overhead when disabled. Triggers: `http.tracing`, `TracingHooks`, `onRequestStart`, `onRequestEnd`, `onPhase`, `traceparent`, `traceId`, `dispatchPhase`, "instrument requests", "trace a request", "slow phase logging", "APM / OTel bridge for Warlock". Skip: request-id header echo/inheritance (`X-Request-Id`) — `@warlock.js/core/use-middleware/SKILL.md`; app-level structured logging — `@warlock.js/logger/logger-basics/SKILL.md`; competing libs `@opentelemetry/api` direct instrumentation, `express-request-id`, hand-rolled `X-Trace-Id` middleware.'
---

# Warlock — request tracing hooks

`http.tracing` gives every request a set of named phase spans and start/end
events, delivered to plain callbacks you register in config — no
`@opentelemetry/api` dependency in `core`, in this release or later (an OTel
bridge is a separate, optional package that subscribes to these hooks; it
does not exist yet). OFF by default, and a disabled app pays exactly one
cached boolean check per call site — no context object is built, no
`performance.now()` is called, nothing is allocated.

## Enabling it

```ts
// src/config/http.ts
export default {
  tracing: {
    enabled: true, // default false
    hooks: [
      {
        onRequestStart(ctx) {
          /* ctx: { traceId, requestId, method, route, path } */
        },
        onPhase(ctx, phase) {
          /* phase: { name, durationMs, attrs? } */
        },
        onRequestEnd(ctx, result) {
          /* result: { status?, durationMs, error? } */
        },
      },
    ],
  },
};
```

`enabled` is resolved once at first read and cached for the process — flipping
it requires a restart, the same trade-off as `http.maintenance.enabled` and
`http.requestId.enabled`.

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

Every verb is optional — a hook that only wants phase spans need not implement
`onRequestStart`/`onRequestEnd`. Register as many hooks as you like via
`hooks: TracingHooks[]`; each fires independently.

## Phase names

`core` wires five phases into the request lifecycle, in this order, for every
HTTP request:

| Phase | Fires around |
| --- | --- |
| `route.match` | Resolving the incoming path/method to a registered route |
| `middleware` | Each middleware in the route's chain — one `onPhase` call per middleware, with `attrs: { name, index }` |
| `validation` | The route's input validation (`v.object(...)` / RESTful resource validation) |
| `handler` | The route handler itself |
| `response.write` | The overall request span, closed once the response has settled (success or thrown error) — this is also where `onRequestEnd` fires |

`@warlock.js/web` page requests report through this same `onPhase` surface
instead of adding a separate hook API. They add three phases:

| Phase | Fires around |
| --- | --- |
| `loader` | Each loader level, once per app/layout/page, with `attrs: { level, layoutPath? }` |
| `render.shell` | Time from render start until React's shell is ready to stream |
| `stream.end` | The whole streamed response, including every `defer()` value settling |

## Trace id derivation

`ctx.traceId` is derived once per request:

1. If the inbound `traceparent` header is a valid W3C version-`00` header
   (`00-<32 hex>-<16 hex>-<2 hex>`, trace id not all-zero), `traceId` is that
   header's trace id — so a request already inside someone else's distributed
   trace keeps the same id through Warlock.
2. Otherwise `traceId` falls back to `request.id` (the framework's own
   per-request correlation id — see
   [`use-middleware/SKILL.md`](../use-middleware/SKILL.md#request-id-correlation)
   for how that id is generated/inherited/echoed).

`ctx.requestId` is always `request.id`, regardless of which branch produced
`traceId` — so a hook can always join back to the same id the framework logs
and echoes on `X-Request-Id`, even when `traceId` came from an inbound header.

```ts
import { deriveTraceId, parseTraceparentTraceId } from "@warlock.js/core";

parseTraceparentTraceId("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
// -> "4bf92f3577b34da6a3ce929d0e0e4736"

deriveTraceId(undefined, "req-abc123");
// -> "req-abc123" (no traceparent, falls back to requestId)
```

## Response header: no new one

Tracing does **not** add a response header of its own. `core` already echoes
`request.id` back as `X-Request-Id` on every response (see
[`use-middleware/SKILL.md`](../use-middleware/SKILL.md#request-id-correlation)) —
apps correlate through that existing header. When a valid inbound
`traceparent` is present, `ctx.traceId` inside your hooks carries that trace
id even though the response header still reflects `request.id`; if you need
the resolved `traceId` on the wire (e.g. to hand back to a caller that sent
`traceparent`), read it from your own `onRequestStart`/`onPhase` hook and set
it yourself — `core` deliberately doesn't duplicate it into a second header.

## A throwing hook never breaks a request

Every hook call is wrapped: if a hook throws, the dispatcher catches it,
reports it once per `(hook, verb)` pair per process to the error sink, and
continues with the next hook. A hook that throws on every request does not
flood your logs and never turns an observability bug into a 500 for real
traffic.

## Zero overhead when disabled

`http.tracing.enabled` is resolved once (lazily, on first read) and cached —
never re-read per request. Every instrumented call site checks that cached
boolean **before** building a context object or calling `performance.now()`,
so a disabled app pays exactly one boolean check per phase and allocates
nothing extra. Don't wrap `dispatchPhase`/`buildTracingContext` calls in your
own extra guard — the check is already there.

## Example: log phases slower than a threshold

```ts
// src/config/http.ts
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

- **No OTel dependency, and none planned for `core`.** An OTel (or other
  vendor) bridge is a separate, optional package that subscribes to these
  hooks — never add `@opentelemetry/api` to `core` itself.
- **`web`'s phases aren't live yet.** Don't register a hook expecting
  `loader`/`render.shell`/`stream.end` calls today; only the five `core`
  phases fire in this release.
- **`route` is `undefined` until routing has matched.** There's no path where
  a hook fires before that, but code branching on `ctx.route` for an
  early-failing request (e.g. a 404 with no match) must handle `undefined`.
- **`traceId` is not a second correlation id to store separately by default.**
  It equals `requestId` unless the caller sent a valid `traceparent` — don't
  assume it's always a 32-hex OTel-shaped value.
- **Toggling `enabled` needs a restart.** It's resolved once per process, the
  same trade-off as `http.maintenance.enabled`.

## See also

- [`use-middleware/SKILL.md`](../use-middleware/SKILL.md#request-id-correlation) — `X-Request-Id` inheritance/echo, the header tracing correlates through.
- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — request-scoped ALS context (`request`/`response`) tracing hooks run inside.
- [`@warlock.js/logger/logger-basics/SKILL.md`](../../../logger/skills/logger-basics/SKILL.md) — structured logging; tracing hooks are the place to bridge phase timing into your log channel.
