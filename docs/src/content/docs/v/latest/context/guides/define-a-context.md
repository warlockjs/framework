---
title: "Define a context"
description: Patterns for declaring a typed Context — store shape, buildStore, convenience getters, and reading-writing rules.
sidebar:
  order: 1
  label: "Define a context"
---

Defining a context is three decisions: what does it store, what does its `buildStore` look like, and what convenience accessors does it expose. Get those right, the rest is mechanical.

## The minimum viable context

Two pieces — a store type and a subclass:

```ts
import { Context } from "@warlock.js/context";

type RequestContextStore = {
  requestId: string;
  startedAt: number;
};

class RequestContext extends Context<RequestContextStore> {
  public buildStore(payload?: Record<string, any>): RequestContextStore {
    return {
      requestId: payload?.requestId ?? crypto.randomUUID(),
      startedAt: Date.now(),
    };
  }
}

export const requestContext = new RequestContext();
```

`buildStore` is the only thing you must implement. It is called by `contextManager.buildStores(payload)` at the boundary — payload is whatever you choose to pass (often `{ request, response }`, sometimes a job message, sometimes nothing). Your job: pull what you need, fall back to sensible defaults, return the initial store.

## Choose `type` for the store shape

The store is data — pure record, no methods. The project convention is `type` for data and `interface` for contracts, so:

```ts
// ✅ data shape — use `type`
type TenantContextStore = {
  tenantId: string;
  tenantName: string;
};

// ❌ no methods here — `interface` is wrong
interface TenantContextStore {
  tenantId: string;
  tenantName: string;
}
```

The generic on `Context<TStore>` is constrained to `Record<string, any>` — anything with string keys works. Keep the shape flat where you can; nested objects are fine but mean `update` only merges the top level.

## `buildStore` patterns

### Eager — pull straight from the payload

```ts
public buildStore(payload?: Record<string, any>): UserContextStore {
  return {
    userId: payload?.user?.id ?? "",
    role: payload?.user?.role ?? "guest",
  };
}
```

The boundary has the data already (the HTTP request, the job message). Read it once, hand the store back. Empty strings or `"guest"`-style defaults beat throwing inside `buildStore` — a half-initialized context is usually less painful than a request that 500s before the route handler runs.

### Lazy — start empty, fill in via middleware

```ts
public buildStore(): UserContextStore {
  return { userId: "", role: "guest" };
}

// Then later, after auth:
userContext.update({ userId: authedUser.id, role: authedUser.role });
```

Useful when the data is not available at the boundary — auth runs after the context is set, then enriches it. `update(partial)` merges into the current store in place.

### Branching — let the payload type drive the shape

```ts
public buildStore(payload?: Record<string, any>): JobContextStore {
  if (payload?.source === "queue") {
    return { jobId: payload.message.id, attempt: payload.message.attempt ?? 1 };
  }

  if (payload?.source === "cron") {
    return { jobId: `cron:${payload.taskName}`, attempt: 1 };
  }

  return { jobId: "", attempt: 0 };
}
```

When the same context serves different boundary types (HTTP + queue + cron), branch on a discriminator in the payload. Keep the discriminator out of the store itself — its job is to seed values, not survive into the call tree.

## Convenience getters

`userContext.get("userId")` works. `userContext.userId` reads better. Add a getter on the subclass:

```ts
class UserContext extends Context<UserContextStore> {
  public buildStore(payload?: Record<string, any>): UserContextStore {
    return {
      userId: payload?.userId ?? "",
      role: payload?.role ?? "user",
    };
  }

  public get userId() {
    return this.get("userId");
  }

  public get role() {
    return this.get("role");
  }

  public get isAdmin() {
    return this.get("role") === "admin";
  }
}
```

Three flavors here:

- **Direct getter** (`userId`) — one-line passthrough. Use when a key is read in many places.
- **Derived getter** (`isAdmin`) — computes from one or more keys. Saves a few characters at every call site and centralizes the rule.
- **Action method** (a regular method, not shown) — when reading also needs validation: `requireUserId()` that throws if `userId` is empty.

Do not put every key behind a getter. If a key is only read once or twice in the whole codebase, `get("key")` at the call site is fine.

## `run` vs `enter` — pick the right one

The choice is about cleanup, not behavior:

- **`run(store, callback)`** — wraps a callback. Store auto-clears when the callback resolves or rejects. The right default.
- **`enter(store)`** — sets the store and returns. No callback, no auto-cleanup. The store lives until the surrounding async scope ends.

```ts
// ✅ run() — the safe default
async function withUser(userId: string, role: "admin" | "user", work: () => Promise<void>) {
  await userContext.run({ userId, role }, work);
}

// ⚠️ enter() — only when forced by a callback-less integration
function classicExpressMiddleware(req, res, next) {
  userContext.enter({ userId: req.user.id, role: req.user.role });
  next();
}
```

Modern async middleware (Express 5, Koa, Fastify, Hono) all support async handlers — use `run()` everywhere. Reserve `enter()` for legacy Express middleware that signals completion via `next()` and returns synchronously, or for ad-hoc one-shot scripts where you want the context to live until the program exits.

## Reading: `get`, `getStore`, `hasContext`

```ts
const userId = userContext.get("userId");        // TStore["userId"] | undefined
const store = userContext.getStore();             // TStore | undefined
const inside = userContext.hasContext();          // boolean
```

Most of the time you want `get`. `getStore` shows up when you need to log the whole record or hand it to a function that takes the full shape. `hasContext` is for safety checks at boundaries that might run inside or outside a context (a generic logger, a metrics helper).

The distinction `hasContext` exists for: `get("userId")` returns `undefined` either way — because there is no context, or because there is a context and the key is empty. `hasContext()` tells you which.

## Writing: `set`, `update`, `clear`

```ts
userContext.set("role", "admin");                 // single key
userContext.update({ role: "admin" });            // partial merge
userContext.clear();                              // wipe the store
```

`set` is sugar for `update({ key: value })`. Both call `Object.assign(currentStore, partial)` — top-level merge, no deep copy. Both should be called inside an active context; outside, `update` silently `enter()`s a new context with the partial, which is rarely what you want.

`clear()` replaces the store with `{}` cast to `TStore`. It does not exit the context — `hasContext()` still returns true after `clear()`. Rare in app code; the cleanup at the end of `run()` is the normal path.

## Multiple context instances of the same class

This is allowed and sometimes useful:

```ts
const primaryDbContext = new DatabaseContext();
const analyticsDbContext = new DatabaseContext();

await primaryDbContext.run({ connection: primaryConn }, async () => {
  await analyticsDbContext.run({ connection: analyticsConn }, async () => {
    // Both active, two stores, no collision.
  });
});
```

Two instances = two `AsyncLocalStorage` slots. Useful when you genuinely have two parallel concerns of the same shape (primary + analytics database, prod + sandbox tenant). Most apps stick with one instance per context class.

## Things to avoid

- **Don't make every cross-cutting concern a context.** Build one when the data has its own lifecycle. For one-off plumbing, a function parameter is clearer.
- **Don't capture the store reference outside the scope.** It is freed when `run()` returns. Read the value out before exiting.
- **Don't mutate the store object directly bypassing `update` / `set`.** It works, but obscures intent. The methods exist to make state changes searchable.
- **Don't share one context instance across unrelated concerns.** One typed context per domain reads better than one fat `globalContext`.

## Related

- [The context model](../essentials/01-the-context-model) — how propagation works.
- [Orchestrate contexts](./orchestrate-contexts) — running several together.
- [API reference](../reference/api) — full method signatures.
