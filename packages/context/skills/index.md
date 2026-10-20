---
description: 'Typed async context propagation with `Context` and `ContextManager`, built on AsyncLocalStorage. Use for "avoid passing the tenant everywhere", request-scoped users, trace IDs, `run`, `enter`, `get`, `set` or coordinating several contexts. Not this package → @warlock.js/core for the framework request context; @warlock.js/cache for state shared across requests; @warlock.js/cascade for database transactions.'
---

# @warlock.js/context

A thin typed wrapper over `AsyncLocalStorage`. Each `Context<TStore>` subclass declares its store shape and how `buildStore` creates it; the store lives for the scope and propagates through every `await` inside. `contextManager` runs several contexts together. Zero dependencies; the framework uses it internally for request, user and tenant.

## The 80% path

1. Use this index for orientation and choose a task below.
2. Subclass `Context`, implement `buildStore`, read with `get` / `set` anywhere down the call tree: `define-context.md`.
3. Wrap work with `run(store, callback)`, or `enter(store)` for middleware that cannot wrap a callback: `define-context.md`.
4. With two or more active contexts, register them on `contextManager` and use `runAll` / `enterAll`: `orchestrate-contexts.md`.

## Conventions and pitfalls

- Outside a `run`/`enter` scope there is no store; guard with `hasContext` when code may run unscoped.
- `enter` leaks until cleared; pair `enterAll` with `clearAll` at the end of the request.
- Worker threads do not share the store; serialize data across and re-enter.
- Context is not shared state: it vanishes with the scope.
- One context in a cooperative framework needs no manager; use plain `run`.

## When to reach for it

- You have request-scoped data (user, tenant, trace id, db transaction) that you'd otherwise thread through every function as a parameter. One `userContext.get("userId")` anywhere down the call tree replaces five layers of plumbing.
- You're inside a `@warlock.js/*` project and want consistent context handling across modules. The framework already uses this package internally for request + user + tenant contexts.
- You'd reach for **cls-hooked**, **nest-context**, or a bare `AsyncLocalStorage<T>` and want a typed wrapper with `run` / `enter` / `update` / `get` / `set` semantics out of the box.

Skip if your call chain is a single function with no `await` boundaries — just pass the data as a parameter. Skip if you need cross-request shared state — that's a cache or database, not a context.

## What it is in one sentence

Each `Context<TStore>` subclass declares a typed store shape and what payload builds it; the framework uses Node's `AsyncLocalStorage` under the hood so the store propagates through every `await` inside the scope and disappears when the scope ends.

## Two operating modes — when to pick which

| Situation                                                               | Reach for                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Framework gives you a callback to wrap                                  | `context.run(store, callback)`                             |
| Framework expects middleware that returns synchronously (Express, etc.) | `context.enter(store)`                                     |
| You have 2+ contexts active for the same request                        | `contextManager.runAll(stores, callback)`                  |
| Middleware-style with 2+ contexts                                       | `contextManager.enterAll(stores)` then `clearAll()` at end |
| You only have one context and the framework cooperates                  | Single `context.run(...)`. Skip the manager.               |

## What this package deliberately doesn't do

- **Persist data across requests.** AsyncLocalStorage dies with the scope. For cross-request state, reach for `@warlock.js/cache` or a database.
- **Cross-thread context.** Worker threads don't share AsyncLocalStorage with the main thread. Serialize the data you need across the boundary and re-enter on the other side.
- **Browser context.** Server-side only. The browser equivalent is React Context or a state library.
- **Implicit context for non-async code.** If your call stack has no `await`, the storage works but there's no propagation benefit — just pass the value as a parameter.

## See also

- The `warlock-js-core` skill index — the parent framework; `context` is one of its foundation packages.
