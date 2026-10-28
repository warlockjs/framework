---
title: "Module singletons in dev"
description: Why a module-level variable can be duplicated in warlock dev, and appSingleton, the supported way to keep one value per process across hot reloads and duplicate module copies.
sidebar:
  order: 9
  label: "Module singletons"
---

An ES module graph cannot be unloaded. In `warlock dev` that has two consequences for a file that keeps state in a module-level variable:

- **Hot reload.** A change loads a new generation of the file and its dependents. The old generation stays in memory, with whatever sockets, timers, child processes or file locks it still holds.
- **Two module systems.** `src/app` files that do not need Vite are shared between Warlock's loader and the page renderer, so they are evaluated once. A file that has to stay in the renderer's Vite graph (it imports `@warlock.js/web`, lives under `src/web`, or uses `import.meta.env`) is evaluated a second time there.

A connector that installs a runtime in one copy and a route or page that reads it in another then sees an empty value, and a second copy of a `supervisor()` finds its own registry lock held by the first.

## `appSingleton`

```ts
import { appSingleton } from "@warlock.js/core";

export const getWorkerRuntime = () =>
  appSingleton("my-app.worker-runtime.v1", () => new WorkerRuntime(), {
    dispose: (runtime) => runtime.stop(),
    disposeOnReload: true,
  });
```

The value is stored on `globalThis` under `Symbol.for(key)`, so every copy of the module, and every module that uses the same key, reads and writes the same value. Production behaves identically.

| Function                              | What it does                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `appSingleton(key, create, options?)` | Returns the value for `key`, calling `create` on first use only.                                     |
| `peekAppSingleton(key)`               | Returns the value, or `undefined`, without creating it.                                              |
| `disposeAppSingleton(key)`            | Forgets the value and runs its `dispose`. The next call creates a new one.                           |
| `disposeAllAppSingletons()`           | Disposes every singleton, newest first. The framework calls it on shutdown and before a dev restart. |

Options:

- `dispose(value)` releases the value's resources.
- `disposeOnReload` (dev) disposes the value when the module that is being loaded is reloaded. It only applies when `appSingleton` runs while a module loads; for any other call site register `onCleanup(() => disposeAppSingleton(key))`.

Use namespaced, versioned keys (`<app>.<domain>.<name>.v1`) and change the version when the stored shape changes.

## Releasing resources on reload

A module's cleanup runs before it is reloaded: `export function cleanup()`, a `$cleanup` method on an exported value, or `onCleanup(callback)`. Anything holding a lock or socket should either be an `appSingleton` with a `dispose`, or be stopped from one of those hooks.

## `supervisor()` from `@warlock.js/process`

Calling `supervisor()` again in the same process with the same registry path and owner returns the live supervisor instead of failing with "Process registry is already in use". After `stopAll()` the registry is free and the next call creates a new supervisor. A different owner on the same registry is still refused. To tie the supervisor to the reload cycle, create it with `appSingleton` and `dispose: (s) => s.stopAll()`.
