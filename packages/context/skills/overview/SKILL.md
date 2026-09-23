---
name: overview
description: "@warlock.js/context overview for orientation and choosing the focused skill for the task."
---

# `@warlock.js/context` — overview

Two-file package: a typed wrapper over Node's `AsyncLocalStorage` and a singleton that runs several of them together. That's it. The entire surface fits in two skills below — most callers only need the first one.

## When to reach for it

- You have request-scoped data (user, tenant, trace id, db transaction) that you'd otherwise thread through every function as a parameter. One `userContext.get("userId")` anywhere down the call tree replaces five layers of plumbing.
- You're inside a `@warlock.js/*` project and want consistent context handling across modules. The framework already uses this package internally for request + user + tenant contexts.
- You'd reach for `cls-hooked`, `nest-context`, or a bare `AsyncLocalStorage<T>` and want a typed wrapper with `run` / `enter` / `update` / `get` / `set` semantics out of the box.

Skip if your call chain is a single function with no `await` boundaries — just pass the data as a parameter. Skip if you need cross-request shared state — that's a cache or database, not a context.

## What it is in one sentence

Each `Context<TStore>` subclass declares a typed store shape and what payload builds it; the framework uses Node's `AsyncLocalStorage` under the hood so the store propagates through every `await` inside the scope and disappears when the scope ends.

## Skills index

Two task skills cover everything. The first one is the daily-use one; the second is for when you have multiple contexts active at the same time.

### [`define-context/`](../define-context/SKILL.md)

Extend `Context<TStore>` to declare what your context stores and how it's
built. Implement `buildStore(payload?)`; use `run` / `enter` / `update` /
`get` / `set` / `getStore` / `clear` / `hasContext` to interact with the
store from anywhere in the async scope.

Load when sharing data (user, tenant, trace id) across async calls
without threading it through every function — i.e. ~90% of the time you
use this package.

### [`orchestrate-contexts/`](../orchestrate-contexts/SKILL.md)

Register multiple `Context<TStore>` instances on the `contextManager`
singleton and run them all together with a single call. Covers
`register` / `unregister`, `buildStores`, `runAll` / `enterAll`,
`clearAll`, `getContext` / `hasContext`.

Load when several contexts apply to the same scope (request + database
+ trace + tenant) and you'd otherwise nest `run()` calls by hand.

## Two operating modes — when to pick which

| Situation | Reach for |
| --- | --- |
| Framework gives you a callback to wrap | `context.run(store, callback)` |
| Framework expects middleware that returns synchronously (Express, etc.) | `context.enter(store)` |
| You have 2+ contexts active for the same request | `contextManager.runAll(stores, callback)` |
| Middleware-style with 2+ contexts | `contextManager.enterAll(stores)` then `clearAll()` at end |
| You only have one context and the framework cooperates | Single `context.run(...)`. Skip the manager. |

## What this package deliberately doesn't do

- **Persist data across requests.** AsyncLocalStorage dies with the scope. For cross-request state, reach for `@warlock.js/cache` or a database.
- **Cross-thread context.** Worker threads don't share AsyncLocalStorage with the main thread. Serialize the data you need across the boundary and re-enter on the other side.
- **Browser context.** Server-side only. The browser equivalent is React Context or a state library.
- **Implicit context for non-async code.** If your call stack has no `await`, the storage works but there's no propagation benefit — just pass the value as a parameter.

## See also

- [`@warlock.js/core/overview/SKILL.md`](@warlock.js/core/overview/SKILL.md) — the parent framework; `context` is one of its foundation packages.
- `mongez-agent-kit-authoring-skills` (load via agent-kit sync) — how this `overview/SKILL.md` becomes the front-door skill in `.claude/skills/warlock-js-context-overview/`.
