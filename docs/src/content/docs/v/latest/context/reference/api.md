---
title: "API reference"
description: Every export of @warlock.js/context — signatures, one-line purpose, and a minimal example per member.
sidebar:
  order: 1
  label: "API reference"
---

Two exports — the abstract `Context<TStore>` class and the `ContextManager` class (plus its `contextManager` singleton). That's the whole surface.

```ts
import { Context, ContextManager, contextManager } from "@warlock.js/context";
```

## `Context<TStore>`

Abstract base class. Extend it to declare a typed AsyncLocalStorage-backed context.

```ts
abstract class Context<TStore extends Record<string, any>>
```

### `buildStore(payload?)`

**Abstract.** Provides the initial store. Called by `ContextManager.buildStores(payload)`.

```ts
public abstract buildStore(payload?: Record<string, any>): TStore;
```

```ts
public buildStore(payload?: Record<string, any>): UserStore {
  return { userId: payload?.userId ?? "", role: payload?.role ?? "guest" };
}
```

### `run(store, callback)`

Run a callback inside a new context scope. The store auto-clears when the callback resolves or rejects.

```ts
public run<T>(store: TStore, callback: () => Promise<T>): Promise<T>;
```

```ts
await userContext.run({ userId: "u-1", role: "admin" }, async () => {
  await doWork();
});
```

### `enter(store)`

Set the store and return — no callback, no auto-cleanup. Use for legacy middleware that calls `next()` and returns synchronously.

```ts
public enter(store: TStore): void;
```

```ts
function middleware(req, res, next) {
  userContext.enter({ userId: req.user.id, role: req.user.role });
  next();
}
```

### `update(updates)`

Merge a partial into the current store via `Object.assign`. If no store is active, enters a new one with the partial cast to `TStore`.

```ts
public update(updates: Partial<TStore>): void;
```

```ts
userContext.update({ role: "admin" });
```

### `get(key)`

Read one key from the current store. Returns `undefined` if no context is active.

```ts
public get<K extends keyof TStore>(key: K): TStore[K] | undefined;
```

```ts
const userId = userContext.get("userId"); // string | undefined
```

### `set(key, value)`

Sugar for `update({ [key]: value })`. Same caveat — calling it outside an active context enters a new one with just that key.

```ts
public set<K extends keyof TStore>(key: K, value: TStore[K]): void;
```

```ts
userContext.set("role", "admin");
```

### `getStore()`

Return the whole store record, or `undefined` if no context is active.

```ts
public getStore(): TStore | undefined;
```

```ts
const store = userContext.getStore();
```

### `clear()`

Replace the current store with `{}` cast to `TStore`. Does not exit the scope — `hasContext()` still returns `true` afterwards.

```ts
public clear(): void;
```

```ts
userContext.clear();
```

### `hasContext()`

Returns `true` if a store is active in the current async scope. Distinguishes "no value" from "no context".

```ts
public hasContext(): boolean;
```

```ts
if (!userContext.hasContext()) {
  throw new Error("called outside a request scope");
}
```

## `ContextManager`

Orchestrates multiple registered `Context` instances. The package exports a singleton `contextManager`; you can also instantiate `new ContextManager()` if you need a separate orchestrator.

```ts
class ContextManager
```

### `register(name, context)`

Register a context under a name. Returns the manager for chaining. Re-registering the same name overwrites.

```ts
public register(name: string, context: Context<any>): this;
```

```ts
contextManager
  .register("trace", traceContext)
  .register("user", userContext);
```

### `unregister(name)`

Remove a registration. Returns `true` if a registration existed.

```ts
public unregister(name: string): boolean;
```

```ts
contextManager.unregister("debug");
```

### `buildStores(payload?)`

Call every registered context's `buildStore(payload)` and return the results keyed by registration name.

```ts
public buildStores(payload?: Record<string, any>): Record<string, any>;
```

```ts
const stores = contextManager.buildStores({ request: req, response: res });
```

### `runAll(stores, callback)`

Nest every registered context's `run()` in registration order, invoke the callback at the innermost layer.

```ts
public runAll<T>(stores: Record<string, any>, callback: () => Promise<T>): Promise<T>;
```

```ts
await contextManager.runAll(stores, async () => {
  await handleRequest(req, res);
});
```

### `enterAll(stores)`

Call `enter()` on every context whose name has a truthy value in `stores`. No auto-cleanup.

```ts
public enterAll(stores: Record<string, any>): void;
```

```ts
function middleware(req, res, next) {
  contextManager.enterAll(contextManager.buildStores({ user: req.user }));
  next();
}
```

### `clearAll()`

Call `clear()` on every registered context.

```ts
public clearAll(): void;
```

```ts
contextManager.clearAll();
```

### `getContext<T>(name)`

Look up a registered context by name. The generic parameter narrows the return type.

```ts
public getContext<T extends Context<any>>(name: string): T | undefined;
```

```ts
const tenant = contextManager.getContext<TenantContext>("tenant");
```

### `hasContext(name)`

Check whether a context is **registered** (not whether it has an active store).

```ts
public hasContext(name: string): boolean;
```

```ts
if (!contextManager.hasContext("trace")) {
  contextManager.register("trace", traceContext);
}
```

## `contextManager`

The singleton instance of `ContextManager` exported from the package.

```ts
const contextManager: ContextManager;
```

```ts
import { contextManager } from "@warlock.js/context";

contextManager.register("user", userContext);
```

## Source

- [`src/base-context.ts`](https://github.com/warlockjs/context/blob/main/src/base-context.ts) — `Context<TStore>`.
- [`src/context-manager.ts`](https://github.com/warlockjs/context/blob/main/src/context-manager.ts) — `ContextManager` + `contextManager`.

## Related

- [Define a context](../guides/define-a-context) — patterns for typed contexts.
- [Orchestrate contexts](../guides/orchestrate-contexts) — registering and running multiple together.
