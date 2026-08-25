---
name: request-memo
description: 'Memoize async work for one HTTP request with `requestMemo<T>(key, fn)` — the v5 replacement for removed `fromRequest`, with single-flight promise sharing, settled-success reuse, rejection eviction, and no cross-request fallback. Triggers: `requestMemo`, `fromRequest`, `fromRequest removed`, `request-scoped cache`, `single-flight`, `current request memo`; "migrate off fromRequest", "load this once per request", "deduplicate concurrent loaders", "cache a repository lookup during one request"; typical import `import { requestMemo } from "@warlock.js/core"`. Skip: middleware-written request state — `@warlock.js/core/use-request-locals/SKILL.md`; process-wide or cross-request caching — `@warlock.js/core/use-middleware/SKILL.md`; competing patterns: dynamic `request[key]` properties, module-global `Map`, payload `request.get()` / `request.set()`.'
---

# Warlock — memoize work for one request

`requestMemo()` is the v5 replacement for the removed `fromRequest()`. Use it when several code paths in the same HTTP request may need the same asynchronously computed value and the work should run once.

## The exact signature

From `core/src/http/context/request-memo.ts`:

```ts
export function requestMemo<T>(key: string, fn: () => Promise<T>): Promise<T>
```

Import it from the package root:

```ts
import { requestMemo } from "@warlock.js/core";
```

`fn` takes no arguments and must return a promise. Close over the current request or the inputs needed by the loader.

## Migrate from v4 to v5

### Before — v4 `fromRequest()`

```ts title="src/app/tenants/utils/current-tenant.ts"
import { fromRequest, type Request } from "@warlock.js/core";

type Tenant = { id: string };

async function loadTenant(id: string): Promise<Tenant> {
  return { id };
}

export function currentTenant(request: Request): Promise<Tenant> {
  const tenantId = String(request.header("x-tenant-id") ?? "");

  return fromRequest("tenants.current", () => loadTenant(tenantId));
}
```

### After — v5 `requestMemo()`

```ts title="src/app/tenants/utils/current-tenant.ts"
import { requestMemo, type Request } from "@warlock.js/core";

type Tenant = { id: string };

async function loadTenant(id: string): Promise<Tenant> {
  return { id };
}

export function currentTenant(request: Request): Promise<Tenant> {
  const tenantId = String(request.header("x-tenant-id") ?? "");

  return requestMemo("tenants.current", () => loadTenant(tenantId));
}
```

The call-site migration is usually the import and function name. The complete v5 example above also shows the callback-shape migration: if a v4 callback used the `Request` argument supplied by `fromRequest`, capture the surrounding `request` variable because `requestMemo`'s `fn` receives no arguments.

## Single-flight behavior

Within one request, the first call for a key invokes `fn` and stores its promise. Every concurrent caller using that key receives that exact promise, so parallel consumers do not duplicate the work. After the promise resolves, later calls during the same request keep receiving the cached successful promise.

```ts title="src/app/catalog/controllers/show-product.controller.ts"
import { requestMemo, type RequestHandler } from "@warlock.js/core";

let loads = 0;

async function loadProduct(): Promise<{ id: string }> {
  loads += 1;
  return { id: "product-1" };
}

export const showProductController: RequestHandler = async ({ response }) => {
  const first = requestMemo("catalog.product", loadProduct);
  const second = requestMemo("catalog.product", loadProduct);
  const [product, sameProduct] = await Promise.all([first, second]);

  return response.success({ product, sameProduct, loads });
};
```

For that request, `first === second` and `loads` is `1`.

A rejection is not cached. The rejected entry is deleted immediately, so a later call with the same key retries `fn`. Callers already sharing the rejected promise all observe that rejection.

## Lifetime and isolation

The memo table is attached indirectly to the current request-context store through a `WeakMap`. Each incoming request gets a fresh store, so:

- two concurrent requests never share entries, even when they use the same key;
- resolved values live only for the request's context lifetime;
- the store and its memo entries are eligible for garbage collection after the request ends;
- no value is written onto the `Request` object.

Calling `requestMemo()` outside the HTTP request pipeline throws synchronously. It deliberately has no process-global fallback. For data meant to survive across requests, use an explicit application cache instead.

## Why it replaces `fromRequest()`

`fromRequest()` memoized through dynamic `request[key]` properties. That only type-checked because v4's `Request` had a `[key: string]: any` index signature. v5 removed both the unsafe index signature and `fromRequest()`; `requestMemo()` keeps the one-request lifetime without mutating `Request` or turning values into `any`.

The new helper also provides real single-flight behavior: it stores the in-flight promise. The old helper awaited its callback before writing the result onto `Request`, so concurrent v4 callers could run the same callback more than once.

## Key design

Keys share one string namespace within a request. Use stable, namespaced keys and include every input that changes the result:

```ts
import { requestMemo } from "@warlock.js/core";

type Product = { id: string };

async function findProduct(id: string): Promise<Product> {
  return { id };
}

export function productById(id: string): Promise<Product> {
  return requestMemo(`catalog.product:${id}`, () => findProduct(id));
}
```

Reusing one key for different result types is a caller bug: TypeScript cannot compare the generic type arguments used at separate call sites.

## Gotchas

- **Do not call it during bootstrap, in a CLI command, or from a background job.** There is no active HTTP request context there, so it throws.
- **Do not omit result-changing inputs from the key.** `catalog.product` is wrong when different IDs may be loaded during one request; use `catalog.product:${id}`.
- **Do not use `request.set()` as a replacement.** It writes to the request input payload read by `all()`, `input()`, and `validated()`.
- **Failures retry.** If repeated failures must also be cached, this primitive is not that policy; catch and convert the failure into a successful result deliberately, or use another cache.
- **Use `request.locals` for state written by middleware and read downstream.** Memoization and request attachment are separate jobs.

## See also

- [`use-request-locals/SKILL.md`](../use-request-locals/SKILL.md) — typed per-request data written by middleware.
- [`write-middleware/SKILL.md`](../write-middleware/SKILL.md) — authoring and registering middleware.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — consuming request-scoped values from controllers.
