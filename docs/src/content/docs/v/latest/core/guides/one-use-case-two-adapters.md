---
title: "One use-case, two adapters"
description: Write business logic once as a use-case, then call it from a page action (web form) and a controller (JSON API for mobile).
sidebar:
  order: 1
  label: "One use-case, two adapters"
---

A use-case is an async function that takes validated input and an actor, and returns a typed result. It never sees a request or a response. That makes it callable from any transport; each transport is a thin adapter that translates the result into its own output.

Scaffold one:

```bash
warlock generate.use-case orders/place-order
```

This writes `src/app/orders/use-cases/place-order.use-case.ts` and a sibling `place-order.use-case.spec.ts`. It refuses to overwrite either file unless you pass `--force`.

## Folder layout

```
src/app/orders/
├── schema/place-order.schema.ts
├── use-cases/
│   ├── place-order.use-case.ts
│   └── place-order.use-case.spec.ts
├── controllers/place-order.controller.ts   # JSON API (mobile)
├── pages/place-order.actions.ts            # web form
└── routes.ts
```

## The use-case

```ts title="use-cases/place-order.use-case.ts"
import type { PlaceOrderSchema } from "../schema/place-order.schema";

export type PlaceOrderResult =
  | { code: "OK"; orderId: string }
  | { code: "OUT_OF_STOCK" }
  | { code: "FORBIDDEN" };

export async function placeOrderUseCase(
  input: PlaceOrderSchema,
  actor: { id: string },
): Promise<PlaceOrderResult> {
  // business rules only: no cookies, no status codes, no redirects
  return { code: "OK", orderId: "o_1" };
}
```

## Adapter 1: the page action (web form)

Web-only glue, such as cookies and redirects, stays in the action.

```ts title="pages/place-order.actions.ts"
const result = await placeOrderUseCase(request.validated(), request.user);

if (result.code === "OK") {
  response.cookie("last_order", result.orderId);
  return response.redirect(`/orders/${result.orderId}`);
}

return response.badRequest({ error: result.code });
```

## Adapter 2: the controller (JSON API)

```ts title="controllers/place-order.controller.ts"
const result = await placeOrderUseCase(request.validated(), request.user);

switch (result.code) {
  case "OK":
    return response.success({ orderId: result.orderId });
  case "FORBIDDEN":
    return response.forbidden();
  default:
    return response.badRequest({ error: result.code });
}
```

Test the use-case once with vitest, without any HTTP setup. The adapters only need to test their own translation.
