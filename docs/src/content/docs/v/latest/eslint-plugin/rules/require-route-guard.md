---
title: require-route-guard
description: Require auth middleware or an explicit public true on POST, PUT, PATCH and DELETE routes.
sidebar:
  order: 2
---

**Recommended:** error · **Fix:** suggestion

A mutating route must say who may call it. The rule accepts a
POST/PUT/PATCH/DELETE route when any of these holds:

- its options have auth middleware: `{ middleware: [authMiddleware()] }`;
- it is built from `router.route(path, { middleware: [...] })`;
- it is registered inside `router.group({ middleware: [authMiddleware()] }, …)`;
- it is registered inside a guard wrapper such as `guarded(() => …)`;
- it, its route builder or its group says `public: true`.

Middleware counts as an auth guard when its name contains `auth` or `guard`, or
is listed in `guardMiddleware`. An options value the rule cannot see into (a
variable, a spread) is trusted.

Checked calls: `router.post/put/patch/delete`, `router.add("POST", …)`,
`router.restfulResource()` (unless `only` lists read methods), and the
mutating route-builder methods (`create`, `update`, `destroy`, `post`, `put`,
`patch`, `delete`, `postOne`, `updateOne`, `patchOne`, `deleteOne`).

`warlock dev` prints the same warning at runtime when a mutating route has no
auth middleware and no `public: true`. See
[Routing → Public routes](/v/latest/core/the-basics/routing/#public-mutating-routes).

## Incorrect

```ts
router.post("/posts", createPostController);
router.route("/posts").create(createPostController);
router.group({ middleware: [cors()] }, () => {
  router.delete("/posts/:id", deletePostController);
});
```

## Correct

```ts
router.post("/posts", createPostController, { middleware: [authMiddleware("user")] });

guarded(() => {
  router.route("/posts").create(createPostController);
});

router.post("/auth/login", loginController, { public: true });
router.group({ prefix: "/webhooks", public: true }, () => {
  router.post("/stripe", stripeWebhookController);
});
```

The suggestion adds `public: true`. It is never applied automatically: only
you know whether the endpoint is meant to be open.

## Options

```js
"@warlock.js/require-route-guard": [
  "error",
  { routerNames: ["router"], guardFunctions: ["guarded"], guardMiddleware: ["authMiddleware"] },
]
```

- `routerNames` — identifiers that are the router (default `["router"]`).
- `guardFunctions` — wrappers whose callback routes are guarded (default `["guarded"]`).
- `guardMiddleware` — extra middleware names that count as guards (default
  `["authMiddleware"]`, in addition to any name containing `auth` or `guard`).
