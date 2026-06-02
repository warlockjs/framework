# Use Cases

Transport-agnostic use case pattern. A use case encapsulates a single business operation with a structured pipeline: guards → schema validation → before middleware → handler → after middleware → lifecycle events → broadcast. Retry and benchmark wrap the **handler only**. Input is inferred from the schema.

## Key Files

| File                    | Purpose                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `use-case.ts`           | `useCase()` factory — builds the executor; resolves retry/benchmark/broadcast config; runs the pipeline |
| `use-case-pipeline.ts`  | `runPipeline()` — the pre-handler pipeline (onExecuting → guards → validation → before)                  |
| `use-case-events.ts`    | `globalUseCasesEvents` + `fireLifecycleEvent` (isolated, fault-tolerant observer dispatch)               |
| `use-case-broadcast.ts` | `broadcastUseCaseResult()` — success-only fan-out to configured `UseCaseBroadcastChannel`s               |
| `use-cases-registry.ts` | In-memory registry + call counters + cache-backed execution history (capped + self-pruning)              |
| `use-case.errors.ts`    | `BadSchemaUseCaseError`                                                                                   |
| `types.ts`              | `UseCase`, `UseCaseGuard`, `UseCaseBeforeMiddleware`, `UseCaseAfterMiddleware`, `UseCaseResult`, `UseCaseBroadcastChannel`, `UseCaseConfigurations`, … |
| `index.ts`              | Barrel export                                                                                            |

## Key Exports

- `useCase(options)` — factory returning an executable use case (with `$cleanup`)
- `globalUseCasesEvents` — global lifecycle observers (`onExecuting`, `onCompleted`, `onError`)
- `getUseCase` / `getUseCases` / `getUseCaseHistory` — registry + history access
- `broadcastUseCaseResult` — broadcast fan-out helper
- Types: `UseCase`, `UseCaseGuard`, `UseCaseBeforeMiddleware`, `UseCaseAfterMiddleware`, `UseCaseResult`, `UseCaseContext`, `UseCaseBroadcastChannel`, `UseCaseBroadcastEvent`, `UseCaseConfigurations`

## Dependencies

### Internal (within `core/src`)

- `../benchmark` — `measure()` for handler performance tracking
- `../config` — global `use-cases` configuration

### External

- `@warlock.js/seal` — `v` (validator) + `Infer` (schema → input inference)
- `@warlock.js/logger` — structured logging (lifecycle, after-middleware, broadcast failures)
- `@mongez/reinforcements` — `retry` (handler retry), `Random`, `except`

## Used By

- Application-level use cases (e.g. `loginUseCase`, `registerUseCase`)
- Any business logic that needs structured execution with observability/broadcast

## Design

See [`domains/core/design/use-cases.md`](../../../../domains/core/design/use-cases.md) for the architecture and locked decisions.
