---
name: define-context
description: 'Extend Context<TStore> to define an AsyncLocalStorage-backed typed context — implement buildStore, use run / enter / update / get / set / getStore / clear / hasContext. Triggers: `Context`, `Context<TStore>`, `buildStore`, `run`, `enter`, `update`, `get`, `set`, `getStore`, `clear`, `hasContext`; "share user/tenant/trace id across async calls", "AsyncLocalStorage typed wrapper", "request-scoped store without thread-through"; typical import `import { Context } from "@warlock.js/context"`. Skip: orchestrating multiple contexts — `@warlock.js/context/orchestrate-contexts/SKILL.md`; native `AsyncLocalStorage`, `cls-hooked`, `nest-context`, React Context.'
---

# Define a context

`@warlock.js/context` is a tiny wrapper on Node.js's `AsyncLocalStorage`. You extend the abstract `Context<TStore>` class to declare what your context stores, and you get a typed get/set/run API that propagates through every async call inside the scope.

## Install

```bash
yarn add @warlock.js/context
```

## Shape

```ts
import { Context } from "@warlock.js/context";

interface UserContextStore {
  userId: string;
  role: "admin" | "user";
  tenantId: string;
}

class UserContext extends Context<UserContextStore> {
  /**
   * Called by `contextManager.buildStores(payload)` for each registered context.
   * Override to provide initialization logic for this context's store.
   */
  public buildStore(payload?: Record<string, any>): UserContextStore {
    return {
      userId: payload?.userId ?? "",
      role: payload?.role ?? "user",
      tenantId: payload?.tenantId ?? "",
    };
  }
}

export const userContext = new UserContext();
```

`buildStore` is the **only** abstract method. Everything else is provided by `Context<TStore>`.

## Usage modes

### `run()` — scoped execution

```ts
await userContext.run(
  { userId: "123", role: "admin", tenantId: "acme" },
  async () => {
    // Context is available throughout this async scope and any awaited calls inside it.
    const userId = userContext.get("userId");   // "123"
    const role = userContext.get("role");       // "admin"

    await someAsyncOperation();                  // context propagates through awaits
  },
);
```

Use `run()` when you have a clear scope boundary (a request handler, a job, a CLI command). The context is auto-cleaned when the callback returns.

### `enter()` — middleware-style, no callback

```ts
function authMiddleware(req, res, next) {
  userContext.enter({
    userId: req.user.id,
    role: req.user.role,
    tenantId: req.headers["x-tenant-id"],
  });

  next();   // context lives for the rest of the request
}
```

Use `enter()` when the framework doesn't give you a callback to wrap (Express-style middleware). Under the hood it's `AsyncLocalStorage.enterWith(store)`.

### `update()` — merge into the current context

```ts
userContext.update({ role: "admin" });
// existing store: { userId, role, tenantId } → { userId, role: "admin", tenantId }
```

If there's no current store, `update` creates one with the partial (cast to the full type). Use for incremental enrichment as the request flows through layers.

## Reading

```ts
const userId = userContext.get("userId");         // TStore[K] | undefined
const store = userContext.getStore();              // TStore | undefined
const inside = userContext.hasContext();           // boolean
```

`get` is the daily-use accessor. `getStore` returns the whole record. `hasContext` distinguishes "key absent" from "no context at all" (which matters for safety checks at the framework boundary).

## Writing within a context

```ts
userContext.set("role", "admin");                  // sugar for update({ role: "admin" })
```

Only call `set` inside an active context. Outside one, it enters a new context with just that key set — usually not what you want.

## Clearing

```ts
userContext.clear();
// replaces the current store with an empty object of TStore
```

Rare in app code. The auto-cleanup at the end of `run()` is the normal path.

## Convenience getters via subclass

Add domain-friendly getters on the subclass when a key is read a lot:

```ts
class TenantContext extends Context<TenantStore> {
  public buildStore(payload?: Record<string, any>): TenantStore {
    return {
      tenantId: payload?.tenantId ?? "",
      tenantName: payload?.tenantName ?? "",
      config: payload?.config ?? {},
    };
  }

  public get tenantId() {
    return this.get("tenantId");
  }

  public get config() {
    return this.get("config");
  }
}
```

Now `tenantContext.tenantId` reads better than `tenantContext.get("tenantId")` at the call site.

## What it's NOT for

- **Persistent state across requests.** AsyncLocalStorage is per-call-tree; data dies when the scope ends. Use a cache, a database, or a singleton for cross-request data.
- **Thread-safe shared mutable state.** Each `run()` gets a fresh store. Two parallel `run()` calls don't see each other's updates.
- **Sync code that doesn't `await` anything.** Works, but if there's no async boundary the context add-overhead is wasted — just pass the data as a parameter.

## See also

- [`@warlock.js/context/orchestrate-contexts/SKILL.md`](@warlock.js/context/orchestrate-contexts/SKILL.md) — running multiple contexts together via the `contextManager` singleton.

## Things NOT to do

- Don't make every cross-cutting concern a context. Build one when it has its own lifecycle (request, db transaction, trace span). For one-off data, a function argument is clearer.
- Don't capture the store reference outside the scope — it's freed when `run()` ends. Read the value out before exiting the scope if you need it later.
- Don't mutate the store object directly without `update`/`set` — works, but obscures intent. The methods exist to make state changes searchable.
- Don't share one context instance across unrelated concerns. One typed context per domain concept reads better than one fat `globalContext`.
