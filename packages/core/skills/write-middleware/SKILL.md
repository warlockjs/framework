---
name: write-middleware
description: 'Author HTTP middleware for @warlock.js/core — the `(request, response)` signature, short-circuit by returning a response, enrich the request with extra fields, register per-route, per-group, or app-wide. Triggers: `Middleware`, `MiddlewareResponse`, `router.group`, `guarded`, `request.detectIp`, `authMiddleware`; "write a custom middleware", "short-circuit a request", "enrich the request with extra fields", "per-route vs per-group middleware"; typical import `import type { Middleware } from "@warlock.js/core"`. Skip: built-in middleware catalog — `@warlock.js/core/use-middleware/SKILL.md`; route attachment — `@warlock.js/core/register-route/SKILL.md`; response helpers — `@warlock.js/core/send-response/SKILL.md`; competing patterns: `express` `(req, res, next)` middleware, Fastify `preHandler` hooks.'
---

# Warlock — write a middleware

Middleware is a plain function that runs before the controller. Two outcomes: return nothing (or `undefined`) and the request continues; return a `Response` and the request is short-circuited there. No `next()` callback — the framework chains them automatically.

## The shape

```ts title="src/app/<module>/utils/<name>.middleware.ts"
import type { Middleware } from "@warlock.js/core";

export const requireApiKey: Middleware = (request, response) => {
  const key = request.header("X-API-Key");

  if (!key || key !== process.env.API_KEY) {
    return response.unauthorized({ error: "invalid api key" });
  }

  // return nothing → request continues to next middleware / controller
};
```

That's the contract: `(request: Request, response: Response) => Response | undefined | void`. Async is fine — return a `Promise<Response | undefined | void>`.

The real type, from `@warlock.js/core/src/router/types.ts`:

```ts
export type Middleware<MiddlewareRequest extends Request = Request> = {
  (request: MiddlewareRequest, response: Response): MiddlewareResponse;
};

export type MiddlewareResponse = ReturnedResponse | undefined | void;
```

## Short-circuit vs continue

The pattern is "return a response to stop, return nothing to continue":

```ts
import type { Middleware } from "@warlock.js/core";

export const requireFeatureFlag: Middleware = async (request, response) => {
  const flag = await loadFeatureFlag(request.input("organization_id"));

  if (!flag.enabled) {
    return response.forbidden({ error: "feature.disabled" });
  }

  // implicit `return undefined` → continue
};
```

If you short-circuit, the controller never runs. The response helper you pick (`forbidden`, `unauthorized`, `badRequest`, etc.) sets the status — see [`send-response`](../send-response/SKILL.md).

## Enriching the request

You can attach arbitrary fields to `request` from a middleware, and they survive into the controller. The cleanest pattern is to extend `Request` via module augmentation in a `.d.ts` and assign in the middleware:

```ts title="src/app/feature-flags/middleware/load-feature-flag.middleware.ts"
import type { Middleware } from "@warlock.js/core";
import type { FeatureFlag } from "../models/feature-flag";

declare module "@warlock.js/core" {
  interface Request {
    featureFlag?: FeatureFlag;
  }
}

export const loadFeatureFlag: Middleware = async (request) => {
  request.featureFlag = await FeatureFlag.findBy("organization_id", request.user.organizationId);
};
```

After this middleware runs, `request.featureFlag` is typed inside any downstream middleware or controller. The same pattern is how `@warlock.js/auth`'s `authMiddleware` attaches `request.user` and `request.decodedAccessToken`.

## Registration — three scopes

### Per-route

Pass middleware in the third arg's `middleware` array:

```ts
import { router } from "@warlock.js/core";

router.post("/sync", syncController, {
  middleware: [requireApiKey],
});
```

### Per-group (preferred for modules)

`router.group(options, callback)` applies middleware to every route registered inside the callback:

```ts
import { router } from "@warlock.js/core";
import { authMiddleware } from "@warlock.js/auth";

router.group(
  {
    prefix: "/admin",
    middleware: [authMiddleware("admin")],
  },
  () => {
    router.get("/dashboard", dashboardController);
    router.delete("/users/:id", removeUserController);
  },
);
```

Group middleware runs **before** per-route middleware. Stack multiple middlewares — they run in array order:

```ts
import { middleware } from "@warlock.js/core";
import { authMiddleware } from "@warlock.js/auth";

router.group(
  { middleware: [middleware.rateLimit({ max: 60, duration: 60_000 }), authMiddleware("user")] },
  () => {
    // rate-limit first, then auth, then controller
  },
);
```

`all` runs on every route; `only` / `except` scope by route path or named-route. Prefer per-group for anything domain-specific — app-wide is for true cross-cutting concerns (request logging, CORS, rate limit defaults).

## The `guarded()` helper

Most modules wrap a `router.group({ middleware: [authMiddleware("user")] }, …)` call in a project-level helper:

```ts title="src/app/shared/utils/router.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

export function guarded(callback: () => void) {
  router.group({ middleware: [authMiddleware("user")] }, callback);
}

export function guardedAdmin(callback: () => void) {
  router.group({ prefix: "/admin", middleware: [authMiddleware()] }, callback);
}

export function publicRoutes(callback: () => void) {
  router.group({ prefix: "/" }, callback);
}
```

Then every module's `routes.ts` reads cleanly:

```ts
import { guarded } from "app/shared/utils/router";

guarded(() => {
  router.post("/products", createProductController);
});
```

`authMiddleware(allowedUserType?)` accepts a user-type string or array. Without an arg it just verifies the token is present; with `"user"` / `"admin"` it also checks the decoded `userType` matches.

## Common patterns

### Combining auth with a custom check

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";
import { requireFeatureFlag } from "./middleware/require-feature-flag";

router.group(
  {
    prefix: "/beta",
    middleware: [authMiddleware("user"), requireFeatureFlag],
  },
  () => {
    router.get("/canary", canaryController);
  },
);
```

### Conditional pass-through

```ts
import type { Middleware } from "@warlock.js/core";

export const optionalAuth: Middleware = async (request, response) => {
  if (!request.authorizationValue) {
    return; // anonymous — let it through
  }

  // token present → enforce it
  return authMiddleware("user")(request, response);
};
```

## Using built-in middleware

`@warlock.js/core` ships seven built-in middlewares (rate limit, concurrency cap, body cap, idempotency, maintenance, IP filter, response cache) under the `middleware` namespace from `@warlock.js/core`. They cover the patterns most apps need — see [`use-middleware`](../use-middleware/SKILL.md) for the catalog, per-primitive deep-dives, error semantics, and gotchas specific to using them.

`X-Request-Id` correlation is wired automatically (inherit + echo on every response) — the same skill covers that too. It's not a middleware; nothing to register.

## Gotchas

- **Don't `throw` for HTTP-shaped failures.** Throwing escalates to the framework's error handler and you lose the specific status. Use `return response.<helper>(...)`.
- **Group middleware runs before per-route middleware**, in array order. The full chain is `app.all → group → per-route → controller`. Mind the order if you stack auth + rate-limit + audit.
- **Middleware can be async.** Returning `Promise<undefined>` continues the chain. Returning `Promise<Response>` short-circuits. The framework awaits the result.
- **Don't mutate `request.payload` directly.** Use `request.setValidatedData(...)` or attach a new named field (`request.featureFlag = ...`). The internals expect `payload.all` shapes to come from the validator pipeline.
- **`Middleware` is generic over the request type.** For middleware that assumes a validated schema, narrow it: `const m: Middleware<CreateProductRequest> = (request) => { ... }`. But most middlewares run before validation, so the default `Middleware` is right.
- **No `next()` parameter.** Express-style `next()` doesn't apply here. The framework chains based on return value.
- **`request.baseRequest` / `response.baseResponse` are escape hatches, not API.** They expose the underlying Fastify primitives for cases the framework hasn't covered yet (streaming was the historical precedent). Prefer framework helpers first — `response.send()`, `response.header()`, `response.replay()`, `request.input()`, `request.detectIp()`, etc. If you find yourself reaching for `baseResponse` or `baseRequest` for non-streaming work, that's a missing helper — file an issue. The cache and idempotency middlewares both shipped with a quietly-broken FastifyReply-return bug because they bypassed the helper layer; the framework now guards `Response.send()` against double-send, but the right answer is "use the helper."
- **Behind any proxy, use `request.detectIp()` not `request.ip`.** `request.ip` is the immediate peer (likely your load balancer); `request.detectIp()` honors `X-Real-IP` / `X-Forwarded-For`. Either way, only trust the result as far as you trust the upstream chain — those headers are client-settable; verify the request came through your trusted edge before treating the value as authoritative.

## See also

- [`use-middleware/SKILL.md`](../use-middleware/SKILL.md) — the built-in middleware catalog (`rateLimit`, `idempotency`, `maxBodySize`, etc.) + request-id correlation.
- [`register-route/SKILL.md`](../register-route/SKILL.md) — where middleware attaches: `router.group` and route-options.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — how the controller picks up `request.user`, `request.validated()`, etc., set by upstream middleware.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — the response helpers used to short-circuit.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — the `guarded()` / `guardedAdmin()` / `publicRoutes()` convention.
