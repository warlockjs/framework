---
title: "Login with providers, passkeys, or a phone code"
description: Passwordless login — Google, GitHub, Discord, LinkedIn, Apple, Facebook and X sign-in, WebAuthn passkeys, and phone OTP — every method ends in the same authService.completeLogin outcome as password login.
sidebar:
  order: 8
  label: "Login with providers"
---

Services only, like password login: `@warlock.js/auth` ships no routes. Every
method below ends in `authService.completeLogin(user, deviceInfo?)`, which
returns the same `LoginResult` as `authService.login` — apply `auth.canAuthenticate`
(403 on refusal), issue tokens, and hand back to the app the same way:

```ts
const { user, tokens } = await completeProviderLogin(User, "google", request, response);
authService.setAuthCookie(response, tokens.accessToken); // or return tokens as JSON
```

## Install

| Method | Command | Installs |
| --- | --- | --- |
| Google | `warlock add auth-google` | `jose` |
| Apple, LinkedIn | `warlock add auth-google` (or `npm install jose`). There is no separate `auth-apple` or `auth-linkedin` feature yet. | `jose` |
| GitHub, Discord, Facebook, X | nothing. These use plain OAuth 2 over `fetch`. | nothing |
| Passkeys | `warlock add auth-passkeys` | `@simplewebauthn/server` (add `@simplewebauthn/browser` to your client bundle) |
| Phone code | `warlock add notifications` + your own `sms`/`whatsapp` channel | nothing else — auth ships no SMS/WhatsApp driver |

Each SDK is an optional peer, loaded with `import()` only when that method
runs. A missing SDK throws `AuthProviderSdkMissingError` (500) naming the
`warlock add` command to run. For Apple and LinkedIn that message names
`auth-apple` or `auth-linkedin`, which do not exist: install `jose` with
`warlock add auth-google` or `npm install jose` instead. Run migrations after installing: `authMigrations`
now includes `provider_accounts` and `passkey_credentials`, and
`one_time_tokens` gained an `attempts` column.

## Google

```ts title="src/config/auth.ts"
providers: {
  google: {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${env("APP_URL")}/auth/google/callback`, // exactly as registered at Google
    // scopes: ["openid", "email", "profile"],
  },
  // emailField: "email",
  // createUser: async (profile, Model) => Model.create({ ... }),
},
```

```ts title="src/app/users/routes.ts"
import { completeProviderLogin, startProviderLogin } from "@warlock.js/auth";

router.get("/auth/google", async ({ response }) =>
  response.redirect(await startProviderLogin(response, "google")),
);

router.get("/auth/google/callback", async ({ request, response }) => {
  const { tokens } = await completeProviderLogin(User, "google", request, response);
  authService.setAuthCookie(response, tokens.accessToken);
  return response.redirect("/");
});
```

The button is a plain link — it must be a top-level navigation, not a
`fetch`, so the state cookie goes out and comes back:

```tsx
<a href="/auth/google">Continue with Google</a>
```

- `state`, `nonce`, and the PKCE verifier live in a signed, 10-minute,
  HttpOnly `auth_provider_state` cookie (`SameSite=Lax`, so it survives
  Google's redirect back). The callback clears the cookie, so a started login
  can complete only once.
- The callback throws `InvalidProviderCallbackError` (400, `EC009`) for a
  missing, forged, or expired cookie; a `state` mismatch; a `?error=` from
  Google; a failed code exchange; or an id_token with a bad signature,
  `iss`, `aud`, `exp`, or `nonce`. The response message stays generic;
  `error.reason` says which.
- **Linking.** An existing `provider_accounts` row (provider + Google `sub`)
  always decides the user. Without one, the Google email must be verified
  (`email_verified: true`), or the call throws `ProviderEmailNotVerifiedError`
  (403, `EC010`) and nothing is linked or created. A verified email links the
  matching user by `auth.providers.emailField`, or creates one with
  `{ email, name, emailVerifiedAt: now }`.
- For another OIDC provider, implement `AuthProvider`
  (`authorizationUrl(state)`, `handleCallback({ query, expected })`) and
  register it under `auth.providers.custom.<name>`.

## GitHub, Discord, LinkedIn, Facebook, X

These providers work the same way as Google. Add a config block under
`auth.providers.<name>`, a GET route that redirects to
`startProviderLogin(response, "<name>")`, and a GET callback that calls
`completeProviderLogin(User, "<name>", request, response)`. The state cookie,
the rejections (`EC009`), and the linking rules (`EC010`) are the same too.

```ts title="src/config/auth.ts"
providers: {
  github: {
    clientId: env("GITHUB_CLIENT_ID"),
    clientSecret: env("GITHUB_CLIENT_SECRET"),
    redirectUri: `${env("APP_URL")}/auth/github/callback`,
    // scopes: ["read:user", "user:email"],
  },
  discord: {
    clientId: env("DISCORD_CLIENT_ID"),
    clientSecret: env("DISCORD_CLIENT_SECRET"),
    redirectUri: `${env("APP_URL")}/auth/discord/callback`,
    // scopes: ["identify", "email"],
  },
  linkedin: {
    clientId: env("LINKEDIN_CLIENT_ID"),
    clientSecret: env("LINKEDIN_CLIENT_SECRET"),
    redirectUri: `${env("APP_URL")}/auth/linkedin/callback`,
    // scopes: ["openid", "profile", "email"],
  },
  facebook: {
    clientId: env("FACEBOOK_CLIENT_ID"),
    clientSecret: env("FACEBOOK_CLIENT_SECRET"),
    redirectUri: `${env("APP_URL")}/auth/facebook/callback`,
    // scopes: ["email", "public_profile"],
  },
  x: {
    clientId: env("X_CLIENT_ID"),
    clientSecret: env("X_CLIENT_SECRET"),
    redirectUri: `${env("APP_URL")}/auth/x/callback`,
    // scopes: ["tweet.read", "users.read"],
  },
},
```

```ts title="src/app/users/routes.ts"
import { completeProviderLogin, startProviderLogin } from "@warlock.js/auth";

for (const provider of ["github", "discord", "linkedin", "facebook", "x"]) {
  router.get(`/auth/${provider}`, async ({ response }) =>
    response.redirect(await startProviderLogin(response, provider)),
  );

  router.get(`/auth/${provider}/callback`, async ({ request, response }) => {
    const { tokens } = await completeProviderLogin(User, provider, request, response);
    authService.setAuthCookie(response, tokens.accessToken);
    return response.redirect("/");
  });
}
```

| Provider | Protocol | Where the email comes from |
| --- | --- | --- |
| GitHub | OAuth 2 + PKCE | `/user/emails`, because `/user.email` is `null` unless the user made it public. Only an address that is both **primary and verified** is used. Otherwise the profile has no email. |
| Discord | OAuth 2 + PKCE | `/users/@me`. The email counts as verified only when Discord's `verified` flag is `true`. |
| LinkedIn | OpenID Connect + PKCE | The id_token, checked with `jose` against LinkedIn's JWKS (signature, issuer, audience, expiry, nonce). `email_verified` must be the boolean `true`. |
| Facebook | OAuth 2 | Graph `/me?fields=id,name,email,picture`. Facebook returns only confirmed addresses, so an email that is present counts as verified. Without the `email` permission, the profile has no email. |
| X | OAuth 2 + PKCE, with HTTP Basic client auth at the token endpoint | **None.** `/2/users/me` never returns an email. |

A profile with no verified email can log in only through an existing
`provider_accounts` link. Otherwise it is rejected with
`ProviderEmailNotVerifiedError`, and auth never makes up an address. On X,
this applies to every first login, so create the link another way before the
first X login.

Provider names are looked up only by the object's own keys. An inherited key
such as `toString` never resolves to a provider.

## Apple

```ts title="src/config/auth.ts"
providers: {
  apple: {
    clientId: env("APPLE_CLIENT_ID"), // the Services ID
    teamId: env("APPLE_TEAM_ID"),
    keyId: env("APPLE_KEY_ID"),
    privateKey: env("APPLE_PRIVATE_KEY"), // the .p8 file's PKCS8 PEM contents
    redirectUri: `${env("APP_URL")}/auth/apple/callback`,
    // scopes: ["name", "email"],
  },
},
```

```ts title="src/app/users/routes.ts"
router.get("/auth/apple", async ({ response }) =>
  response.redirect(await startProviderLogin(response, "apple")),
);

// Apple POSTs the callback (response_mode=form_post) when name/email scopes are requested.
router.post("/auth/apple/callback", async ({ request, response }) => {
  const { tokens } = await completeProviderLogin(User, "apple", request, response);
  authService.setAuthCookie(response, tokens.accessToken);
  return response.redirect("/");
});
```

- **The callback is a POST.** Apple sends `code`, `state`, and `user` as an
  `application/x-www-form-urlencoded` body. Core parses that body type, so
  `request.input()` reads the values. See
  [HTTP request](/v/latest/core/the-basics/http-request/#body-content-types).
- **The state cookie needs HTTPS.** A cross-site POST drops a `SameSite=Lax`
  cookie. So for Apple, the state cookie is written `SameSite=None; Secure`.
  Apple requires HTTPS in production anyway. For local development, use
  `https://` or `http://localhost`, which browsers treat as secure.
- Apple has no static client secret. On every callback, auth signs a new
  ES256 JWT with your `.p8` key: `iss` is the team ID, `sub` is the client ID,
  `aud` is Apple, and `kid` is the key ID.
- Apple sends the account name only on the **first** authorization, as a
  `user` form field (`{"name":{"firstName","lastName"}}`). Save it then,
  because later logins don't include it.
- The email may be a private-relay address (`@privaterelay.appleid.com`). It
  is a real, working address and is accepted like any other.
- Rejections and linking work the same way as for Google.

## Passkeys

```ts title="src/config/auth.ts"
passkeys: { rpID: "example.com", rpName: "Example", origin: "https://example.com" },
```

```ts title="src/app/users/routes.ts"
import {
  generatePasskeyAuthenticationOptions,
  generatePasskeyRegistrationOptions,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "@warlock.js/auth";
import { authMiddleware } from "@warlock.js/auth";

// Register (logged in)
router.post(
  "/auth/passkeys/register/options",
  async ({ request, response }) =>
    response.success(await generatePasskeyRegistrationOptions(request.locals.user)),
  { middleware: [authMiddleware("user")] },
);
router.post(
  "/auth/passkeys/register",
  async ({ request, response }) => {
    await verifyPasskeyRegistration(request, request.locals.user, request.input("credential"));
    return response.success({ registered: true });
  },
  { middleware: [authMiddleware("user")] },
);

// Log in
router.post("/auth/passkeys/login/options", async ({ response }) =>
  response.success(await generatePasskeyAuthenticationOptions()),
);
router.post("/auth/passkeys/login", async ({ request, response }) => {
  const { tokens } = await verifyPasskeyAuthentication(request, request.input("credential"));
  authService.setAuthCookie(response, tokens.accessToken);
  return response.success({ ok: true });
});
```

Browser side, with `@simplewebauthn/browser`:

```ts
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

// register
const regOptions = await post("/auth/passkeys/register/options");
await post("/auth/passkeys/register", { credential: await startRegistration({ optionsJSON: regOptions }) });

// log in
const authOptions = await post("/auth/passkeys/login/options");
await post("/auth/passkeys/login", { credential: await startAuthentication({ optionsJSON: authOptions }) });
```

- Challenges live in `one_time_tokens` as SHA-256 hashes, expire after 5
  minutes (`auth.passkeys.challengeExpiresIn`), and are **consumed before
  verification** — a replayed challenge fails, and so does one whose first
  verification failed.
- The request `Origin` must be one of `auth.passkeys.origin`. The same list is
  checked against the signed `clientDataJSON`.
- The signature counter must advance; one that did not move past the stored
  value (when either is non-zero) is rejected as a cloned authenticator. The
  new counter is saved with a compare-and-set.
- Every rejection throws `InvalidPasskeyError` (400, `EC011`) with a `reason`.

## Phone code (OTP)

```ts title="src/config/auth.ts"
otp: { channel: "sms" /* or "whatsapp" */, phoneField: "phone", expiresIn: "5m", maxAttempts: 5 },
```

```ts title="src/app/users/routes.ts"
import { otpRequestThrottleMiddleware, otpVerifyThrottleMiddleware, requestOtp, verifyOtp } from "@warlock.js/auth";

router.post(
  "/auth/otp/request",
  async ({ request, response }) => {
    await requestOtp(User, request.input("phone"), {
      channel: request.input("via") === "whatsapp" ? "whatsapp" : "sms",
    });
    return response.success({ message: "If that number is registered, a code is on its way." });
  },
  { middleware: [otpRequestThrottleMiddleware()] }, // 3 / 1h per phone + IP
);

router.post(
  "/auth/otp/verify",
  async ({ request, response }) => {
    const { tokens } = await verifyOtp(User, request.input("phone"), request.input("code"));
    authService.setAuthCookie(response, tokens.accessToken);
    return response.success({ ok: true });
  },
  { middleware: [otpVerifyThrottleMiddleware()] }, // 5 failures / 15m per phone + IP
);
```

- Codes are 6 digits, stored in `one_time_tokens` (purpose `otp`) as a salted
  HMAC keyed from your access-token secret — never plain SHA-256, which is
  trivially reversible for 6 digits. A new request invalidates the previous
  code.
- Every verify counts an attempt atomically first. After `maxAttempts` the
  code is invalidated even if the right code comes next, and even under
  concurrent guesses.
- Delivery: `notify.channel(channel).send(phone, { body, code, expiresAt })`.
  Register that channel in `config/notifications.ts`, or set
  `auth.otp.send(phone, message, channel)`. `auth.otp.message(code)` changes
  the text. Auth ships no SMS/WhatsApp driver.
- **Anti-enumeration:** an unknown phone gets the same `requestOtp` result
  (nothing sent) and the same `InvalidOneTimeTokenError` (400, `EC008`) from
  `verifyOtp`.
- `verifyOtp` is a POST — the [CSRF Origin
  check](./protect-routes.md#csrf-origin-check-for-cookie-auth) applies when
  the route is cookie-authenticated; otherwise there is no ambient credential
  to ride.

## Gotchas

- `completeProviderLogin` needs the **same** response object used by
  `startProviderLogin`, to clear the state cookie.
- One provider identity links to one account, of one user type.
- `auth.cleanup` hard-deletes expired and consumed `one_time_tokens` rows —
  challenges and codes included.
- A counter the SDK itself rejects is reported with
  `reason: "counter-regression"`, the same as auth's own check.

## Related

- [Handle login and logout](./handle-login-and-logout.md) — password login,
  `setAuthCookie`, and the shared token/cookie surface every method here ends
  through.
- [Protect routes](./protect-routes.md) — the CSRF Origin check for
  cookie-authenticated routes.
