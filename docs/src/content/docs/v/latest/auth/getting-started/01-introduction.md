---
title: "Introduction"
description: What @warlock.js/auth is, what it does for you, and when to reach for it.
sidebar:
  order: 1
  label: "Introduction"
---

`@warlock.js/auth` is the authentication layer for Warlock apps. It hands you:

- A `User` base model (`Auth`) that knows how to issue, verify, and revoke tokens.
- A drop-in route middleware (`authMiddleware`) that gates routes by user type.
- A service (`authService`) with the full login / logout / refresh flow.
- Persisted `AccessToken` + `RefreshToken` rows so JWT verification stays stateless but revocation stays stateful.
- Multi-user-type support — one app, several distinct user populations (users, admins, vendors, staff).
- Two bundled CLI commands — `warlock jwt.generate` to bootstrap secrets, `warlock auth.cleanup` to sweep expired refresh tokens.

> Requires `@warlock.js/core`. Auth is the one coupled package in the warlock family — it leans on core's HTTP layer, config, lifecycle, and CLI.

## When to reach for it

You're building a Warlock backend and you want any of:

- Email-and-password login that returns a JWT pair.
- A route gate that hydrates `request.user` from an `Authorization: Bearer ...` header.
- Refresh-token rotation with replay detection out of the box.
- Separate login flows for end-users vs admins, on different tables, in the same app.
- "Logout everywhere", active-session listing, or family-wide token revocation.

If you're outside Warlock — running a bare Node server, Next.js, Express — this package isn't for you. It assumes the framework's request/response, config layer, and Cascade models.

## The 15-second taste

The whole package, in miniature: gate a route, then read the logged-in user inside it.

```ts title="src/app/users/routes.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router, type Request, type Response } from "@warlock.js/core";

// `authMiddleware([])` = a valid token is required; any user type passes.
// Attach it via the route's `middleware` array (the third argument).
// On success the middleware has already hydrated `request.user` for you.
router.get(
  "/me",
  (request: Request, response: Response) => {
    const user = request.user!;

    return response.success({ id: user.id, email: user.get("email") });
  },
  { middleware: [authMiddleware([])] },
);
```

No token on the request? The middleware short-circuits with `401` before your handler runs — so inside the handler `request.user` is always there. That's the core loop. The rest of these docs is everything around it: issuing the token in the first place, refreshing it, revoking it, and gating by user type.

## What it does NOT do

- **Password reset emails.** The package emits a `password.resetRequested` event slot — you wire the email side yourself.
- **OAuth / social login.** Not in v1. Bring your own provider integration and call `authService.createTokenPair(user)` once you have the user.
- **MFA / TOTP.** Out of scope. Layer it as middleware in front of `authMiddleware`.
- **Permission / RBAC checks beyond user type.** `authMiddleware("admin")` gates by type. Finer-grained role checks live in your controllers or a separate guard layer.

## How the surface is organized

Five sections, narrow Diátaxis tree:

- **Getting started** — install, configure, and ship your first protected route in 5 minutes.
- **Essentials** — the auth flow end-to-end, how user models hook in, what tokens look like on disk.
- **Guides** — task-oriented how-tos (register, login, protect, refresh, customize, run CLI).
- **Recipes** — copy-paste snippets for cross-cutting patterns.
- **Reference** — the exact exported surface, signatures, source links.

Start with [Installation](./02-installation.mdx). If you'd rather see the whole shape first, read [The auth flow](../essentials/01-the-auth-flow.md).

## Related

- [Installation](./02-installation.mdx) — install + register CLI commands.
- [The auth flow](../essentials/01-the-auth-flow.md) — register, login, request, refresh, logout in one tour.
- [`@warlock.js/cascade`](../../../cascade/) — the ORM your user models extend.
