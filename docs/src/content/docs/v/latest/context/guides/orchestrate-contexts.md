---
title: "Orchestrate contexts"
description: Register, build, and run multiple contexts together via the contextManager singleton without hand-nesting run() calls.
sidebar:
  order: 2
  label: "Orchestrate contexts"
---

When one request needs several contexts active at once — trace, user, tenant, database transaction — the `contextManager` singleton handles the nesting so your boundary code stays one call deep.

## The shape of the workflow

Four steps, the same shape in every app:

1. **Define** each context (one file per context, extending `Context<TStore>`).
2. **Register** them with `contextManager` at boot, once.
3. **Build stores** at the boundary with `contextManager.buildStores(payload)`.
4. **Run** the handler with `contextManager.runAll(stores, callback)`.

The first two are one-time setup. The second two run on every request.

## Step 1 — Define the contexts

```ts title="src/contexts/trace-context.ts"
import { Context } from "@warlock.js/context";
import { randomUUID } from "crypto";

type TraceContextStore = {
  traceId: string;
  startedAt: number;
};

class TraceContext extends Context<TraceContextStore> {
  public buildStore(): TraceContextStore {
    return { traceId: randomUUID(), startedAt: Date.now() };
  }

  public get traceId() {
    return this.get("traceId");
  }
}

export const traceContext = new TraceContext();
```

```ts title="src/contexts/user-context.ts"
import { Context } from "@warlock.js/context";

type UserContextStore = {
  userId: string;
  role: "admin" | "user" | "guest";
};

class UserContext extends Context<UserContextStore> {
  public buildStore(payload?: Record<string, any>): UserContextStore {
    return {
      userId: payload?.user?.id ?? "",
      role: payload?.user?.role ?? "guest",
    };
  }

  public get userId() {
    return this.get("userId");
  }
}

export const userContext = new UserContext();
```

```ts title="src/contexts/tenant-context.ts"
import { Context } from "@warlock.js/context";

type TenantContextStore = {
  tenantId: string;
};

class TenantContext extends Context<TenantContextStore> {
  public buildStore(payload?: Record<string, any>): TenantContextStore {
    return { tenantId: payload?.tenantId ?? "" };
  }
}

export const tenantContext = new TenantContext();
```

## Step 2 — Register at boot

One file that runs before request handling:

```ts title="src/contexts/index.ts"
import { contextManager } from "@warlock.js/context";
import { traceContext } from "./trace-context";
import { userContext } from "./user-context";
import { tenantContext } from "./tenant-context";

contextManager
  .register("trace", traceContext)
  .register("user", userContext)
  .register("tenant", tenantContext);

export { traceContext, userContext, tenantContext };
```

`register(name, context)` returns the manager — chain freely. Registration order is the nesting order: `trace` is outermost, `tenant` is innermost. Order the list so contexts that depend on earlier ones come later.

## Step 3 — Build stores at the boundary

```ts title="src/server.ts"
import { contextManager } from "@warlock.js/context";
import "./contexts"; // register on import

async function handleRequest(req: any, res: any) {
  const stores = contextManager.buildStores({
    user: req.user,
    tenantId: req.headers["x-tenant-id"],
  });

  await contextManager.runAll(stores, async () => {
    await routeAndDispatch(req, res);
  });
}
```

`buildStores(payload)` walks every registered context and calls its `buildStore(payload)`. The payload is generic — pass whatever each context's `buildStore` knows how to read. In this example, `trace` ignores the payload (it generates its own id), `user` reads `payload.user`, `tenant` reads `payload.tenantId`. Adding a new context later means implementing its `buildStore` and registering — the boundary code does not change.

The return value is `{ trace: {...}, user: {...}, tenant: {...} }` — keyed by registration name, ready for `runAll`.

## Step 4 — `runAll`

```ts
await contextManager.runAll(stores, async () => {
  // Inside this scope, all three contexts are active.
  console.log(traceContext.traceId, userContext.userId);

  await someService.doWork();
});
```

`runAll` nests `traceContext.run` → `userContext.run` → `tenantContext.run` → callback, in registration order. All three contexts are active by the time your callback runs, and all three are released when it resolves or throws.

## Express-style middleware — `enterAll`

When the framework hands you `(req, res, next)` instead of an async callback, swap `runAll` for `enterAll`:

```ts
import { contextManager } from "@warlock.js/context";

function contextMiddleware(req: any, res: any, next: any) {
  const stores = contextManager.buildStores({
    user: req.user,
    tenantId: req.headers["x-tenant-id"],
  });

  contextManager.enterAll(stores);

  next();
}
```

`enterAll` calls each context's `enter()` so they live for the rest of the request lifetime. No auto-cleanup — the stores are released when the surrounding async scope ends.

One subtle difference from `runAll`: `enterAll` only enters contexts whose names appear as truthy values in `stores`. If `buildStores` returns `tenant: {}` (an empty object — which is truthy in JS), the tenant context is entered with an empty store. If you skip a key entirely or pass `null`/`undefined`, that context is not entered. Predictable, but worth knowing.

## Reading from contexts elsewhere

Anywhere downstream — services, repositories, helpers — import the contexts you need:

```ts title="src/services/audit.service.ts"
import { traceContext, userContext, tenantContext } from "../contexts";

export async function logAuditEvent(event: string) {
  await persistAudit({
    traceId: traceContext.get("traceId"),
    userId: userContext.get("userId"),
    tenantId: tenantContext.get("tenantId"),
    event,
  });
}
```

No prop-drilling. Each context is a typed singleton; `get` returns the typed value off the active store.

If you want to read a registered context generically (without importing the concrete class), use the manager:

```ts
const tenant = contextManager.getContext<TenantContext>("tenant");
const tenantId = tenant?.get("tenantId");
```

Useful in shared utilities that should not depend on concrete context classes. Pass the class as the generic so `.get` keeps its typing.

## Introspection helpers

```ts
contextManager.hasContext("tenant");        // is "tenant" registered?
contextManager.getContext("trace");         // get the instance (or undefined)
contextManager.unregister("debug");         // remove a registration
contextManager.clearAll();                  // call clear() on every registered context
```

`hasContext` on the manager checks **registration**, not whether you are inside an active scope. The `Context` instance has its own `hasContext()` for that.

## Order matters, registered once

Two rules to internalize:

- **Order is registration order.** `runAll` nests in the order contexts were registered. If `tenant.buildStore` needs to call the database, register `database` before `tenant`.
- **One name per context instance.** A context is its own singleton — registering it twice under two names does not give it two stores. Both names point to the same `AsyncLocalStorage`.

If you genuinely need two parallel nesting orders in different code paths, instantiate a second manager directly: `const otherManager = new ContextManager()`. The `contextManager` export is a convenience singleton, not the only one allowed.

## When not to use the manager

If your app only ever uses one context, skip the manager entirely. `myContext.run(store, fn)` is shorter and has the same semantics. The manager pays off the moment you have two contexts active in the same scope — that is the threshold.

## Things to avoid

- **Don't `runAll` an empty stores map.** Every registered context receives `{}` as its store. Better to construct the stores explicitly and let TypeScript catch missing keys.
- **Don't register the same context under two names.** It works, but `buildStores` will call its `buildStore` twice and only the last `runAll` layer wins. Confusion, not benefit.
- **Don't expect `enterAll()` to auto-clean.** It is a one-way setup. Pair with `clearAll()` if the surrounding scope is not request-bounded.

## Related

- [Define a context](./define-a-context) — building the contexts you'll register.
- [Use in workers and jobs](./use-in-workers-and-jobs) — boundaries outside the HTTP request.
- [API reference](../reference/api) — `ContextManager` method signatures.
