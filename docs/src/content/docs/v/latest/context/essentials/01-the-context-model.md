---
title: "The context model"
description: How AsyncLocalStorage flows through async boundaries, why each request gets its own store, and the rules that follow.
sidebar:
  order: 1
  label: "The context model"
---

Everything in `@warlock.js/context` reduces to one runtime fact: Node's `AsyncLocalStorage` carries a reference to the current store through every async boundary inside a `run()` callback. Get that mental model right and the rest of the API answers itself.

## What `run()` actually does

```ts
await userContext.run({ userId: "u-1" }, async () => {
  await someAsync();
});
```

Under the hood:

1. Node creates a fresh storage slot scoped to this call.
2. The callback executes. Inside it, `userContext.getStore()` returns `{ userId: "u-1" }`.
3. Every `await` inside the callback hands the slot to the next continuation. Same for `setTimeout`, `queueMicrotask`, `process.nextTick`, and resolved promises.
4. When the callback resolves or throws, the slot is released. `userContext.getStore()` outside the callback returns `undefined`.

The slot is **per call-tree**, not per file or per module. Two concurrent `run()` calls each get their own slot — they cannot see each other.

## What "propagates through awaits" means

```ts
async function deep() {
  return userContext.get("userId"); // "u-1"
}

async function middle() {
  return deep();
}

async function shallow() {
  return middle();
}

await userContext.run({ userId: "u-1" }, async () => {
  console.log(await shallow()); // "u-1"
});
```

The chain `shallow → middle → deep` does not pass `userId` as a parameter, and none of these functions know `userContext` was set above them. They still read it because each `await` preserves the storage slot.

This works across:

- `await` of a Promise.
- `await` of a value returned by another async function.
- `setTimeout` / `setInterval` callbacks.
- `process.nextTick` and `queueMicrotask` callbacks.
- `.then()` / `.catch()` chains.
- Event emitter callbacks fired from inside the scope.

It does **not** survive:

- A fresh worker thread (the worker boots without inheriting the parent's storage).
- A child process spawned via `child_process`.
- A message pushed onto a queue and consumed by a separate worker.
- An HTTP request to another server — even if it is your own server.

The rule of thumb: if the next bit of code runs in the same Node process and the same call tree, it sees the context. If it crosses a process boundary or runs on a fresh task, it does not.

## One context per request

This is the load-bearing invariant. A web framework calls `run()` once per incoming request, the request handler does its work inside that callback, and when the response goes out the store is released. The next request gets a new `run()` and a new store. Two requests running concurrently see two independent stores even though they hit the same `userContext` instance.

```ts
// HTTP middleware — concurrent requests, isolated stores.
app.use((req, res, next) => {
  userContext.run({ userId: req.headers["x-user-id"] }, async () => {
    next();
  });
});
```

`userContext` itself is a long-lived singleton. The **storage slot** behind it is per-request. That distinction is the whole point — one instance, many simultaneous scopes.

## `run()` vs `enter()` — the auto-cleanup difference

The package exposes two ways to set a store:

- **`run(store, callback)`** wraps a function. When the callback finishes (resolved or rejected), the store is released. This is the safe default.
- **`enter(store)`** sets the store and returns immediately. There is no callback to bound the lifetime; the store lives until the surrounding async scope ends. Use this only when the framework forces your hand — classic Express middleware where you call `next()` and return synchronously.

`enter()` is `AsyncLocalStorage.enterWith(store)` under the hood. The Node docs flag it as easier to misuse than `run()` because nothing forces a cleanup boundary. In `@warlock.js/context`, prefer `run()` everywhere you can; reach for `enter()` only when the integration leaves you no choice.

## Reading: `get`, `getStore`, `hasContext`

Three accessors with three jobs:

```ts
userContext.get("userId");      // TStore["userId"] | undefined — one key
userContext.getStore();         // TStore | undefined — the whole record
userContext.hasContext();       // boolean — am I inside a run() / enter()?
```

`get` is the daily-driver: one key, typed return. `getStore` is for when you want to pass the whole record somewhere. `hasContext` distinguishes "no value for this key" from "no context at all" — useful in framework code that wants to fall back when called outside the request lifecycle.

## Writing: `set`, `update`

```ts
userContext.set("role", "admin");           // one key
userContext.update({ role: "admin" });      // partial merge
```

`set(key, value)` is sugar for `update({ [key]: value })`. Both mutate the current store in place using `Object.assign`. Both should be called inside an active context — if no store exists, `update` will `enter()` a new one with just the partial, which is rarely what you want.

There is no `delete(key)` — by design, contexts are append-only within a scope. To "remove" a value, write a sentinel (`undefined`, `null`, or a domain-specific zero value) per your store's type.

## Two requests, zero leaks

```ts
async function simulate() {
  await Promise.all([
    userContext.run({ userId: "alice" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(userContext.get("userId")); // "alice"
    }),
    userContext.run({ userId: "bob" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      console.log(userContext.get("userId")); // "bob"
    }),
  ]);
}
```

Both timers fire in the same event loop. Neither sees the other's `userId`. That isolation is the entire reason `AsyncLocalStorage` exists.

## The rules, summarized

1. **Set at the boundary.** `run()` wraps the work, `enter()` enters the work — pick one, never both for the same scope.
2. **Read anywhere downstream.** `get` / `getStore` work as long as you are inside an active scope.
3. **Concurrency is free.** Two `run()` calls cannot leak into each other.
4. **Process boundaries are walls.** Workers, child processes, queues, HTTP — store does not cross.
5. **Cleanup is automatic with `run()`.** Manual with `enter()` (call `clear()` if you must, or just let the request scope end).

## Related

- [Orchestrating multiple contexts](./02-orchestrating-multiple-contexts) — when one request needs user + tenant + trace at once.
- [Use in workers and jobs](../guides/use-in-workers-and-jobs) — what to do at process boundaries.
- [API reference](../reference/api) — every method, every signature.
