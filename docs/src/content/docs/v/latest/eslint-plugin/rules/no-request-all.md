---
title: no-request-all
description: Disallow passing request.all() to queries, services and inApp(); use request.validated().
sidebar:
  order: 1
---

**Recommended:** error · **Fix:** suggestion

`request.all()` returns every field the client sent. Passing it to a model
query, a service or `inApp()` lets a client set fields the endpoint never meant
to accept — `role`, `isAdmin`, `ownerId` — which is mass assignment.
`request.validated()` returns only what the route's validation schema accepted.

The rule reports `request.all()`, `request.allExceptParams()`, `request.heavy()`
and `request.heavyExceptParams()` when the result reaches a call's arguments,
directly, spread into an object, or through a local constant. Responses and log
calls are not reported here (logging input is
[`no-sensitive-log`](../no-sensitive-log/)'s job).

## Incorrect

```ts
await Post.create(request.all());
await createUserService({ ...request.all(), role: "user" });

const data = request.all();
await User.query().where(data).first();
```

## Correct

```ts
await Post.create(request.validated());
await createUserService({ ...request.validated(), role: "user" });
```

The suggestion replaces `all` with `validated`. It is not an autofix because a
handler without a validation schema gets `{}` from `request.validated()`:
declare the schema first.

## Options

```js
"@warlock.js/no-request-all": ["error", { requestNames: ["request", "req"] }]
```

`requestNames` — identifiers treated as the incoming request (default
`["request", "req"]`).
