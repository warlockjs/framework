---
description: 'JWT authentication for Warlock apps: login/logout, refresh-token rotation, protected routes, multiple user types. Exports `Auth`, `authService`, `authMiddleware`, `authEvents`, `currentUser`, `loginThrottleMiddleware`, `requireVerifiedEmail`, `GoogleProvider`, `AuthErrorCodes`. Use for: "log a user in and issue tokens", "protect this route", "add an admin user type", "rate-limit login attempts", "verify email / reset password", "sign in with Google". Not this package: general route middleware lives in @warlock.js/core; request-body validation is @warlock.js/seal.'
---

# @warlock.js/auth

A user model extends the `Auth` base model and declares a `userType`. `authService.login(Model, credentials)` verifies the password and issues persisted access + refresh tokens; `authMiddleware("user")` gates routes per type. Refresh tokens rotate within a token family, with replay detection. Server-only, and requires `@warlock.js/core`.

## The 80% path

1. Start with `auth-basics.md` for the shape of config and models.
2. Extend `Auth` for your user model: `customize-user-type.md`, `register-user.md`.
3. Log in / out: `handle-login-and-logout.md`; token lifecycle: `manage-tokens.md`.
4. Guard routes: `protect-routes.md`.
5. Harden: `throttle-login-attempts.md`, `verify-email-and-reset-password.md`.
6. Social sign-in: `login-with-providers.md`; CLI (JWT secret, token cleanup): `run-auth-commands.md`.

## Conventions and pitfalls

- Tokens are persisted rows, not stateless JWTs alone; revoking a family invalidates its refresh and access rows.
- `authMiddleware()` with no argument resolves the configured default user type. Be explicit when an app has several.
- Not for session-cookie auth; this is JWT-based.
- Do not value-import this package from client code; `@warlock.js/web` builds refuse it (type-only imports are fine).
- Generate the JWT secret with the bundled command rather than inventing one.
- Custom token storage is a supported extension point: `customize-token-storage.md`.

## When to reach for it

- You're building a Warlock app that needs login, protected routes, and token-based sessions.
- You need **multiple user types** (admins + regular users, or client/vendor/staff personas) gated separately on the same auth system.
- You want refresh-token **rotation + replay detection** out of the box rather than hand-rolling token security.

Skip if you're not on `@warlock.js/core` (the package depends on it), or if you need session-cookie auth rather than JWTs.

## The mental model in one paragraph

Your user model extends the `Auth` base model and declares its `userType`. A login flows through `authService.login(Model, credentials, deviceInfo?)`: it verifies the password, issues a persisted access + refresh pair, and fires events. `authMiddleware("user")` is a typed hard gate; `authMiddleware()` resolves the configured default type; the object form selects header/cookie credentials, `optional`, and a page-local redirect. Refresh rotation uses a durable token family: family revocation invalidates its refresh and associated access rows. CLI commands generate the JWT secret and clean up expired tokens.

## What this package deliberately doesn't do

- **Session-cookie auth.** It's JWT/token-based. If you need server-side sessions, this isn't it.
- **OAuth / social login / SSO.** No provider adapters here — wire those at the controller layer and create the user through this package's models.
- **Authorization / roles / permissions (RBAC).** It authenticates (who you are) and gates by user _type_, not fine-grained permissions. Build RBAC on top.
- **Standalone use.** It depends on `@warlock.js/core` for routing, models (Cascade), and config.

## See also

- The `warlock-conventions` topic of the `warlock-js-core` skill — the framework auth runs inside (routing, middleware, config).
- The `cascade-basics` topic of the `warlock-js-cascade` skill — the ORM behind the `Auth`, `AccessToken`, and `RefreshToken` models.
