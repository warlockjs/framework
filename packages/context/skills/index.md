---
description: 'Typed request-scoped context on Node AsyncLocalStorage, so data (user, tenant, trace id, transaction) flows through awaits without parameter threading. Exports `Context`, `contextManager`, `ContextManager`. Use for: "share the current user or tenant across async calls", "request-scoped storage", "AsyncLocalStorage wrapper", "run several contexts together", "avoid passing data through every function". Not this package: cross-request state → @warlock.js/cache or a database; HTTP request/response objects → @warlock.js/core.'
---

# @warlock.js/context

A thin typed wrapper over `AsyncLocalStorage`. Each `Context<TStore>` subclass declares its store shape and how `buildStore` creates it; the store lives for the scope and propagates through every `await` inside. `contextManager` runs several contexts together. Zero dependencies; the framework uses it internally for request, user and tenant.

## The 80% path

1. Orient with `overview.md`.
2. Subclass `Context`, implement `buildStore`, read with `get` / `set` anywhere down the call tree: `define-context.md`.
3. Wrap work with `run(store, callback)`, or `enter(store)` for middleware that cannot wrap a callback: `define-context.md`.
4. With two or more active contexts, register them on `contextManager` and use `runAll` / `enterAll`: `orchestrate-contexts.md`.

## Conventions and pitfalls

- Outside a `run`/`enter` scope there is no store; guard with `hasContext` when code may run unscoped.
- `enter` leaks until cleared; pair `enterAll` with `clearAll` at the end of the request.
- Worker threads do not share the store; serialize data across and re-enter.
- Context is not shared state: it vanishes with the scope.
- One context in a cooperative framework needs no manager; use plain `run`.
