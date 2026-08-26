---
name: use-request-locals
description: 'Carry typed, server-only data through one HTTP request with `request.locals`, usually written by middleware and read by downstream middleware or controllers. Augment `RequestLocals` in the module that owns each key; v5 no longer permits arbitrary `request.foo` properties. Triggers: `request.locals`, `RequestLocals`, `request.post`, `request.organization`, `Property does not exist on type Request`, `Request index signature`; "attach data to a request", "share middleware data with a controller", "type request locals", "migrate dynamic request properties"; typical type augmentation `declare module "@warlock.js/core" { interface RequestLocals { ... } }`. Skip: computed-on-demand single-flight values and removed `fromRequest` — `@warlock.js/core/request-memo/SKILL.md`; middleware mechanics — `@warlock.js/core/write-middleware/SKILL.md`; authenticated user typing — augment `RequestUser`, not `RequestLocals`; competing patterns: `(request as any).foo`, `request.set()`, module-global mutable state.'
---

# Warlock — use typed request locals

`request.locals` is the v5 home for private data that middleware writes and downstream code reads during the same request. It is separate from client input and starts as a fresh object on every `Request` instance.

## The exact declarations

From `core/src/http/types.ts`:

```ts
export interface RequestLocals {}
```

From `core/src/http/request.ts`:

```ts
public locals: RequestLocals = {};
```

`RequestLocals` is intentionally empty and augmentable. It has no index signature: declare owned keys explicitly so reads and writes have their real types instead of `any`.

## Migrate a middleware attachment from v4 to v5

### Before — v4 dynamic `Request` property

```ts title="src/app/observability/middleware/request-timing.middleware.ts"
import type { Middleware } from "@warlock.js/core";

export const requestTimingMiddleware: Middleware = request => {
  request.startedAt = Date.now();
};
```

```ts title="src/app/observability/controllers/timing.controller.ts"
import type { RequestHandler } from "@warlock.js/core";

export const timingController: RequestHandler = async (request, response) => {
  return response.success({ elapsedMs: Date.now() - request.startedAt });
};
```

Those arbitrary properties compiled in v4 because `Request` had a `[key: string]: any` index signature. That signature is gone in v5.

### After — v5 typed `request.locals`

Declare the key once in the feature that owns and writes it:

```ts title="src/app/observability/request-locals.d.ts"
declare module "@warlock.js/core" {
  interface RequestLocals {
    startedAt?: number;
  }
}

export {};
```

Write it in middleware:

```ts title="src/app/observability/middleware/request-timing.middleware.ts"
import type { Middleware } from "@warlock.js/core";

export const requestTimingMiddleware: Middleware = ({ request }) => {
  request.locals.startedAt = Date.now();
};
```

Read it downstream:

```ts title="src/app/observability/controllers/timing.controller.ts"
import type { RequestHandler } from "@warlock.js/core";

export const timingController: RequestHandler = async ({ request, response }) => {
  const startedAt = request.locals.startedAt;

  if (startedAt === undefined) {
    return response.serverError({ error: "request timing middleware did not run" });
  }

  return response.success({ elapsedMs: Date.now() - startedAt });
};
```

The `?` is honest about runtime ordering: the type exists everywhere, but the value exists only after the middleware runs. Narrow it downstream unless every construction path guarantees initialization and your project deliberately declares the key as required.

## Augment with an application type

An augmentation file may import the value's type. Keeping the declaration beside the writer makes ownership visible and prevents unrelated packages from claiming the same key.

```ts title="src/app/organizations/request-locals.d.ts"
import type { Organization } from "./models/organization";

declare module "@warlock.js/core" {
  interface RequestLocals {
    organization?: Organization;
  }
}

export {};
```

The module specifier must be `"@warlock.js/core"`, matching the public package import whose `RequestLocals` interface is exported.

## Where the augmentation file goes

A new project scaffolds `src/typings.d.ts` and lists it explicitly in `tsconfig.json`'s `include`. That is the sanctioned home for application-wide augmentations — `RequestLocals` and `RequestUser` both ship there as empty `interface` declarations with the reasoning written above them.

```ts title="src/typings.d.ts"
declare module "@warlock.js/core" {
  interface RequestLocals {}

  interface RequestUser {}
}

export {};
```

Feature-local files such as `src/app/organizations/request-locals.d.ts` are equally valid and keep ownership next to the middleware that writes the key; the scaffold's `include` covers all of `src`. Use `src/typings.d.ts` for declarations no single feature owns.

Two rules the scaffold's own comments spell out, and both bite silently:

- **Keep the trailing `export {}`.** `declare module "x"` inside a file with no top-level import or export declares an *ambient* module, which REPLACES `@warlock.js/core`'s real typings instead of merging into them — every framework export vanishes. The `export {}` is what makes the file a module and the block an augmentation. It is not an unused statement to clean up.
- **Keep them `interface`, not `type`.** This project otherwise prefers `type`; these are the named exception, because declaration merging is interface-only. `type RequestUser = { ... }` is a duplicate-identifier error, not an augmentation.

On a project scaffolded before 5.1 there is no `src/typings.d.ts`, and `tsconfig.json` carries `"typeRoots": ["./src/typings.d.ts"]` — wrong twice, since `typeRoots` takes directories of `@types` packages rather than files, and that file did not exist. Drop the `typeRoots` entry, create the file, and list it under `include`.

## What belongs in `locals`

Good fits are values explicitly produced by one stage and consumed by later stages:

- a resolved organization, session, feature flag, or authorization subject;
- request timing or tracing metadata;
- a model loaded by validation or routing middleware;
- private server state that must not appear in request input.

`locals` is not a cache API. If consumers should be able to ask for a value independently and concurrent calls must collapse into one loader, use `requestMemo()` instead.

## Isolation from input and other requests

`Request` initializes `locals` with `{}` for each new request. Request instances are not pooled, so values cannot carry into the next request.

Writing `request.locals.organization` does not affect `request.all()`, `request.input()`, or `request.validated()`. By contrast, `request.set()` writes into the input payload's `all` bag, so it is the wrong replacement for a private v4 attachment.

## Choosing the extension surface

- Use `request.locals` for per-request data written by middleware and read downstream.
- Use `requestMemo(key, fn)` for lazily computed, single-flight work scoped to the active request.
- Augment `Request` itself only for a genuine new typed member that also has a runtime implementation.
- Augment `RequestUser` for the authenticated `request.user` shape; do not duplicate it under locals merely to work around typing.

## Gotchas

- **Do not restore `(request as any).post`.** It recreates the exact unchecked behavior v5 removed.
- **Do not add `[key: string]: any` to `RequestLocals`.** Declare each key with its actual type; otherwise every typo becomes valid again.
- **Do not centralize keys owned by unrelated features.** The middleware or package that writes a key should own its augmentation.
- **Do not assume an optional local was initialized.** Middleware registration and ordering are runtime concerns; narrow the value or fail clearly downstream.
- **Avoid key collisions across augmentations.** Interface merging requires repeated property declarations to agree, but stable feature-prefixed names are clearer for generic metadata.

## See also

- [`request-memo/SKILL.md`](../request-memo/SKILL.md) — the `fromRequest()` migration and single-flight request memoization.
- [`write-middleware/SKILL.md`](../write-middleware/SKILL.md) — middleware execution and registration.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — reading locals in downstream controllers.
