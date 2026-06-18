---
title: "Rate limiting"
description: Configure global rate limits, override per route, key by user instead of IP for authed traffic, localize the 429 response, and exempt trusted clients.
sidebar:
  order: 7
  label: "Rate limiting"
---

Your `/login` route is getting hammered, but `/health` isn't. Your authed customers should get a higher quota than anonymous IPs. Your monitoring server shouldn't count against anyone's bucket. This recipe walks the rate-limiting story Warlock ships with — project-wide defaults via `src/config/http.ts`, per-route overrides, plus a small custom middleware for the per-user-bucket case the framework's built-in surface doesn't cover.

:::tip Built-in `middleware.rateLimit()`
As of the HTTP middleware suite, `@warlock.js/core` ships a `middleware.rateLimit({ max, duration, keyGenerator })` factory that covers most of what the custom middleware in Step 3 below was for — including per-user keying via `keyGenerator: (request) => request.user?.id ?? request.ip`. The custom recipe still works (and is useful when you want cache-backed distributed limits), but for in-process per-route caps reach for the built-in first. See the [middleware guide](../the-basics/middleware.md#built-in-middleware) for the catalog.
:::

By the end you'll have sensible global limits, a tight cap on `/login`, a higher quota for authed users than anonymous, and a localized 429 response that tells the client when to come back.

## How rate limiting works in Warlock

The framework wraps `@fastify/rate-limit`. Two layers, in order:

```mermaid
flowchart LR
    request["incoming request"]
    plugin["@fastify/rate-limit<br/><i>global defaults from http.rateLimit</i>"]
    routeOverride["route-level rateLimit option<br/><i>tighter for /login etc.</i>"]
    handler["controller"]

    request --> plugin --> routeOverride --> handler
```

- **Plugin-level** (`src/config/http.ts → http.rateLimit`) — the default `max` and `duration` every route inherits. The plugin is registered once at boot.
- **Route-level** — each route can override via `RouteOptions.rateLimit` (`max`, `timeWindow`, `errorMessage`). The framework merges this into the per-route `config.rateLimit` block that fastify reads.

What the framework gives you out of the box: shared global limits + per-route overrides. What it doesn't give you out of the box: per-user keying or fully custom 429 bodies — those need a small middleware on top. We'll cover all three.

## Step 1 — Configure the global default

`src/config/http.ts` is auto-loaded at boot. The shape is exactly what the framework's `HttpConfigurations` interface expects:

```ts title="src/config/http.ts"
import type { HttpConfigurations } from "@warlock.js/core";
import { Application, env } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 3000),
  host: env("HTTP_HOST", "localhost"),
  log: true,
  rateLimit: {
    max: 260,
    duration: 60 * 1000, // 1 minute
  },
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  },
  cookies: {
    secret: env("COOKIE_SECRET", "change-me"),
    options: {
      httpOnly: true,
      secure: Application.isProduction,
      path: "/",
    },
  },
};

export default httpConfigurations;
```

That's the real default the reference project ships with — 260 requests per IP per minute. The two fields:

| Field      | Type     | What it means                                                      |
| ---------- | -------- | ------------------------------------------------------------------ |
| `max`      | `number` | Maximum requests allowed within the window                         |
| `duration` | `number` | Window length in **milliseconds** (60_000 = 1 minute)              |

The keying is by client IP by default — every IP gets its own bucket. When an IP exceeds `max` requests within `duration` ms, every subsequent request inside that window comes back as a `429 Too Many Requests` until the window resets.

### Picking sensible numbers

Some rules of thumb that survive contact with reality:

- **Public read endpoints: generous.** 200–500 per minute lets normal browsing work even with prefetch and double-fires. Below 100/min you'll get false positives from any user with a noisy network.
- **Auth endpoints: tight.** 5–10 attempts per minute is plenty for a real user with sticky fingers; anything higher and you're stress-testing your bcrypt hash, not your security.
- **Mutation endpoints: medium.** 30–60/min keeps drive-by abuse off without inconveniencing real form submitters.
- **Webhooks and integrations: high or unlimited.** They come from known IPs. Either give them their own much-higher bucket or exempt them entirely (see [Step 4](#step-4--bypass-for-trusted-clients)).

260/min as a global default in the reference project is a good ceiling — high enough that real users never hit it, low enough that an unauthenticated scraper does.

## Step 2 — Override per route

Tight limits on login. Looser ones on read-only public endpoints. The `RouteOptions.rateLimit` block sits next to the handler:

```ts title="src/app/auth/routes.ts"
import { router } from "@warlock.js/core";
import { loginController } from "./controllers/login.controller";
import { forgotPasswordController } from "./controllers/forgot-password.controller";
import { resetPasswordController } from "./controllers/reset-password.controller";

router.post("/auth/login", loginController, {
  rateLimit: {
    max: 5,
    timeWindow: 60 * 1000, // 1 minute
    errorMessage: "Too many login attempts. Try again in a minute.",
  },
});

router.post("/auth/forgot-password", forgotPasswordController, {
  rateLimit: {
    max: 3,
    timeWindow: 5 * 60 * 1000, // 3 attempts per 5 minutes
  },
});

router.post("/auth/reset-password", resetPasswordController, {
  rateLimit: {
    max: 5,
    timeWindow: 60 * 1000,
  },
});
```

The shape:

```ts
type RouteOptions = {
  // ...other fields
  rateLimit?: {
    max: number;
    timeWindow: number;
    errorMessage?: string;
  };
};
```

**`timeWindow` here, `duration` at the global level.** Yes, the field name differs — `duration` is the framework's convenience name in the global config; `timeWindow` is the fastify-plugin name preserved at the route level. Both are milliseconds. The naming mismatch is real; sorry.

`errorMessage` is the body the 429 returns when the route's limit is hit:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Too many login attempts. Try again in a minute."
}
```

When the per-route block exists, it replaces the global default for that route entirely — not a delta, a replacement.

### Loosening for a specific endpoint

Same mechanism for going *up*:

```ts
router.get("/health", healthController, {
  rateLimit: {
    max: 10000,
    timeWindow: 60 * 1000,
  },
});
```

Practically unlimited. Health checks from load balancers should never hit a real cap. The cleaner answer is to exempt the load balancer entirely — see [Step 4](#step-4--bypass-for-trusted-clients).

## Step 3 — Per-user keying

The framework's built-in rate-limit is per-IP. For authed traffic that's the wrong shape — five users sharing an office NAT all eat from the same bucket, while one shady user behind a clean IP gets the same allowance as the whole office.

Per-user keying needs a small custom middleware. The pattern: maintain an in-process bucket keyed by user id, increment on every request, return 429 when the bucket overflows.

```ts title="src/app/shared/middleware/user-rate-limit.middleware.ts"
import { t, type Middleware } from "@warlock.js/core";
import { cache } from "@warlock.js/cache";

type UserRateLimitOptions = {
  max: number;
  windowSeconds: number;
};

export function userRateLimit(options: UserRateLimitOptions): Middleware {
  return async (request, response) => {
    const userId = request.user?.id;

    if (!userId) {
      return;
    }

    const cacheKey = `ratelimit.user.${userId}.${request.route?.name ?? request.path}`;

    const count = (await cache.get<number>(cacheKey)) ?? 0;

    if (count >= options.max) {
      return response.setStatusCode(429).send({
        error: t("shared.rateLimited"),
        retryAfterSeconds: options.windowSeconds,
      });
    }

    await cache.set(cacheKey, count + 1, options.windowSeconds);
  };
}
```

What this does:

- Reads the current user from `request.user` (populated by `authMiddleware` from `@warlock.js/auth`).
- Builds a cache key per-user-per-route.
- Increments the count; rejects when it exceeds `max` within `windowSeconds`.
- Uses the cache singleton's TTL — the key auto-expires when the window closes.

Apply it on a route:

```ts title="src/app/messages/routes.ts"
import { router } from "@warlock.js/core";
import { authMiddleware } from "@warlock.js/auth";
import { userRateLimit } from "app/shared/middleware/user-rate-limit.middleware";
import { sendMessageController } from "./controllers/send-message.controller";

router.post("/messages", sendMessageController, {
  middleware: [
    authMiddleware(),
    userRateLimit({ max: 30, windowSeconds: 60 }),
  ],
});
```

Authed users get 30 messages/minute regardless of which IP they're on. The plugin-level IP limit still applies as a wider safety net — IP at 260/min, individual users at 30/min, whichever they hit first.

### Hybrid: stricter for anonymous, looser for authed

The two layers compose naturally — the global IP limit catches anonymous traffic at the higher cap; per-user middleware caps authed users at a more permissive rate:

```ts
router.post("/comments", postCommentController, {
  // Global IP rate-limit still applies (from src/config/http.ts) — 260/min default.
  middleware: [
    authMiddleware(),
    userRateLimit({ max: 60, windowSeconds: 60 }),
  ],
});
```

The unauthed pathway is constrained by the IP rate-limit (260/min); authed users are constrained by per-user middleware (60/min/user). Different abuse vectors handled differently.

## Step 4 — Bypass for trusted clients

Load balancers, monitoring agents, internal service-to-service calls — all of them are *known* clients that should never count against anyone's bucket. The cleanest pattern is a middleware-level short-circuit that runs *before* the rate limit kicks in.

For the IP-based plugin layer, you can't disable it per-request without forking the plugin registration. The practical workaround is to detect trusted IPs in your handler logic and skip the rate-limited routes for them:

```ts title="src/app/shared/middleware/trusted-bypass.middleware.ts"
import type { Middleware } from "@warlock.js/core";
import { env } from "@warlock.js/core";

const trustedIps = new Set(
  (env("TRUSTED_IPS", "") as string)
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
);

export const trustedBypass: Middleware = async (request) => {
  if (trustedIps.has(request.ip)) {
    // Mark the request so downstream middleware can see it.
    (request as any).isTrusted = true;
  }
};
```

Then check `request.isTrusted` in your custom rate-limit middleware:

```ts title="src/app/shared/middleware/user-rate-limit.middleware.ts (excerpt)"
export function userRateLimit(options: UserRateLimitOptions): Middleware {
  return async (request, response) => {
    if ((request as any).isTrusted) {
      return;
    }

    // ...the rest of the rate-limit logic
  };
}
```

For exempting from the fastify plugin-level rate limit, the cleanest path is route-level overrides — give monitoring endpoints an absurdly high `max`:

```ts
router.get("/metrics", metricsController, {
  rateLimit: { max: 1_000_000, timeWindow: 60_000 },
  middleware: [internalOnlyMiddleware],
});
```

Pair it with an `internalOnlyMiddleware` that rejects requests from outside the trusted-IP set, and the practical effect is "internal callers only, no rate limit; everyone else, 403".

### Role-based bypass

Admins shouldn't trip rate limits aimed at preventing abuse from normal users. After `authMiddleware()` has run, check the role:

```ts title="src/app/shared/middleware/user-rate-limit.middleware.ts (excerpt)"
export function userRateLimit(options: UserRateLimitOptions): Middleware {
  return async (request, response) => {
    const user = request.user;

    if (!user) {
      return;
    }

    if (user.get("role") === "admin") {
      return;
    }

    // ...rest of the rate-limit logic
  };
}
```

## Step 5 — Localize the 429 response

The route-level `errorMessage` is a plain string. To return localized errors, skip `errorMessage` and use a custom middleware:

```ts title="src/app/shared/middleware/rate-limit-localized.middleware.ts"
import { t, type Middleware } from "@warlock.js/core";
import { cache } from "@warlock.js/cache";

export function localizedIpRateLimit(max: number, windowSeconds: number): Middleware {
  return async (request, response) => {
    const cacheKey = `ratelimit.ip.${request.ip}.${request.route?.name ?? request.path}`;
    const count = (await cache.get<number>(cacheKey)) ?? 0;

    if (count >= max) {
      const retryAfter = windowSeconds;

      return response
        .header("Retry-After", String(retryAfter))
        .setStatusCode(429)
        .send({
          error: t("shared.rateLimited", { retryAfter }),
          retryAfterSeconds: retryAfter,
        });
    }

    await cache.set(cacheKey, count + 1, windowSeconds);
  };
}
```

Add the translation:

```ts title="src/app/shared/utils/locales.ts"
import { groupedTranslations } from "@mongez/localization";

groupedTranslations("shared", {
  rateLimited: {
    en: "Too many requests. Try again in {retryAfter} seconds.",
    ar: "عدد كبير من الطلبات. حاول مرة أخرى خلال {retryAfter} ثانية.",
  },
});
```

Use it on the route:

```ts
router.post("/auth/login", loginController, {
  middleware: [localizedIpRateLimit(5, 60)],
});
```

The 429 now carries a properly localized message and the `Retry-After` header — clients with retry logic can read the header and back off appropriately instead of guessing.

See the [Localized responses recipe](./localized-responses.md) for the broader translation story.

## The 429 response shape

The framework's plugin-level limiter returns the fastify-rate-limit default:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
X-RateLimit-Limit: 260
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 42
Retry-After: 60

{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Too many login attempts. Try again in a minute."
}
```

Three headers worth knowing:

| Header                | Meaning                                                 |
| --------------------- | ------------------------------------------------------- |
| `X-RateLimit-Limit`   | The `max` for this window                               |
| `X-RateLimit-Remaining` | How many requests are still allowed                   |
| `X-RateLimit-Reset`   | Seconds until the window resets                         |
| `Retry-After`         | Standard HTTP header — when to retry (seconds)          |

Tell your client developers to read `Retry-After` and back off accordingly. Pounding a 429 doesn't make it go away faster.

## Picking the right layer

Three layers, three jobs:

| Layer                          | Catches                                          | Cost                          |
| ------------------------------ | ------------------------------------------------ | ----------------------------- |
| **Global IP limit** (`http.rateLimit`) | Anonymous abuse, runaway scrapers        | One config line, zero runtime |
| **Per-route override** (`RouteOptions.rateLimit`) | Endpoint-specific abuse (login, signup) | One block per route           |
| **Custom user middleware**     | Authed abuse, per-user fairness                  | A small middleware            |

Don't try to do everything in one layer. The global IP limit catches scrapers; per-route overrides catch endpoint-specific abuse; custom user middleware caps individual authed users. They compose; each one solves a problem the others don't.

## Gotchas

- **`duration` (global) vs `timeWindow` (per-route).** Same unit (milliseconds), different field names. Mistakes here turn into "my rate limit isn't working" investigations.
- **The plugin's bucket is in-process by default.** Two workers = two independent IP buckets. Configure the plugin's `redis` option (requires extending the framework's `registerHttpPlugins` call) for distributed rate limiting, or rely on per-user middleware backed by the Redis cache driver.
- **`request.ip` honors `X-Forwarded-For` only if fastify's `trustProxy` is on.** Behind a load balancer without `trustProxy`, every IP looks like your LB's. Configure fastify's trust proxy settings; otherwise your "per-IP" limit becomes "per-load-balancer".
- **The route-level `errorMessage` is a fixed string.** No placeholders, no locale. Use a custom middleware (Step 5) when you need anything dynamic.
- **Per-user middleware needs `authMiddleware()` before it.** Without an authenticated `request.user`, your per-user limiter is a no-op. Order matters: auth, then rate limit.
- **Don't apply rate limits to `OPTIONS` preflights.** CORS preflights count against the user's bucket and aren't worth blocking. Either give them their own loose limit or skip them in your custom middleware.

## Going further

- **Writing middleware in general:** [Middleware guide](../the-basics/middleware.md)
- **Response helpers and headers:** [HTTP response guide](../the-basics/http-response.md)
- **Localizing error messages and translations:** [Localized responses recipe](./localized-responses.md)
