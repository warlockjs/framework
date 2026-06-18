---
title: "Middleware"
description: Middleware in Warlock — function shape, where to attach (route, group, all routes), short-circuiting with a response, enriching the request, and ordering.
sidebar:
  order: 4
  label: "Middleware"
---

Middleware is the code that runs between "router matched a route" and "controller starts". It's the place for auth checks, rate limits, request-scoped enrichment, and anything else that has to decide *whether* the controller runs and *what state* it sees.

In Warlock a middleware is just a function. No class, no decorator, no `next()` callback — you receive `request` and `response`, and either:

- **Return nothing** → the chain continues.
- **Return a response value** → the framework sends it and the controller never runs.

That's the whole contract. Let's unpack what it means in practice.

## The function shape

```ts title="The Middleware type"
export type MiddlewareResponse = ReturnedResponse | undefined | void;

export type Middleware<MiddlewareRequest extends Request = Request> = {
  (request: MiddlewareRequest, response: Response): MiddlewareResponse;
};
```

A middleware is `(request, response) => something | undefined`. If `something` is truthy (an object, a `Response` instance, anything the framework can turn into a body), the request is short-circuited — the framework sends it back as the reply, and the controller does not run.

The simplest middleware:

```ts
import type { Middleware } from "@warlock.js/core";

export const requireHttps: Middleware = (request, response) => {
  if (request.protocol !== "https") {
    return response.badRequest({ error: "HTTPS required" });
  }
  // implicit return undefined → continue
};
```

Three things to notice:

1. The middleware imports `Middleware` from `@warlock.js/core`. Same type whether you write it in a project or a package.
2. The terminal call is `return response.badRequest(...)` — the same helpers a controller uses. The framework treats whatever you return as the response.
3. Returning nothing means the chain continues.

You can `async`-ify any middleware:

```ts
import type { Middleware } from "@warlock.js/core";

export const loadOrganization: Middleware = async (request, response) => {
  const slug = request.input("orgSlug");

  if (!slug) {
    return response.badRequest({ error: "orgSlug is required" });
  }

  const organization = await Organization.first({ slug });

  if (!organization) {
    return response.notFound({ error: "organization.notFound" });
  }

  // enrich the request for downstream code
  request.organization = organization;
};
```

`request.organization = organization;` works because `Request` has an index signature for ad-hoc extension. Downstream controllers can read `request.organization` (cast it if you care about strict types).

## Where to attach middleware

Three places, ordered from most-specific to least:

### 1. Per-route

Pass an array via the third argument of any router method:

```ts
import { router } from "@warlock.js/core";
import { rateLimitByIp } from "./middleware/rate-limit";

router.get("/expensive", expensiveController, {
  middleware: [rateLimitByIp({ max: 10 })],
});
```

Per-route middleware is the rarest case — usually a route either belongs to a guarded group or stands alone with no middleware.

### 2. Per-group

`router.group({ middleware: [...] }, callback)` applies middleware to every route declared inside the callback. This is the workhorse pattern:

```ts
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

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

Every route inside the callback inherits the middleware. `prefix` and `middleware` compose with outer groups, so you can stack:

```ts
router.group({ prefix: "/api", middleware: [requestId] }, () => {
  router.group({ prefix: "/v1", middleware: [rateLimit] }, () => {
    router.get("/health", healthController);   // both middlewares run
  });
});
```

The order is **outer first**: `requestId` runs, then `rateLimit`, then the controller.

### 3. Module-level helpers

Most projects with `@warlock.js/auth` define a few wrapper helpers in `src/app/shared/utils/router.ts` so route files stay readable. The reference codebase ships these:

```ts title="src/app/shared/utils/router.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

export function publicRoutes(callback: () => void) {
  router.group({ prefix: "/" }, callback);
}

export function guardedAdmin(callback: () => void) {
  router.group(
    {
      prefix: "/admin",
      middleware: [authMiddleware()],
    },
    callback,
  );
}

export function guarded(callback: () => void) {
  router.group(
    {
      middleware: [authMiddleware("user")],
    },
    callback,
  );
}
```

Routes use them like this:

```ts title="src/app/faqs/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { createFaqController } from "./controllers/create-faq.controller";
import { listFaqsController } from "./controllers/list-faqs.controller";

guarded(() => {
  router.get("/faqs", listFaqsController);
  router.post("/faqs", createFaqController);
});
```

Two lines of intent. Every controller inside the `guarded` block can trust `request.user` is set.

### Group order

If a route has middleware from both a group and the route itself, group middleware runs first by default. You can flip this with `middlewarePrecedence`:

```ts
router.get("/whatever", handler, {
  middleware: [routeSpecific],
  middlewarePrecedence: "before",   // routeSpecific runs BEFORE group middleware
});
```

The default `"after"` is the right choice 95% of the time — group middleware represents broader policy (auth, rate limit), route middleware represents a route-specific tweak.

## The built-in HTTP plugins

Some "middleware-like" behaviour ships as Fastify plugins registered at boot, before any route-level middleware runs. You don't write these — they exist by virtue of using `@warlock.js/core`:

| Plugin              | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `@fastify/cors`     | CORS headers. Configured via `config.get("http.cors")`.     |
| `@fastify/multipart`| Parses multipart bodies into files + fields.                |
| `@fastify/cookie`   | Parses cookies into `request.cookies`.                      |
| `@fastify/rate-limit`| Global rate limiter. `config.get("http.rateLimit")`.       |
| `@fastify/static`   | Serves the `public/` directory at `/public/...`.            |

Real config (from the reference project):

```ts title="src/config/http.ts"
import { Application, env } from "@warlock.js/core";

const httpConfigurations = {
  port: env("HTTP_PORT", 3000),
  fileUploadLimit: 12 * 1024 * 1024 * 1024,
  rateLimit: { max: 260, duration: 60 * 1000 },
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] },
  cookies: {
    secret: env("COOKIE_SECRET", "super-secret-key-change-me"),
    options: { httpOnly: true, secure: Application.isProduction, path: "/" },
  },
};
```

Most apps don't need to think about these — they Just Work. Customise via the config if you need stricter CORS, a different rate limit, or a custom upload size.

## Built-in middleware

`@warlock.js/core` also ships a set of attach-as-needed middlewares for the patterns most apps eventually want. Unlike the plugins above (which run for every request at boot), you opt into these per route or per group. All of them live under a single `middleware` namespace export — one autocomplete entry point for the whole suite:

```ts
import { middleware } from "@warlock.js/core";

middleware.rateLimit({ max: 5, duration: 60_000 });
middleware.idempotency();
middleware.maxBodySize("2mb");
// ... and so on
```

| Factory                                  | What it does                                                                | Status on reject       |
| ---------------------------------------- | --------------------------------------------------------------------------- | ---------------------- |
| `middleware.rateLimit({ max, duration })` | Per-route cap on top of the global plugin                                  | 429 + `Retry-After`    |
| `middleware.concurrencyLimit(n)`         | Cap in-flight requests; no queue, fast reject                               | 429 + `Retry-After: 1` |
| `middleware.maxBodySize("2mb")`          | Per-route `Content-Length` cap (in addition to `http.bodyLimit` global)     | 413                    |
| `middleware.idempotency()`               | Dedupe writes by `Idempotency-Key`; same key + same body → cached replay    | 422 on conflict        |
| `middleware.maintenance()`               | App-wide 503 toggle via `http.maintenance.enabled` (with allowlist bypass)  | 503 + `Retry-After`    |
| `middleware.ipFilter({ allow })`         | Allowlist / denylist by client IP, IPv4 CIDRs supported, fail-closed        | 403                    |
| `middleware.cache(opts)`                 | Cache + replay successful JSON responses                                    | n/a                    |

Composed example — a tight cap on logins, a concurrency cap + idempotency on AI calls:

```ts
import { authMiddleware } from "@warlock.js/auth";
import { middleware, router } from "@warlock.js/core";

router.post("/auth/login", loginController, {
  middleware: [middleware.rateLimit({ max: 5, duration: 60_000 }), middleware.maxBodySize("4kb")],
});

router.group({ middleware: [authMiddleware("client")] }, () => {
  router.post("/ai/summarize", summarizeController, {
    middleware: [
      middleware.rateLimit({ max: 60, duration: 60 * 60 * 1000 }),
      middleware.concurrencyLimit(5),
      middleware.idempotency({ ttl: 60 * 60 }),
    ],
  });
});
```

All seven set an `errorCode` on the response so clients can branch without parsing error text — see `HttpErrorCodes` from `@warlock.js/core`. The full option surface and gotchas (especially "idempotency must run after auth" and "counters are process-local") live in the ``write-middleware` skill`.

Two patterns from elsewhere in the framework that don't live under `middleware`:

- **`authMiddleware`** ships from `@warlock.js/auth` and stays a top-level export of that package — package-shipped primitives keep their package-scoped name, framework built-ins live in the namespace.
- **Bare names like `rateLimit`** are not exported. The internal `*Middleware`-suffixed factory functions exist only for in-package code organization — always reach for `middleware.rateLimit`, not `rateLimit`.

### Request ID correlation

Every request gets a `request.id` and the framework echoes it back as `X-Request-Id` on every response — so clients can show "request 7a3f… failed" in an error toast, and support can grep logs by that single value. The framework also **inherits** an inbound `X-Request-Id` from the request if it's well-formed (printable ASCII, ≤128 chars), so an upstream proxy or FE can propagate its own correlation ID end-to-end.

Not a middleware — wired into `Request.setRequest()` and `createRequestStore()`. Configure via `http.requestId.{header, generator, enabled}`. **Request ID is not the same as an idempotency key**; a fresh ID is generated per retry. For write deduplication on retry, use `middleware.idempotency()`.

## Writing custom middleware

Two common patterns:

### Pattern 1 — Short-circuit on a guard

The middleware decides whether the request is allowed; if not, return a response and the controller is skipped.

```ts
import type { Middleware } from "@warlock.js/core";

export function requireFeatureFlag(flag: string): Middleware {
  return async (request, response) => {
    const flags = request.user?.featureFlags ?? [];

    if (!flags.includes(flag)) {
      return response.forbidden({
        error: `Feature ${flag} not enabled for your account`,
      });
    }
  };
}
```

Use it:

```ts
router.get("/beta-feature", betaController, {
  middleware: [requireFeatureFlag("beta-dashboard")],
});
```

### Pattern 2 — Enrich the request

The middleware loads or computes something and attaches it for downstream code. No return value — the chain continues.

```ts
import type { Middleware } from "@warlock.js/core";
import { Organization } from "app/organizations/models/organization";

export const loadOrganizationFromHost: Middleware = async (request) => {
  const host = request.hostname;
  const organization = await Organization.first({ host });

  if (organization) {
    request.organization = organization;
  }
};
```

Downstream controllers read `request.organization` if it's set. If you need it to be required, write a guard variant that short-circuits with a 404 when missing.

### A real example — `authMiddleware`

The auth middleware in `@warlock.js/auth` is a clean example of both patterns combined. Stripped to the essentials:

```ts title="authMiddleware (from @warlock.js/auth)"
import { type Middleware, type Request, type Response, t } from "@warlock.js/core";

export function authMiddleware(allowedUserType?: string | string[]) {
  return async (request: Request, response: Response) => {
    const token = request.authorizationValue;

    // 1. Public route — no auth needed and none provided
    if (!allowedUserType && !token) return;

    // 2. Auth required but missing → short-circuit
    if (!token) {
      return response.unauthorized({ error: t("auth.errors.missingAccessToken") });
    }

    // 3. Verify and load the user
    const decoded = await jwt.verify(token);
    const accessToken = await AccessToken.first({ token });

    if (!accessToken) {
      return response.unauthorized({ error: t("auth.errors.invalidAccessToken") });
    }

    // 4. Type check
    if (allowedUserType && !allowedTypes.includes(accessToken.get("userType"))) {
      return response.unauthorized({ error: t("auth.errors.unauthorized") });
    }

    // 5. Enrich request — controller can trust request.user
    request.user = await UserModel.find(decoded.id);
  };
}
```

Notice the shape: it's a **factory** that takes config (`allowedUserType`) and returns a `Middleware`. That's how every middleware that needs config should be authored — the factory carries the config, the returned function carries the request/response.

## Validation as built-in middleware

Validation isn't separate machinery — it's just the framework's last middleware step before the controller runs. When you attach `controller.validation = { schema }`, the framework runs the schema against `request.allExceptParams()` (or the segments you specify), sets `request.validatedData`, and only then calls the controller. If validation fails, it short-circuits with a 400 and an `errors` payload before the controller is ever invoked. See [Validation](./validation.md) for the full pattern.

## Ordering

The full order for a request that has it all:

1. **Fastify plugins** — CORS, body parser, multipart, cookies, rate-limit. Configured at boot.
2. **Group middleware**, outermost group first. Inside one group, array order.
3. **Route-level middleware**. By default after group middleware; flip with `middlewarePrecedence: "before"`.
4. **Validation** (if `controller.validation` is set).
5. **Controller**.

Any middleware can short-circuit by returning a response — everything after it is skipped.

## Gotchas

- **Don't `throw` for "user-facing" failures.** Use `return response.<helper>(...)`. Throwing escalates to the framework's 500 handler unless you throw an `HttpError` subclass — and even then, returning reads more naturally.
- **Async middleware must `await` its work.** A bare async middleware returning a promise that resolves to `undefined` is fine (continues the chain), but returning a promise that resolves to a response value also works — the framework awaits it.
- **Returning a plain object means "send this as the body".** If you accidentally `return { foo: "bar" }` from a middleware, the controller is skipped and `{ foo: "bar" }` is sent as a 200. Don't return from middleware unless you mean to short-circuit.
- **Middleware factories vs middleware functions.** A factory takes config and returns a middleware. A middleware is the function the router calls. `authMiddleware()` is a factory — `authMiddleware("user")` returns the middleware that the router wires up.
- **Group middleware composes; route middleware doesn't override.** A group sets `[A, B]`, a route adds `[C]` — you get `[A, B, C]` (with default precedence). If you want the route to skip group middleware entirely, declare the route outside the group.
- **`request.user` is set by the auth middleware, not the framework.** On routes outside a guarded group, `request.user` is `undefined`. Always narrow before reading it on public routes.

## See also

- **[Routing](./02-routing.md)** — where middleware attaches to URLs.
- **[Controllers](./03-controllers.md)** — what runs after middleware.
- **[Validation](./validation.md)** — the framework's built-in last-step middleware.
- **[HTTP request](./http-request.md)** — the surface a middleware reads from.
- **[HTTP response](./http-response.md)** — the surface a middleware writes to.
