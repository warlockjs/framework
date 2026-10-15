---
title: "Events & hooks"
description: A unified map of the event surfaces scattered across the framework — Response static events, per-request events, use-case lifecycle hooks, and mail events — with their exact import, signature, firing conditions, and how to unsubscribe.
sidebar:
  order: 11
  label: "Events & hooks"
---

There is no single "event bus" in `@warlock.js/core`. Instead, a handful of subsystems each expose their own listener surface. This page is the map: every confirmed event hook, where it comes from, when it actually fires, and how you detach it. The goal is to stop you from guessing — each entry below was read off the source, and where a declared event is **never fired** (or a documented subscribe path is **broken**), it says so plainly.

Most of these surfaces sit on top of [`@mongez/events`](https://www.npmjs.com/package/@mongez/events) — the framework's lightweight event emitter. `@mongez/events` is **not** re-exported from `@warlock.js/core`, so when you need the raw bus (e.g. to subscribe to per-request events), import it directly from `@mongez/events`.

## The 30-second look

```ts title="src/app/orders/main.ts"
import { Response, globalUseCasesEvents, mailEvents } from "@warlock.js/core";
import events from "@mongez/events";

// 1. Response — every JSON response, app-wide
const sub = Response.on("success", (response) => {
  metrics.increment("http.success");
});

// 2. Use-case — every use case that completes
const off = globalUseCasesEvents.onCompleted((result) => {
  metrics.track(result.name, result.benchmarkResult?.latency);
});

// 3. Mail — every email that sends
const mailSub = mailEvents.onSuccess((mail, result) => {
  log.info("mail", "sent", result.messageId);
});

// 4. Per-request — subscribe through the raw bus
const reqSub = events.subscribe("request.executedAction", (route, request) => {
  // …
});

// Each returns a detach handle — keep it and clean up (see Gotchas).
sub.unsubscribe();
off.unsubscribe();
mailSub.unsubscribe();
reqSub.unsubscribe();
```

Four independent surfaces, four slightly different shapes. The sections below cover each one precisely.

## Surfaces at a glance

| Surface             | Import from              | Subscribe with                              | Returns                          |
| ------------------- | ------------------------ | ------------------------------------------- | -------------------------------- |
| Response (static)   | `@warlock.js/core`       | `Response.on(event, listener)`              | `EventSubscription` (`.unsubscribe()`) |
| Per-request         | `@mongez/events`         | `events.subscribe("request.<event>", cb)`   | `EventSubscription` (`.unsubscribe()`) |
| Use-case lifecycle  | `@warlock.js/core`       | `globalUseCasesEvents.on*(cb)`              | `{ unsubscribe() }`              |
| Mail                | `@warlock.js/core`       | `mailEvents.on*(cb)`                         | `EventSubscription` (`.unsubscribe()`) |
| Cascade model       | your model               | `Model.events().onCreated(cb)` (see below)  | subscription handle             |

---

## Response events (static, app-wide)

`Response.on(event, listener)` registers a listener that fires for **every** response of that type, across the whole app. It is a static method — you subscribe once (typically in a module's `main.ts`) and it applies to all requests.

```ts title="src/app/observability/main.ts"
import { Response } from "@warlock.js/core";

const sub = Response.on("error", (response) => {
  // response is the Warlock Response instance — read status, body, request
  log.error("http", "error", `${response.statusCode} on ${response.request.path}`);
});

// later, to detach:
sub.unsubscribe();
```

- **Import**: `import { Response } from "@warlock.js/core"`
- **Signature**: `Response.on(event: ResponseEvent, listener: (response: Response) => void): EventSubscription`
- **Returns**: an `EventSubscription` from `@mongez/events` — call `.unsubscribe()` to detach.
- **Listener arg**: the framework `Response` instance (not the raw Fastify reply). Use `response.statusCode`, `response.body`, `response.parsedBody`, `response.request`, etc.

Under the hood, `Response.on(event, …)` subscribes to the `response.${event}` channel on the global bus, and the response fires it via an internal `trigger()` that defers one tick (`setTimeout(…, 0)`) so per-request work settles first.

### Which events actually fire

The `ResponseEvent` type declares fifteen names, but not all of them are wired. This table reflects what `send()` (and the streaming paths) actually trigger:

| Event                | Fires when                                                | Fired by               |
| -------------------- | --------------------------------------------------------- | ---------------------- |
| `sending`            | before the body is written, every response                | `send()`, `stream()`, `sse()` |
| `sendingJson`        | `sending`, and the content-type is `application/json`     | `send()`               |
| `sendingSuccessJson` | `sendingJson`, and the status is 2xx                      | `send()`               |
| `sent`               | after the body is written, every response                 | `send()`, `stream().end()`, `sse().end()` |
| `success`            | status is 2xx                                             | `send()`, `stream().end()`, `sse().end()` |
| `successCreate`      | status is exactly 201                                    | `send()`, `stream().end()` |
| `badRequest`         | status is exactly 400                                    | `send()`               |
| `unauthorized`       | status is exactly 401                                    | `send()`               |
| `forbidden`          | status is exactly 403                                    | `send()`               |
| `notFound`           | status is exactly 404                                    | `send()`               |
| `contentTooLarge`    | status is exactly 413                                    | `send()`               |
| `throttled`          | status is exactly 429                                    | `send()`               |
| `serverError`        | status is exactly 500                                    | `send()`               |
| `error`              | status is 4xx or 5xx (any `>= 400`)                       | `send()`               |

> **`sendingBadRequestJson` is declared but never fired.** The name exists on the `ResponseEvent` type (and is therefore accepted by `Response.on`), but nothing in the framework triggers it. Subscribing to it is silently dead — use `badRequest` for the equivalent (it fires after the body is written, not before). This is a known gap.

A few sequencing notes worth knowing:

- The `sending*` group is **awaited** before the body is written, so a `sending` listener can still mutate `response.body`. The `sent`/status-specific group is fired **after** the write and is **not** awaited.
- On the streaming paths (`response.stream()` and `response.sse()`), only `sending`, `sent`, and `success` fire — the JSON and per-status-code events do not. Those paths bypass `send()` deliberately. `successCreate` additionally fires on `stream().end()` (for a 201), but **not** on `sse().end()`.
- `error` is **not** mutually exclusive with the specific code events — a 404 fires both `notFound` and `error`.

---

## Per-request events

Each request goes through four lifecycle points. The request object **triggers** them, but you subscribe through the global bus, not through a method on the request.

```ts title="src/app/audit/main.ts"
import events from "@mongez/events";
import type { Request } from "@warlock.js/core";

// The triggering request is always the LAST argument.
const sub = events.subscribe(
  "request.executedAction",
  (route, request: Request) => {
    log.info("audit", "handled", `${request.method} ${request.path}`);
  },
);

sub.unsubscribe();
```

- **Subscribe with**: `events.subscribe("request.<event>", callback)` — `events` from `@mongez/events`.
- **Channel name**: the request fires `request.${eventName}`, so subscribe to that exact channel.
- **Callback args**: whatever the trigger passes, **followed by the `Request` instance as the final argument** (the request appends itself on every `trigger`).

### The four events

| Event                 | Fires when                                                          | Extra args before `request` |
| --------------------- | ------------------------------------------------------------------ | --------------------------- |
| `executingMiddleware` | just before the route's middleware chain runs (only if there is at least one middleware) | `middlewares`, `route`      |
| `executedMiddleware`  | after the middleware chain finishes — both when a middleware short-circuits and when all pass | `middlewares`, `route` (none on the short-circuit path) |
| `executingAction`     | just before the route handler runs                                 | `route`                     |
| `executedAction`      | just after the route handler returns successfully                  | `route`                     |

All four are genuinely fired (`executingMiddleware` / `executedMiddleware` from the request's middleware runner, `executingAction` / `executedAction` from the request-context middleware that wraps the handler).

> **`request.on(...)` is broken — do not use it.** The `Request` class exposes an `on(eventName, callback)` method, but its body calls `this.subscribe(...)`, and **no `subscribe` method exists** on the class (it doesn't extend an emitter). Calling `request.on(...)` throws `this.subscribe is not a function` at runtime. The index signature on `Request` hides this from the type checker. Subscribe through `events.subscribe("request.<event>", …)` instead, as shown above. `request.trigger(event, …)` works fine — it's only the subscribe side that's unwired.

Because subscriptions on the global bus are app-wide (not per-request), a listener you register stays registered until you `.unsubscribe()` it. Register them once at boot, not inside a handler.

---

## Use-case lifecycle events

Use cases expose three global lifecycle hooks via `globalUseCasesEvents`. These fire for **every** use case execution in the app, in addition to any per-use-case (`onExecuting`/`onCompleted`/`onError` in the definition) or per-invocation callbacks.

```ts title="src/app/use-cases/observe.ts"
import { globalUseCasesEvents } from "@warlock.js/core";

const onStart = globalUseCasesEvents.onExecuting((ctx) => {
  // ctx: { name, id, data, schema?, ctx, startedAt }
  log.info("use-case", ctx.name, "started");
});

const onDone = globalUseCasesEvents.onCompleted((result) => {
  // result: { name, id, output?, ctx, startedAt, endedAt, calls, retries?, benchmarkResult? }
  metrics.track(result.name, result.benchmarkResult?.latency);
});

const onFail = globalUseCasesEvents.onError((ctx) => {
  // ctx: same as onCompleted minus `output`, plus `error`
  log.error("use-case", ctx.name, ctx.error.message);
});

// Each call returns an object with an unsubscribe method:
onStart.unsubscribe();
onDone.unsubscribe();
onFail.unsubscribe();
```

- **Import**: `import { globalUseCasesEvents } from "@warlock.js/core"`
- **Methods**: `onExecuting(cb)`, `onCompleted(cb)`, `onError(cb)`
- **Returns**: `{ unsubscribe: () => void }` — note this is a plain object, **not** an `EventSubscription` (these hooks are backed by simple callback arrays, not `@mongez/events`).

### When each fires

| Hook          | Fires                                                                 | Callback arg                |
| ------------- | -------------------------------------------------------------------- | --------------------------- |
| `onExecuting` | at the start of execution, **before guards/validation run**          | `UseCaseOnExecutingContext` |
| `onCompleted` | after the handler (and any retries) succeed                          | `UseCaseResult<Output>`     |
| `onError`     | when a guard, validation, or the handler throws                     | `UseCaseErrorResult`        |

Ordering: for each lifecycle point, observers fire in **invocation → use-case → global** order. Every observer is awaited sequentially and isolated in its own `try/catch`, so one slow or throwing observer can't stall or break the others — a throwing global observer will **not** fail an otherwise-successful use case (it's logged via `@warlock.js/logger`).

For the full result/context shapes (`UseCaseResult`, `UseCaseOnExecutingContext`, `UseCaseErrorResult`) and the per-use-case `onExecuting`/`onCompleted`/`onError` definition hooks, see [Use cases](../the-basics/04-use-cases.md) and the [Use-cases deep dive](../the-basics/use-cases-deep.md).

---

## Mail events

The mail subsystem fires events globally (for all mail) and per-mail (scoped to a single send by ID). Subscribe through the `mailEvents` helper.

```ts title="src/app/notifications/main.ts"
import { mailEvents } from "@warlock.js/core";

// Global — fires for every email
const sub = mailEvents.onSuccess((mail, result) => {
  log.info("mail", "delivered", result.messageId);
});

const errSub = mailEvents.onError((mail, error) => {
  log.error("mail", "failed", error.message);
});

sub.unsubscribe();
errSub.unsubscribe();
```

- **Import**: `import { mailEvents } from "@warlock.js/core"`
- **Returns**: an `EventSubscription` (`.unsubscribe()`) — these are backed by `@mongez/events`.

### Global listeners

| Method                     | Fires                                              | Callback signature                        |
| -------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `onBeforeSending(cb)`      | before each send; **return `false` to cancel** it  | `(mail) => void \| false \| Promise<…>`   |
| `onSuccess(cb)`            | after a successful send                            | `(mail, result) => void`                  |
| `onError(cb)`              | when a send throws                                 | `(mail, error) => void`                   |
| `onSent(cb)`               | after every send attempt, success **or** failure   | `(mail, result, error) => void`           |

These fire across all three mail modes. In **test** mode and **development** mode the mail isn't actually transmitted (it's captured / logged), but `success` and `sent` still fire so your observers behave consistently; only **production** mode performs a real send and can fire `error`.

### Per-mail listeners

To listen to a single email, generate an ID, attach a scoped listener, then pass the same ID to `sendMail`:

```ts title="src/app/auth/services/send-welcome.ts"
import { mailEvents, sendMail, generateMailId } from "@warlock.js/core";

const mailId = generateMailId();

mailEvents.onMailSuccess(mailId, (mail, result) => {
  log.info("mail", "welcome-delivered", result.messageId);
});

await sendMail({
  id: mailId,
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>Hello!</p>",
});
```

The per-mail helpers mirror the global ones: `onMailBeforeSending(id, cb)`, `onMailSuccess(id, cb)`, `onMailError(id, cb)`, `onMailSent(id, cb)`. All return an `EventSubscription`.

See [Sending mail](./mail.md) for the full mail surface (drivers, modes, attachments, React emails).

---

## Cascade model events → repository cache invalidation

Cascade models emit their own events (`onCreated`, `onUpdated`, `onDeleted`), and **these are what drive repository cache invalidation** — not any repository-level lifecycle hook. When you back a repository with the Cascade adapter, the adapter subscribes to the model's `onCreated`/`onUpdated`/`onDeleted` events and clears the repository cache on each:

```ts
// Inside the Cascade adapter (illustrative — you don't write this):
const modelEvents = this.model.events();

modelEvents.onCreated((model) => clearRepositoryCache(model));
modelEvents.onUpdated((model) => clearRepositoryCache(model));
modelEvents.onDeleted((model) => clearRepositoryCache(model));
```

The practical takeaway: if you mutate data **through the model** (`model.save()`, `model.destroy()`), the repository cache invalidates automatically. If you bypass the model (raw query, bulk update), those events don't fire and the cache won't clear.

> **Repository lifecycle hooks are not the mechanism.** The repository's own `onCreating`/`onUpdating`/`onDeleting`/etc. hooks are defined but **not currently wired** into `create()`/`update()`/`delete()`. Don't rely on them for cache invalidation or side effects — use the model events (above) or override the repository action method directly.

For the model event API itself (subscribing to `onCreated` on your own models), see the Cascade model documentation.

## Gotchas

- **Listener leaks on HMR.** Every surface here registers app-wide listeners. If you call `Response.on(...)`, `globalUseCasesEvents.on*(...)`, `mailEvents.on*(...)`, or `events.subscribe(...)` at a module's **top level**, each hot reload during dev piles on another listener — and they fire on every event thereafter. Register in a module's `main.ts` (auto-loaded once per boot, not per re-import), and/or keep the returned handle and `.unsubscribe()` on cleanup.
- **Keep the unsubscribe handle.** Every subscribe call returns a detach handle — an `EventSubscription` with `.unsubscribe()` (Response, mail, per-request) or a plain `{ unsubscribe() }` object (use-case hooks). Discard it and you can never detach the listener.
- **`request.on(...)` throws — use the bus.** As covered above, `request.on(...)` calls a non-existent `this.subscribe(...)`. Subscribe to per-request events via `events.subscribe("request.<event>", …)` from `@mongez/events`.
- **`sendingBadRequestJson` never fires.** It's a declared `ResponseEvent` that nothing triggers. Use `badRequest` instead.
- **Response events defer one tick.** `Response.trigger` wraps dispatch in `setTimeout(…, 0)`, so a `sending` listener runs slightly after the synchronous send call returns. Don't assume a Response listener has run by the next synchronous line.
- **Streaming skips most Response events.** `response.stream()` and `response.sse()` only fire `sending`/`sent`/`success` — not the JSON or per-status-code events (`successCreate` also fires on `stream().end()` for a 201, but not on `sse().end()`). If your observer must see every response, account for the streaming paths separately.
- **Use-case observers can't fail the use case.** A throwing `globalUseCasesEvents` observer is caught and logged, never rethrown. Good for isolation, but it means a silently-broken observer won't surface as a failed use case — check your logs.

## See also

- [Use cases](../the-basics/04-use-cases.md) and the [Use-cases deep dive](../the-basics/use-cases-deep.md) — the lifecycle pipeline behind `globalUseCasesEvents`, plus the per-use-case and per-invocation callbacks.
- [Sending mail](./mail.md) — the full mail surface that `mailEvents` observes.
- [Sockets](./socket.md) — real-time push, the other half of "the server has something to say."
- [Benchmark](./benchmark.md) — `benchmarkResult` on the use-case `onCompleted` payload comes from here.
- [`@mongez/events`](https://www.npmjs.com/package/@mongez/events) — the underlying emitter (`subscribe`, `trigger`, `EventSubscription`). Import it directly; it is not re-exported from core.
