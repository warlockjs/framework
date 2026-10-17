---
title: safe-redirect
description: Require the redirect allowlist helper when a redirect, navigateTo() or Link target comes from request input.
sidebar:
  order: 3
---

**Recommended:** error · **Fix:** suggestion

A redirect target taken from the request is an open redirect: a link to your
login page can send the user to a look-alike site afterwards. A `javascript:`
target runs script on your origin. Pass request-controlled targets through the
allowlist helpers:

- server code: `safeRedirect(target, { allowedOrigins, fallback })` from
  `@warlock.js/core` — same-origin paths and allow-listed origins pass, anything
  else becomes the fallback (`"/"` by default);
- pages: `safeRedirectTarget(target)` from `@warlock.js/web` — same-origin
  paths pass, anything else is `undefined`.

The rule checks `response.redirect()`, `permanentRedirect()`, `redirect()`,
`navigateTo()`, and the `to`/`href` props of `<Link>` and `<NavLink>`. A value
counts as request input when it reads the request (`request.input()`,
`request.query.next`, …), a query-string hook (`useQueryString()`), a loader's
`query`/`searchParams`, or `location.search`/`location.hash` — directly or
through a local constant. A target checked by an enclosing
`if (isSafeRedirect(target))` is accepted.

## Incorrect

```ts
return response.redirect(request.input("next"));
```

```tsx
<Link to={useQueryString("next")}>Back</Link>
```

## Correct

```ts
import { safeRedirect } from "@warlock.js/core";

return response.redirect(
  safeRedirect(request.input("next"), { allowedOrigins: ["https://app.example.com"] }),
);
```

```tsx
import { Link, safeRedirectTarget, useQueryString } from "@warlock.js/web";

<Link to={safeRedirectTarget(useQueryString("next")) ?? "/"}>Back</Link>;
```

The suggestion wraps the target and adds the import.

## Options

`requestNames`, `redirectCalls`, `linkComponents`, `sanitizers` (helpers whose
result is trusted, default `["safeRedirect", "safeRedirectTarget"]`),
`validators` (predicates accepted in an enclosing `if`, default
`["isSafeRedirect", "isSafeRedirectUrl"]`) and `inputNames` (identifiers whose
members are client input, default `["query", "searchParams"]`).
