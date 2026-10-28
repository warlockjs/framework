---
name: app-singletons
description: 'Keep one shared value per process that survives hot reloads and duplicate module copies in `warlock dev`: `appSingleton(key, create, { dispose, disposeOnReload })`, `peekAppSingleton`, `disposeAppSingleton`, `onCleanup`. Triggers: "module-level singleton is empty in a route", "connector installs a runtime but the route sees nothing", "503 only in dev", "same file evaluated twice", "Process registry is already in use", `supervisor()` after a reload, `Symbol.for`, `globalThis` slot, "release resources on hot reload". Skip: per-request state (`use-request-locals`), cache (`@warlock.js/cache`).'
---

# Warlock — module singletons in dev

An ES module graph cannot be unloaded. In `warlock dev`, a hot reload loads a new generation of the changed file (and its dependents) while the old generation stays in memory, and a module that has to stay in the page renderer's Vite graph (it imports `@warlock.js/web`, lives under `src/web`, or uses `import.meta.env`) is a second copy of the same file. A module-level `let runtime` is therefore **one value per copy**: the connector installs it in one copy and a route reads an empty one in another.

## Use `appSingleton`

```ts
import { appSingleton } from "@warlock.js/core";

export const getWorkerRuntime = () =>
  appSingleton("my-app.worker-runtime.v1", () => new WorkerRuntime(), {
    dispose: (runtime) => runtime.stop(),
    disposeOnReload: true,
  });
```

- The value lives on `globalThis[Symbol.for(...)]`, so every copy of the module and every module that names the key gets the same value. Production behaves the same way.
- Namespace and version the key (`<app>.<domain>.<name>.v1`); bump the version when the stored shape changes.
- `dispose` runs on `disposeAppSingleton(key)`, on application shutdown and before a dev restart. A failing `dispose` does not stop the others.
- `disposeOnReload: true` (dev) disposes the value when the module being loaded is reloaded, so the next generation builds a fresh one instead of sharing a half-stale one. Only effective when `appSingleton` runs while a module is loading; otherwise use `onCleanup(() => disposeAppSingleton(key))`.
- `peekAppSingleton(key)` reads without creating.

## Rules

- Anything holding a socket, timer, child process or file lock (a `supervisor()` from `@warlock.js/process`, a queue consumer, a poller) must be a singleton with a `dispose`, or be stopped from `onCleanup` / `export function cleanup()`.
- `supervisor()` called twice in one process with the same registry and owner returns the live supervisor; stop it with `stopAll()` to free the registry lock.
- Do not rely on a plain module-level variable for state that connectors and routes share.
