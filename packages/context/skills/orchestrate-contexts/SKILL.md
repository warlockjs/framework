---
name: orchestrate-contexts
description: 'Orchestrate multiple Context<TStore> instances via the contextManager singleton — register, buildStores, runAll, enterAll, clearAll. Triggers: `contextManager`, `register`, `buildStores`, `runAll`, `enterAll`, `clearAll`, `unregister`, `getContext`, `hasContext`; "run multiple contexts active for the same scope", "register contexts at boot", "avoid nested run() calls for request + database + tenant"; typical import `import { contextManager } from "@warlock.js/context"`. Skip: defining a single context class — the `define-context` topic; native `AsyncLocalStorage` nesting, `cls-hooked` namespaces.'
---

# Orchestrate contexts — `contextManager`

`contextManager` is a singleton that knows about every registered `Context` and runs them all together so you don't write nested `run()` calls by hand.

## Why use it

You can call `context.run(store, fn)` directly when you only have one context. With two or more, the manager handles the nesting:

```ts
// ❌ Without the manager — fragile, easy to forget a layer
await requestContext.run(reqStore, async () =>
  databaseContext.run(dbStore, async () => tenantContext.run(tenantStore, async () => handle())),
);

// ✅ With the manager — one call, deterministic order
await contextManager.runAll({ request: reqStore, database: dbStore, tenant: tenantStore }, handle);
```

## Register contexts at boot

```ts
import { contextManager } from "@warlock.js/context";
import { requestContext } from "./request-context";
import { databaseContext } from "./database-context";
import { tenantContext } from "./tenant-context";

contextManager
  .register("request", requestContext)
  .register("database", databaseContext)
  .register("tenant", tenantContext);
```

Returns the manager — chain registrations. Names must be unique; re-registering with the same name overwrites.

## Build stores + run

The typical flow is two-step: build initial stores from a request-like payload, then run.

```ts
app.use(async (req, res, next) => {
  const stores = contextManager.buildStores({
    request: req,
    response: res,
    tenantId: req.headers["x-tenant-id"],
  });

  await contextManager.runAll(stores, async () => {
    await next();
  });
});
```

`buildStores(payload)` calls each registered context's `buildStore(payload)` (the abstract method on `Context<TStore>` — see the `define-context` topic) and returns `{ [contextName]: store }`.

`runAll(stores, fn)` nests every context's `run()` in registration order, then invokes `fn` at the innermost layer. All contexts are active inside `fn`.

## `enterAll()` — middleware without a callback

When the framework doesn't give you a callback to wrap (e.g. Express middleware where you call `next()` and return):

```ts
function contextMiddleware(req, res, next) {
  const stores = contextManager.buildStores({ request: req, response: res });
  contextManager.enterAll(stores);
  next();
}
```

`enterAll` calls `enter()` on each registered context whose name has a **truthy** store value — a `name` with no key (or a falsy value like `undefined`) is skipped, leaving any already-active store for that context untouched. The entered contexts live for the rest of the request. Each can still be `clear()`-ed later. Use `runAll` when you can — `enterAll` doesn't auto-clean.

## Lookup + introspection

```ts
contextManager.hasContext("tenant"); // boolean
const tenant = contextManager.getContext<TenantContext>("tenant");
// returns the registered instance or undefined
contextManager.unregister("debug"); // remove a context
contextManager.clearAll(); // clear stores on every context
```

`getContext<T>` returns the registered instance cast to `T` (the generic is constrained to `Context<any>`, so pass the concrete context class — `getContext<TenantContext>("tenant")`). It's an unchecked cast: an unknown `name` returns `undefined`, and a wrong type argument won't be caught at runtime. Useful in shared utilities that want to read from a context without importing it at the call site.

## Order matters

`runAll` nests in **registration order**. The first-registered context is the outermost layer. If contexts have ordering constraints (database before tenant because tenant resolves via the db), register them in that order.

```ts
contextManager
  .register("trace", traceContext) // outermost — runs first
  .register("request", requestContext)
  .register("database", databaseContext)
  .register("tenant", tenantContext); // innermost — runs last, inside all others
```

## Real-world: multi-tenant request lifecycle

```ts
import { Context, contextManager } from "@warlock.js/context";
import { randomUUID } from "crypto";

class TraceContext extends Context<{ traceId: string; startTime: number }> {
  public buildStore(): { traceId: string; startTime: number } {
    return { traceId: randomUUID(), startTime: Date.now() };
  }

  public get traceId() {
    return this.get("traceId");
  }
}

class RequestContext extends Context<{ request: any; response: any }> {
  public buildStore(payload?: any) {
    return { request: payload?.request, response: payload?.response };
  }
}

class TenantContext extends Context<{ tenantId: string }> {
  public buildStore(payload?: any) {
    return { tenantId: payload?.tenantId ?? "" };
  }
}

export const traceContext = new TraceContext();
export const requestContext = new RequestContext();
export const tenantContext = new TenantContext();

contextManager
  .register("trace", traceContext)
  .register("request", requestContext)
  .register("tenant", tenantContext);

// In your HTTP layer:
async function handleRequest(req: any, res: any) {
  const stores = contextManager.buildStores({
    request: req,
    response: res,
    tenantId: req.headers["x-tenant-id"],
  });

  return contextManager.runAll(stores, async () => {
    // All three contexts active here:
    console.log(`Trace ${traceContext.get("traceId")} — tenant ${tenantContext.get("tenantId")}`);

    await routeAndDispatch(req, res);
  });
}
```

## Things NOT to do

- Don't register the same context under two names — every context is its own singleton and shares its store across registrations, but multiple names confuse `buildStores` (the payload is split per name).
- Don't `runAll` an empty stores map — every key without a registered context is silently ignored, and missing contexts get `{}` as their store. Better to construct the stores explicitly and fail loudly when a key is missing.
- Don't use the manager when only one context applies. `context.run(store, fn)` is shorter and has the same semantics.
- Don't expect `enterAll()` to auto-clean. It's a one-way setup — pair with `clearAll()` at the end of the request, or just use `runAll` when you can.
