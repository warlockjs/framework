---
name: write-use-case
description: 'Author `useCase()` pipelines for business logic — guards, schema, before/after middleware, retry, benchmark, broadcast, lifecycle callbacks; transport-agnostic and observable by default. Input is inferred from the `schema`. Triggers: `useCase`, `UseCaseContext`, `UseCaseResult`, `retry`, `benchmark`, `broadcast`, `description`, `globalUseCasesEvents`, `UseCaseBroadcastChannel`; "encapsulate a business operation", "share logic between HTTP and CLI", "add guards and lifecycle hooks", "broadcast a use case result", "transport-agnostic pipeline"; typical import `import { useCase } from "@warlock.js/core"`. Skip: thin handler shape — `@warlock.js/core/create-controller/SKILL.md`; schema details — `@warlock.js/core/validate-input/SKILL.md`; the standalone retry util — `@warlock.js/core/retry-operation/SKILL.md`; competing libs `@nestjs/cqrs`, `inversify`, hand-rolled service classes.'
---

# Warlock — write a use case

A use case is a named, observable, transport-agnostic unit of business logic. The factory `useCase({ ... })` returns a typed async function you call with the input. Under the hood it runs a fixed pipeline — guards, schema validation, before middleware, handler, after middleware — then emits lifecycle events and optionally broadcasts the result. Retry and benchmark wrap the **handler only**.

## The shape

```ts title="src/app/orders/use-cases/place-order.usecase.ts"
import { useCase } from "@warlock.js/core";
import { v } from "@warlock.js/seal";
import { placeOrderService } from "../services/place-order.service";

export const placeOrderUseCase = useCase({
  name: "orders.placeOrder",
  description: "Place a new order",
  schema: v.object({
    productId: v.string(),
    quantity: v.int().min(1),
    userId: v.string(),
  }),
  handler: async (data) => placeOrderService(data),
});
```

**Input is inferred from `schema`** — `data` above is typed `{ productId: string; quantity: number; userId: string }` with no manual generic. When there's **no schema**, give the types explicitly: `useCase<Output, Input>({ ... })`.

```ts
const order = await placeOrderUseCase({ productId, quantity, userId });
```

## Pipeline phases

From `@warlock.js/core/src/use-cases/use-case.ts`, the order is fixed:

```
onExecuting → guards → schema → before → handler → after → onCompleted → broadcast
                                            ↘  (on error)
                                                onError
                                  └ retry + benchmark wrap the handler only ┘
```

| Phase         | Signature                                                              | Notes                                                                            |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `onExecuting` | `(ctx: UseCaseOnExecutingContext) => void`                            | Fires first (once). `ctx` carries `id`, `name`, `data`, `schema`, `startedAt`.    |
| `guards`      | `(data: Readonly<Input>, ctx: Ctx) => void \| Promise<void>`          | Authorization / precondition checks. **Throw to abort.** Enrich `ctx`, don't mutate `data`. |
| `schema`      | `ObjectValidator` (seal `v.object(...)`)                              | Runs after guards. Failures throw `BadSchemaUseCaseError` and skip the handler.   |
| `before`      | `(data: Input, ctx) => Input \| Promise<Input>`                       | Runs after schema. Sequential — each return becomes the next's input.            |
| `handler`     | `(data: Input, ctx) => Promise<Output>`                               | The work. Receives the post-`before` payload. Retry + benchmark wrap **this**.   |
| `after`       | `(output: Output, ctx) => void \| Promise<void>`                      | Fire-and-forget side effects on success. Errors are logged, never re-thrown.     |
| `onCompleted` | `(result: UseCaseResult<Output>) => void`                            | Lifecycle event with the full `UseCaseResult` snapshot.                          |
| `onError`     | `(ctx: UseCaseErrorResult) => void`                                  | Lifecycle event with the error + execution metadata.                            |

`ctx` is a `UseCaseContext` shared across every phase. With the optional `Ctx` generic (`useCase<Output, Input, MyCtx>`) it's typed end-to-end; guards write `ctx.currentUser`, the handler reads it.

## The full options surface

```ts
import type { RetryOptions } from "@mongez/reinforcements";

type UseCase<Output, Input, Ctx = UseCaseContext> = {
  name: string;
  description?: string;
  handler: (data: Input, ctx: Ctx) => Promise<Output>;
  schema?: ObjectValidator;
  guards?: UseCaseGuard<Input, Ctx>[];
  before?: UseCaseBeforeMiddleware<Input, Ctx>[];
  after?: UseCaseAfterMiddleware<Output, Ctx>[];
  onExecuting?: (ctx: UseCaseOnExecutingContext) => void;
  onCompleted?: (result: UseCaseResult<Output>) => void;
  onError?: (ctx: UseCaseErrorResult) => void;
  retry?: RetryOptions;                 // from @mongez/reinforcements
  benchmark?: boolean | BenchmarkOptions;
  broadcast?: boolean | { event?: string; output?: (output, result) => unknown };
};
```

Defaults come from `config.get("use-cases")` (`src/config/use-cases.ts`); per-use-case options win. Resolution per option: **per-use-case ?? global ?? framework default**.

## Retry

`retry` is the [`@mongez/reinforcements`](mongez-reinforcements-async) `RetryOptions` — `attempts` (total, default 3), `delay`, `backoff` (`"linear" | "exponential"` or a fn), `maxDelay`, `jitter`, `shouldRetry`, `signal`. It wraps the **handler only** — guards, validation, and `before` run once and are never retried.

```ts
export const flakyApiCallUseCase = useCase({
  name: "external.callFlakyApi",
  retry: {
    attempts: 4,                         // initial try + 3 retries
    delay: 500,
    backoff: "exponential",
    shouldRetry: (error) => !(error instanceof ValidationError), // skip 4xx
  },
  handler: async (data) => callExternalApi(data),
});
```

Opt-in: with no `retry`, the handler runs exactly once. The result snapshot reports `retries: { attempts, delay, currentRetry }` where `currentRetry` is the actual number of retries performed (0 = succeeded first try).

## Benchmark

```ts
export const expensiveReportUseCase = useCase({
  name: "reports.generate",
  benchmark: { latencyRange: { excellent: 200, poor: 1000 } },
  handler: async (data) => generateReport(data),
});
```

`benchmark: true` uses the global config defaults; an object customizes thresholds/hooks; `false` disables. It measures the **handler only** (per attempt) — never the guard/validation prelude or retry backoff delays. Each completed run gets `benchmarkResult: { latency, state }` in the snapshot.

## Broadcast

Publish the result onto a message bus on success — declaratively, "as if you'd published it yourself". The use case declares **what**; the global config declares **how** (the channels).

```ts
// 1. Per use case — opt in (WHAT to broadcast)
export const createUserUseCase = useCase({
  name: "users.create",
  schema: createUserSchema,
  handler: async (data) => User.create(data),
  broadcast: true,                       // → channel "users.create", payload = output as-is
});

// Project / rename to avoid leaking sensitive fields:
export const signupUseCase = useCase({
  name: "auth.signup",
  schema: signupSchema,
  handler: async (data) => signupService(data),
  broadcast: {
    event: "auth.signup",                // custom channel name (default = use case name)
    output: (result) => ({ id: result.id, email: result.email }), // never the raw model
  },
});
```

```ts
// 2. Global config — the transport (HOW). src/config/use-cases.ts
import { heraldBroadcast } from "@warlock.js/herald";

export default {
  broadcast: {
    enabled: true,                       // global kill-switch
    channels: [heraldBroadcast({ broker: "default" })],
  },
} satisfies UseCaseConfigurations;
```

- **Success-only.** Failures don't broadcast.
- **Isolated.** Fan-out is `Promise.allSettled` + try/catch — a dead broker is logged, never breaks the use case.
- **No-op** when `broadcast.enabled` is `false`, no channels are registered, or the use case didn't opt in.
- **Envelope** — consumers receive `{ useCase, event, id, at, payload }`; the `id` is the execution id for tracing/idempotency under at-least-once delivery.
- **Payload safety** — `broadcast: true` sends the output as-is, which serializes a model's full `toJSON` (can leak secrets). For anything sensitive, use the `output` projector.

Channels are **global-only** — a use case picks its event name, never its transport. Adding a second sink (socket, webhook) is one entry in `channels`, zero use-case edits.

## Guards

Guards run before validation. Throw to abort.

```ts
import { ConflictError, ForbiddenError, useCase } from "@warlock.js/core";

const requireOwner = async (data: { orderId: string }, ctx) => {
  const order = await Order.find(data.orderId);

  if (!order) {
    throw new ConflictError("order.notFound");
  }

  if (order.userId !== ctx.currentUser?.id) {
    throw new ForbiddenError("order.forbidden");
  }

  ctx.order = order; // available to handler
};

export const cancelOrderUseCase = useCase({
  name: "orders.cancel",
  guards: [requireOwner],
  handler: async ({ orderId }, ctx) => {
    await ctx.order.update({ status: "cancelled" });
    return { orderId, status: "cancelled" };
  },
});
```

Populate `ctx` from a controller via runtime options:

```ts
await cancelOrderUseCase(
  { orderId: request.input("id") },
  { ctx: { currentUser: request.user } },
);
```

## Before / after middleware

`before` runs after schema validation and transforms the data; `after` is fire-and-forget on success (errors logged, never propagated):

```ts
const enrichWithPricing = async (data, ctx) => {
  const price = await Pricing.lookup(data.productId);
  return { ...data, unitPrice: price };
};

const sendConfirmationEmail = async (output, ctx) => {
  await emails.send(ctx.currentUser.email, "Order placed", { orderId: output.orderId });
};

export const placeOrderUseCase = useCase({
  name: "orders.placeOrder",
  schema: orderSchema,
  before: [enrichWithPricing],
  handler: async (data) => placeOrderService(data),
  after: [sendConfirmationEmail],
});
```

The caller still gets the handler's output even if an `after` middleware throws — side effects don't fail the operation.

## Lifecycle callbacks

`onExecuting`, `onCompleted`, `onError` run for every invocation — for observability:

```ts
useCase({
  name: "billing.charge",
  onExecuting: ({ id, data }) => log.info("billing", "executing", { id }),
  onCompleted: ({ id, benchmarkResult }) =>
    metrics.histogram("billing.latency", benchmarkResult?.latency ?? 0, { id }),
  onError: ({ id, error }) => Sentry.captureException(error, { extra: { id } }),
  handler: async (data) => chargeService(data),
});
```

Global listeners exist too — `globalUseCasesEvents.onExecuting(...)` / `onCompleted(...)` / `onError(...)` — for cross-cutting telemetry without per-use-case wiring. Each observer is isolated: a throwing or slow observer can't break or stall the pipeline.

## Global config

`src/config/use-cases.ts` (`UseCaseConfigurations`):

```ts
export default {
  benchmark: true,                       // benchmark every handler by default
  log: false,                            // per-step debug logging via @warlock.js/logger
  history: { enabled: true, ttl: 3600, maxEntries: 100 },
  broadcast: { enabled: false, channels: [] },
} satisfies UseCaseConfigurations;
```

## Runtime options

```ts
await placeOrderUseCase(input, {
  id: "order-tracking-123",              // override auto-generated execution id
  ctx: { currentUser: user },            // pre-populate context for guards
  onCompleted: (result) => log.debug("done", result.benchmarkResult),
  onError: ({ error }) => log.error("failed", error),
});
```

Per-invocation callbacks fire first, then use-case-level, then globals. The returned function also carries `$cleanup()` to unregister the use case and drop its history.

## Use case vs service vs controller

| Layer      | What it owns                                                              | When to use                                |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| Controller | Pull from `request`, return via `response.<helper>()`                     | Always — the HTTP edge.                    |
| Service    | One unit of work, plain async function, no observability magic           | Most CRUD; one or two model touches.       |
| Use case   | Guards/validation/handler/after + retry + benchmark + broadcast + events | Cross-cutting concerns, multi-service orchestration, anything called from multiple transports (HTTP + CLI + queue). |

Don't reach for `useCase` for a 5-line service — the ceremony outweighs the benefit.

## Gotchas

- **`name` must be unique.** The registry de-dupes by name; a duplicate in dev logs a warning and one wins. Use namespaced names: `"orders.placeOrder"`.
- **Input is inferred from `schema`.** With a schema you don't pass generics; without one, pass `useCase<Output, Input>(...)`.
- **Retry wraps the handler only.** Guards, validation, and `before` run once and are never retried — retrying a 4xx is impossible by design. (This changed from older versions that retried the whole pipeline.)
- **Benchmark measures the handler only.** Latency excludes the prelude and retry backoff.
- **`retry` is the reinforcements shape** — `attempts` is the **total** (not extra) count. `attempts: 3` = 3 calls. Defaults to 3 when `retry` is set.
- **`broadcast: true` sends the output as-is.** A model instance serializes its full `toJSON` — use the `output` projector for anything sensitive.
- **Broadcast needs channels.** `broadcast: true` does nothing unless `config.broadcast.channels` has at least one adapter and `enabled` isn't `false`.
- **`after` errors are swallowed.** Fire-and-forget by design. Roll back inside the handler if a side-effect failure must abort.
- **Schema runs after guards.** Guards see the raw input shape, not the validated one.

## See also

- [`@warlock.js/core/create-controller/SKILL.md`](@warlock.js/core/create-controller/SKILL.md) — the usual next step: invoke this use case from an HTTP controller.
- [`@warlock.js/herald/publish-message/SKILL.md`](@warlock.js/herald/publish-message/SKILL.md) — the message bus the `broadcast` adapter publishes to (cross-package).

