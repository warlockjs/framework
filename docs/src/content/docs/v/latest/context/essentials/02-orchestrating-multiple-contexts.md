---
title: "Orchestrating multiple contexts"
description: How contextManager nests several Context instances into one scope so user, tenant, and trace can be active together.
sidebar:
  order: 2
  label: "Orchestrating multiple contexts"
---

One context is the easy case. Real requests usually want several at once — a trace id, the current user, the active tenant, the database transaction in flight. You could stack `run()` calls by hand. Don't. That is what `contextManager` is for.

## The pyramid you are avoiding

Without the manager, three contexts means three nested callbacks:

```ts
await traceContext.run(traceStore, async () =>
  userContext.run(userStore, async () =>
    tenantContext.run(tenantStore, async () => {
      await handleRequest();
    })
  )
);
```

This works. It is also fragile — add a fourth context next quarter and every middleware needs editing, in the right order, with the right error handling at each level. The manager flattens it:

```ts
await contextManager.runAll(
  { trace: traceStore, user: userStore, tenant: tenantStore },
  async () => {
    await handleRequest();
  },
);
```

One call. Add a fourth context next quarter — register it once at boot, every existing call site picks it up.

## What `contextManager` actually is

A singleton (`contextManager`, exported from `@warlock.js/context`) that holds a `Map<string, Context<any>>`. Five methods do the work:

- **`register(name, context)`** — add a context to the map. Returns the manager for chaining.
- **`buildStores(payload)`** — call every registered context's `buildStore(payload)`, return a `{ name: store }` record.
- **`runAll(stores, callback)`** — nest every context's `run()` in registration order, invoke `callback` at the innermost layer.
- **`enterAll(stores)`** — call every context's `enter(store)`. No callback, no auto-cleanup.
- **`clearAll()`** — call every context's `clear()`. Use after `enterAll` if you need a clean slate.

Two more for introspection: `getContext<T>(name)` and `hasContext(name)`. One destructive: `unregister(name)`.

## The two-step flow

`buildStores` and `runAll` are designed to compose. The typical pattern at a request boundary is two lines:

```ts
const stores = contextManager.buildStores({ request, response });

await contextManager.runAll(stores, async () => {
  await routeAndDispatch(request, response);
});
```

`buildStores({ request, response })` walks every registered context and calls `buildStore({ request, response })` on each — that is why the abstract method exists. Each context inspects the payload, pulls what it cares about, returns its initial store. The manager collects the results into `{ trace: {...}, user: {...}, tenant: {...} }` and hands them to `runAll`.

This keeps the boundary code generic. Add a `metrics` context, implement its `buildStore`, register it — the boundary code does not change.

## Order matters

`runAll` nests in **registration order**. First registered = outermost layer. The innermost context can see the outermost's store, but not the other way round (the outermost runs first; the inner contexts have not started yet at that moment).

```ts
contextManager
  .register("trace", traceContext)        // outermost
  .register("request", requestContext)
  .register("database", databaseContext)
  .register("tenant", tenantContext);     // innermost
```

This matters if one context's `buildStore` needs to read another. If `tenantContext.buildStore` calls the database, register `database` before `tenant`. The rule: dependencies go first.

The trade-off: registration order is global state. Two different code paths cannot want two different nesting orders. If you find yourself needing that, you probably want two separate manager instances — instantiate `new ContextManager()` directly instead of using the singleton.

## `enterAll` — the no-callback escape hatch

Express middleware looks like this:

```ts
function contextMiddleware(req, res, next) {
  const stores = contextManager.buildStores({ request: req, response: res });
  contextManager.enterAll(stores);
  next();
}
```

No callback to wrap the rest of the request, so `runAll` does not fit. `enterAll` calls `enter()` on every context — each one sets its store via `AsyncLocalStorage.enterWith(store)` — and the contexts live until the surrounding async scope ends.

The catch: there is no automatic cleanup. The stores hang around until the request finishes naturally. That is usually fine — the request scope is the lifetime you want — but if you `enterAll` outside a request scope, you have to `clearAll()` yourself.

The Node docs prefer `run()` over `enterWith()` for exactly this reason. Use `enterAll` only when the framework integration leaves you no choice (Koa, Fastify, modern Express with async middleware: use `runAll`).

## One instance, one store per registration name

Every context is its own singleton — `userContext` is a single object across your whole process. Registering it twice under different names does not give it two stores; both names point to the same `AsyncLocalStorage`. `buildStores({ ... })` will call `buildStore` twice for it, but only the last `run` wins because it overwrites the slot.

The rule: one name per context instance. The map keys are for `getContext` lookup and for matching payload keys to contexts — they are not a way to fork a context's storage.

## When you do not need the manager

If your app only ever needs one context, skip the manager. `myContext.run(store, fn)` is shorter, faster to reason about, and has identical semantics for the single-context case. The manager pays off the moment you have two — the threshold is exactly there.

## Related

- [Orchestrate contexts](../guides/orchestrate-contexts) — task-oriented patterns.
- [Use in workers and jobs](../guides/use-in-workers-and-jobs) — surviving process boundaries.
- [API reference](../reference/api) — `ContextManager` signatures.
