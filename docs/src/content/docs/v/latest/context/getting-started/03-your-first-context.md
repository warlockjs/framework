---
title: "Your first context"
description: Build a UserContext, run a handler inside it, and read the user id from a function five frames deep.
sidebar:
  order: 3
  label: "Your first context"
---

Five minutes. One file. By the end you will have a typed `UserContext` that flows through async calls without ever appearing in a function signature below the boundary.

## The problem you are solving

```ts
// You start here — userId in hand.
async function handleRequest(userId: string) {
  await loadUserPreferences(); // ← needs userId
}

// Five frames deep, you still need it.
async function fetchAuditTrail() {
  // userId? It's gone.
  return [];
}
```

Threading `userId` through every signature works. It also pollutes every function that should not care about authentication just to relay a value. Context lets you read it where you need it.

## Step 1 — Declare the store shape

A plain TypeScript type that describes what the context holds:

```ts title="src/contexts/user-context.ts"
type UserContextStore = {
  userId: string;
  role: "admin" | "user";
};
```

Use `type` for the store shape — it is data, not a contract.

## Step 2 — Extend `Context<TStore>`

```ts title="src/contexts/user-context.ts"
import { Context } from "@warlock.js/context";

type UserContextStore = {
  userId: string;
  role: "admin" | "user";
};

class UserContext extends Context<UserContextStore> {
  public buildStore(payload?: Record<string, any>): UserContextStore {
    return {
      userId: payload?.userId ?? "",
      role: payload?.role ?? "user",
    };
  }
}

export const userContext = new UserContext();
```

`buildStore` is the only method you must implement — everything else (`run`, `get`, `set`, `update`, ...) is inherited. It is called by `contextManager.buildStores(payload)` to seed the store at the boundary; the payload is whatever you pass in (a `req` object, a job message, a CLI args bag).

## Step 3 — `run()` at the boundary

The boundary is wherever your scope starts — an HTTP handler, a queue consumer, a scheduled job:

```ts title="src/server.ts"
import { userContext } from "./contexts/user-context";

async function handleRequest(req: { userId: string; role: "admin" | "user" }) {
  await userContext.run({ userId: req.userId, role: req.role }, async () => {
    await loadUserPreferences();
  });
}
```

Everything inside the callback — and every async function it awaits, no matter how deep — sees the same store.

## Step 4 — Read it five frames deep

```ts title="src/services/audit.service.ts"
import { userContext } from "../contexts/user-context";

export async function fetchAuditTrail() {
  const userId = userContext.get("userId");
  const role = userContext.get("role");

  if (!userId) {
    throw new Error("fetchAuditTrail called outside a user context");
  }

  return queryAuditLogFor(userId, role);
}
```

`get("userId")` returns `string | undefined`, typed off the store shape. The function did not take `userId` as a parameter — it pulled it from the active scope.

## Step 5 — Run it end-to-end

```ts
import { userContext } from "./contexts/user-context";
import { fetchAuditTrail } from "./services/audit.service";

async function deepWork() {
  return fetchAuditTrail();
}

async function loadUserPreferences() {
  return deepWork();
}

await userContext.run(
  { userId: "u-123", role: "admin" },
  async () => {
    const trail = await loadUserPreferences();
    console.log(trail);
  },
);
```

`fetchAuditTrail` never received `userId`, but it read `"u-123"` from the active context. When `run()` returns, the store is gone — the next concurrent call gets its own.

## What just happened

- `userContext.run(store, fn)` calls Node's `AsyncLocalStorage.run(store, fn)` under the hood.
- Node tracks the store through every `await` and microtask boundary inside `fn`.
- Two concurrent calls to `run()` get isolated stores — no leaks between them.
- When `fn` returns or throws, the store is released. No cleanup code needed.

## Common follow-ups

- **Need more than one context?** A request typically wants user + trace + tenant active at once. The next-level pattern is `contextManager.runAll()` — see [Orchestrate contexts](../guides/orchestrate-contexts).
- **Middleware without a callback?** Express-style middlewares call `next()` and return synchronously. Use `userContext.enter(store)` instead of `run()` — see [Define a context](../guides/define-a-context).
- **Want a shorter accessor?** Add a getter on the subclass: `get userId() { return this.get("userId"); }`. Then `userContext.userId` reads cleaner than `userContext.get("userId")`.

## Related

- [The context model](../essentials/01-the-context-model) — how AsyncLocalStorage propagates through awaits.
- [Define a context](../guides/define-a-context) — patterns for typed contexts.
- [API reference](../reference/api) — every exported member.
