---
title: "Meet @warlock.js/context"
description: A tiny typed wrapper on AsyncLocalStorage that flows request-scoped state through every awaited call without prop-drilling.
sidebar:
  order: 1
  label: "Introduction"
---

> Standalone — usable in any Node project, no `@warlock.js/core` required.

You have a request. Somewhere fifteen frames deep — inside a service called from a use-case called from a controller — you need the user id. The honest options are bad: thread `userId` through every signature on the way down, stuff it on a global that the next concurrent request will trample, or reach for a CLS library that pretends to be magic and breaks the day someone forgets a `bind`.

`@warlock.js/context` is the boring, correct answer. It is a thin typed wrapper on Node's built-in `AsyncLocalStorage` — the runtime feature designed exactly for this. You declare a context once, `run()` your handler inside it, and any function reachable through `await` can read the store. No wrappers on every promise, no leaks between requests, no `any`.

## Why AsyncLocalStorage matters

Node's `AsyncLocalStorage` (stable since Node 16) gives you per-call-tree storage that survives async boundaries. The event loop carries an invisible reference to the current store through every `await`, `setTimeout`, `process.nextTick`, and resolved promise. Two concurrent requests get two independent stores — no manual isolation needed, no race conditions to think about.

That is the entire foundation. `@warlock.js/context` adds three things on top:

- **Typed stores.** `Context<TStore>` is generic, so `get("userId")` returns `string | undefined` instead of `unknown`.
- **A consistent API.** `run`, `enter`, `update`, `get`, `set`, `getStore`, `clear`, `hasContext` — same shape across every context you define.
- **A manager for the multi-context case.** When a request needs trace + user + tenant contexts all active at once, `contextManager.runAll()` nests them deterministically so you stop hand-rolling fragile `.run().run().run()` pyramids.

## When to reach for it

Build a context when the data has its own scope and lifecycle:

- **The current request.** `userId`, `roles`, `requestId`, `locale` — every deep function might need them, none should be in the signature.
- **A trace span.** `traceId`, `startTime`, `parentSpanId` — written once at the boundary, read everywhere downstream.
- **A database transaction.** `transactionId`, `connection` — used by every repository call inside the transaction, gone the moment it commits or rolls back.
- **A tenant.** `tenantId`, `tenantConfig` — resolved at the edge, consulted by every query and policy check below.

## When to skip it

- **Plain function parameters work.** If a value is only read by the next function and not by the one after that, just pass it. Context is for the values that cross five frames.
- **Persistent state.** Stores die when the scope ends. For data that outlives the request, use a cache, a database, or a singleton.
- **Sync code with no `await`.** Context still works, but the overhead buys nothing — there is no propagation to do.

## The whole idea in fifteen lines

Declare a context, `run()` your handler inside it, read the store from any function below — no parameter ever changes hands:

```ts
import { Context } from "@warlock.js/context";

class UserContext extends Context<{ userId: string }> {
  public buildStore(payload?: Record<string, any>) {
    return { userId: payload?.userId ?? "" };
  }
}

const userContext = new UserContext();

async function deepInTheCallStack() {
  return userContext.get("userId"); // "u-42" — never passed in
}

await userContext.run({ userId: "u-42" }, async () => {
  console.log(await deepInTheCallStack()); // "u-42"
});
```

`deepInTheCallStack` never took a `userId` parameter — it read it off the active scope. When `run()` resolves, the store is gone, and the next concurrent call gets its own. That is the entire value proposition; everything else is typing and ergonomics on top.

## What you get in five minutes

A single file declares the context, `run()` wraps the handler, every function below reads typed values. Same shape whether you're inside a Warlock app, an Express server, a Fastify route, a worker thread, or a bare script. The next page installs it; the page after that walks you through a working example.

## Related

- [Installation](./02-installation) — drop it into any Node project.
- [Your first context](./03-your-first-context) — five-minute working example.
- [The context model](../essentials/01-the-context-model) — how AsyncLocalStorage flows through awaits.
