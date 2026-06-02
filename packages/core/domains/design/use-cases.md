# `@warlock.js/core` — Use Cases (design)

**Status:** Agreed (decisions 1–11 settled 2026-05-29; open sub-points flagged inline)
**Related:**

- Code: `@warlock.js/core/src/use-cases/`, `@warlock.js/core/src/benchmark/`
- Retry: `@mongez/reinforcements` `retry` (replaces the local `src/retry`) — upstream plan `D:/xampp/htdocs/mongez/node/@mongez/plans/retry-enhancements.md`
- Decisions log: [`decisions.md`](./decisions.md) (2026-05-29 entry)
- Plan: [`../plans/2026-05-29-use-cases-overhaul.md`](../plans/2026-05-29-use-cases-overhaul.md)
- Skills (lockstep): `@warlock.js/core/write-use-case`, `@warlock.js/core/benchmark-code`, `@warlock.js/herald/publish-message`

---

## What a use case is

A transport-agnostic, observable, optionally benchmarked/retried unit of business logic. `useCase(def)` returns a typed async executor callable from anywhere (HTTP, CLI, queue, cron, tests, other use cases).

Pipeline (fires **once**):

```
onExecuting → guards → schema validation → before → [ retry(handler) ] → after → onCompleted | onError → broadcast
                                            └─ measure() wraps the handler ─┘
```

---

## Current defects this design fixes

Verified against source, 2026-05-29:

1. **Success counter corrupted on failure** — `increaseUseCaseSuccessCalls` runs unconditionally before the `if (error)` branch (`use-case.ts:157`); every failure bumps `success` and double-bumps `total`.
2. **Retry re-runs the whole pipeline** — `retry(execute)` wraps `runPipeline`, so `onExecuting` re-fires and guards/validation re-run on every attempt; validation 4xx get pointlessly retried.
3. **Benchmark measures retry sleeps** — `measure(name, run)` wraps the retry loop, so backoff delay lands in latency.
4. **No selective retry** — local retry had `shouldRetry`; we're moving to `@mongez/reinforcements` retry, which lacks it (must be added upstream first).
5. **`retries.currentRetry` never populated** — declared, dead.
6. **No step logging; stray `console.error`** — `use-case.ts:141` bypasses `@warlock.js/logger`.
7. **Global observers awaited, not isolated** — a slow/throwing global subscriber stalls or breaks every use case (`use-case-events.ts:74`). Blocks safe broadcast.
8. **Global config is a ghost** — `UseCaseConfigurations` type exists and is read, but there's no `src/config/use-cases.ts` stub and it's not in `ConfigRegistry`, so `config.get("use-cases")` is `any` and undiscoverable.
9. **Two benchmark config sources** — `config.get("benchmark")` and `use-cases.benchmarkOptions` merge implicitly inside `measure()`.
10. **Typing gaps** — no schema→Input inference, untyped `ctx`, `benchmarkResult` runtime shape ≠ type, `getUseCase` unsound `as` cast, `schema!` lie.
11. **Doc drift** — `USE-CASES-DESIGN.md` + READMEs describe `retries`/`benchmark`/`latencyRange:{up,down}`/`guard()` that don't exist.

---

## The shape

```ts
import type { Infer, ObjectValidator } from "@warlock.js/seal";
import type { RetryOptions } from "@mongez/reinforcements";
import type { BenchmarkOptions } from "@warlock.js/core";

type UseCase<Output, Input, Ctx extends UseCaseContext = UseCaseContext> = {
  name: string;
  description?: string;                       // NEW — registry/observability/docs
  schema?: ObjectValidator;                   // when present, Input = Infer<schema>
  guards?: UseCaseGuard<Input, Ctx>[];        // Readonly input, enrich ctx, before validation
  before?: UseCaseBeforeMiddleware<Input, Ctx>[]; // transform chain, after validation
  handler: (data: Input, ctx: Ctx) => Promise<Output>;
  after?: UseCaseAfterMiddleware<Output, Ctx>[];  // fire-and-forget on success
  onExecuting?: (ctx: UseCaseOnExecutingContext) => void;
  onCompleted?: (result: UseCaseResult<Output>) => void;
  onError?: (ctx: UseCaseErrorResult) => void;
  retry?: RetryOptions;                       // @mongez/reinforcements shape
  benchmark?: boolean | BenchmarkOptions;     // forwarded straight to measure()
  broadcast?: boolean | {                     // WHAT to broadcast — no transport knobs
    event?: string;                           // default = name
    output?: (output: Output, result: UseCaseResult<Output>) => unknown;
  };
};
```

### Typing

- **Input inference.** When a `schema` is supplied, `Input = Infer<typeof schema>` so the handler is typed from the schema with no manual `<Input>`. Schema-less use cases still accept an explicit generic. *(Open sub-point: exact generic signature / overloads is an impl detail to settle in the PR.)*
- **Typed ctx.** `Ctx` generic threads through guards/before/after/handler so `ctx.currentUser` etc. are typed, not `any`. Default `UseCaseContext` keeps the loose bag for callers who don't care.
- Fix `benchmarkResult` to match the runtime object (or narrow the runtime to the type), drop the `schema!` lie, type the registry without `as`.

---

## Retry — via `@mongez/reinforcements`

- The local `src/retry` is **deleted**; import `retry` + `RetryOptions` from `@mongez/reinforcements`. Gains `backoff: "linear" | "exponential"` for free.
- **Scoped to the handler only** — guards/validation/before run once; only `handler` is retried.
- **Opt-in gating** — reinforcements defaults `attempts: 3`, so only wrap when `retry` is configured: `retry ? reinforcementsRetry(handler, opts) : handler()`. A use case with no `retry` runs once.
- **`currentRetry`** is tracked by the use case via the util's `onError(error, attempt)` callback (the util doesn't return the count).
- **Hard upstream dependency:** `shouldRetry` must land in `@mongez/reinforcements` retry first — without it, use cases can't skip retrying validation/4xx. See the retry-enhancements plan.

---

## Benchmark — single source, handler-scoped

- Option key is `benchmark?: boolean | BenchmarkOptions`, forwarded directly: `measure(name, handler, benchmark === true ? undefined : benchmark)`.
- `measure` wraps the **handler** (the thing whose performance we care about), not the guard/validation/before prelude, and not the retry sleeps.
- One config home: `use-cases.benchmark`. `config.get("benchmark")` (`benchmark.ts`) is reserved for standalone `measure()` calls; the implicit merge inside `measure()` is documented, not relied on by use cases.

---

## Global config — first-class

Ship `src/config/use-cases.ts` via the generator, export `UseCaseConfigurations`, register the key in `ConfigRegistry` (same treatment as `repository`/`benchmark`).

```ts
type UseCaseConfigurations = {
  retry?: RetryOptions;
  benchmark?: boolean | BenchmarkOptions;
  broadcast?: {
    enabled?: boolean;                  // global kill-switch
    channels?: UseCaseBroadcastChannel[];
  };
  history?: { enabled?: boolean; ttl?: number | false };
  log?: boolean;                        // per-step debug logging
};
```

**Resolution per option:** per-use-case ?? global `use-cases.ts` ?? framework default.

---

## Broadcast — transport-neutral channel abstraction

Mirrors the existing `BenchmarkChannel` idiom (interface + adapters). Core owns the contract; herald is one adapter. **Channels are configured globally only** — a use case picks its *event name*, never its transport.

```ts
// CORE — transport-neutral
export type UseCaseBroadcastEvent = {
  useCase: string;     // use-case name
  event: string;       // channel/event name; default = name
  id: string;          // execution id (correlation / idempotency)
  at: Date;
  payload: unknown;    // output, or projected via broadcast.output
};

export interface UseCaseBroadcastChannel {
  broadcast(event: UseCaseBroadcastEvent): void | Promise<void>;
}
```

```ts
// HERALD — ships the adapter; structurally typed → no core import
export function heraldBroadcast(opts?: { broker?: string }) {
  return {
    broadcast: (e: UseCaseBroadcastEvent) =>
      herald(opts?.broker).channel(e.event).publish(e.payload),
  };
}
```

```ts
// APP CONFIG — src/config/use-cases.ts
broadcast: {
  enabled: true,
  channels: [heraldBroadcast({ broker: "default" })],
}
```

Runtime:

- Fires on **success only** (v1).
- Builds the `UseCaseBroadcastEvent` (envelope, not bare payload — consumers get `id` for tracing/idempotency under at-least-once delivery), applies `broadcast.output` projection if present.
- Fans out to every configured channel under `Promise.allSettled` + per-channel try/catch — one dead sink never breaks the use case or its siblings.
- No-ops if `broadcast.enabled === false`, no channels are registered, or the transport is disconnected.
- Core never imports herald (the adapter is structurally typed and registered from app config).

**Payload safety:** `broadcast: true` publishes the output as-is — fine for plain DTOs, dangerous for model instances (a model's `toJSON` may leak secrets). Anything sensitive uses `broadcast: { output }`. We do **not** auto-strip — the projector is the explicit escape hatch (consistent with "resources are output-only" rule).

---

## Logging + observer hardening

- **Built-in logging observer** wired via `globalUseCasesEvents`, gated by `use-cases.log`, debug level, through `@warlock.js/logger` (`log(module, action, message, ctx)`). Replace the stray `console.error` in after-middleware with `log`.
- **Isolate global-observer dispatch** — wrap each observer in try/catch in `fireLifecycleEvent` so a slow/throwing subscriber (e.g. a broadcast sink, a metrics hook) can't break or stall the pipeline. Prerequisite for safe broadcast.

---

## Out of scope (v1)

- Per-use-case channel/broker override (global-only by decision — no concrete need).
- Error-event broadcasting (success-only v1; error fan-out wants a different channel/shape).
- Retry scope `"pipeline"` opt-in (handler-only default; add later if a flaky-guard case appears).
- Distributed history cap policy beyond a simple list trim.
