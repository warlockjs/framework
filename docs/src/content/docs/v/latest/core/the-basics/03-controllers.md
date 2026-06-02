---
title: "Controllers"
description: The RequestHandler signature, reading inputs, returning through response helpers, attaching validation, and the thin-controller rule that keeps modules readable.
sidebar:
  order: 3
  label: "Controllers"
---

A controller in Warlock is a thin function. It pulls inputs from `request`, calls exactly one piece of work, and returns through a `response.<helper>()`. No class to extend, no decorators, no DI container.

The thin-controller rule is the most load-bearing convention in the framework. Once a controller starts owning logic, the module gets harder to test, harder to reuse from a queue worker, and harder to read. This page covers the shape, the reading surface, the returning surface, and how validation hooks in.

## The shape

```ts title="src/app/products/controllers/list-products.controller.ts"
import type { RequestHandler, Response } from "@warlock.js/core";

export const listProductsController: RequestHandler = async (request, response: Response) => {
  // …pull inputs, call work, return
  return response.success({ products: [] });
};
```

That's the contract:

- `RequestHandler` is the function type.
- `request` and `response` are the parameters.
- Annotate `response: Response` so editor completions surface every helper. Without it, intellisense can't tell you what `response.success(...)` accepts.

The export name follows `<action>Controller` in camelCase: `listProductsController`, `createProductController`, `getProductController`, `removeProductController`.

## Where it lives

One controller per file, under the module's `controllers/` folder:

```
src/app/products/controllers/
  list-products.controller.ts
  get-product.controller.ts
  create-product.controller.ts
  update-product.controller.ts
  remove-product.controller.ts
```

Scaffold with the CLI:

```bash
yarn warlock generate.controller products/list-products
# add --with-validation to scaffold the schema + request type alongside
yarn warlock generate.controller products/create-product --with-validation
```

## Reading input

The `Request` object exposes everything you need to pull data off the wire. The everyday helpers:

| Method                              | Returns                                          | Use when                                                       |
| ----------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `request.input("key", default?)`    | one field from query, params, or body            | reading a single param/body field                              |
| `request.all()`                     | full merged input map (query + body + params)    | passing the whole thing to a service                           |
| `request.validated()`               | schema-typed object (only when schema attached)  | controllers with validation — always preferred over `.all()`   |
| `request.user`                      | authenticated user (after `authMiddleware`)      | guarded routes                                                 |
| `request.file("key")`               | `UploadedFile` instance                          | multipart uploads (single file)                                |
| `request.files("key")`              | `UploadedFile[]`                                 | multipart uploads (many files)                                 |
| `request.header("X-Foo")`           | header value                                     | reading request metadata                                       |
| `request.ip`, `request.realIp`      | client IP (proxy-aware via `realIp`)             | logging, rate limiting, geolocation                            |
| `request.userAgent`                 | user-agent string                                | device-info capture                                            |
| `request.locale`, `request.t(...)`  | locale code + scoped translator                  | localized responses                                            |

There are also typed shortcuts: `request.int("id")`, `request.bool("active")`, `request.float("price")`, `request.string("name")`, `request.email()`. Use them when you want a coerced value without writing the conversion yourself.

### `validated()` vs `all()`

If the controller has a schema attached, **always** prefer `request.validated()`. It returns the schema-typed object, so TypeScript knows the shape and your editor autocompletes the fields:

```ts
import type { Request, RequestHandler } from "@warlock.js/core";
import { type CreateProductSchema } from "../schema/create-product.schema";

export const createProductController: RequestHandler<Request<CreateProductSchema>> = async (
  request,
  response,
) => {
  const data = request.validated();
  // data.name, data.price are typed
};
```

`request.all()` returns `any` and skips validation entirely. Reserve it for routes that truly take untyped input (admin debug endpoints, webhook receivers where the schema is the contract).

## Returning output

The `Response` object exposes a helper per HTTP outcome. The helper carries the status code, so you almost never set one by hand. Pick the helper that matches the outcome:

| Helper                              | Status | When                                  |
| ----------------------------------- | ------ | ------------------------------------- |
| `response.success(data)`            | 200    | normal read / update                  |
| `response.successCreate(data)`      | 201    | resource created (POST)               |
| `response.accepted(data?)`          | 202    | async work accepted but not yet done  |
| `response.noContent()`              | 204    | delete succeeded, no body needed      |
| `response.badRequest(data)`         | 400    | malformed or invalid input            |
| `response.unauthorized(data?)`      | 401    | missing/invalid token                 |
| `response.forbidden(data?)`         | 403    | authenticated but not allowed         |
| `response.notFound(data?)`          | 404    | record missing                        |
| `response.conflict(data?)`          | 409    | uniqueness violation, state conflict  |
| `response.unprocessableEntity(data)`| 422    | semantic validation error             |

Always `return response.<helper>(...)`. The return value drives the framework's send pipeline.

```ts
return response.success({ products, pagination });

return response.successCreate({ product });

return response.notFound({ error: t("product.notFound") });

return response.noContent();
```

For redirects, files, streams, and Server-Sent Events, see [HTTP response](./http-response.md).

## Attaching a validation schema

Validation in Warlock is two pieces: the schema (from `@warlock.js/seal`) and a property on the handler function.

### Step 1 — the schema

```ts title="src/app/products/schema/create-product.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const createProductSchema = v.object({
  name: v.string(),
  price: v.number().min(0),
  category_id: v.string(),
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

`Infer<typeof createProductSchema>` produces the static type from the runtime schema. The schema file exports **both** — value (`createProductSchema`) and type (`CreateProductSchema`) — from one place. No separate `*.request.ts` alias file.

### Step 2 — the controller

```ts title="src/app/products/controllers/create-product.controller.ts"
import type { Request, RequestHandler } from "@warlock.js/core";
import {
  type CreateProductSchema,
  createProductSchema,
} from "../schema/create-product.schema";
import { createProductService } from "../services/create-product.service";

export const createProductController: RequestHandler<Request<CreateProductSchema>> = async (
  request,
  response,
) => {
  const product = await createProductService(request.validated());

  return response.successCreate({ product });
};

createProductController.validation = {
  schema: createProductSchema,
};
```

The controller's `RequestHandler<Request<CreateProductSchema>>` annotation types `request.validated()` straight off the schema. For routes behind `authMiddleware`, use `GuardedRequestHandler<CreateProductSchema>` (from `app/auth/types/guarded-request.type`) so `request.user` is also typed.

`createProductController.validation = { schema }` is the wiring. The framework reads the property when registering the route. If validation fails, the framework returns a 400 with an `errors` payload and your handler **never runs**:

```json
{
  "errors": [
    { "input": "name", "error": "Name is required" },
    { "input": "price", "error": "Price must be at least 0" }
  ]
}
```

### What's validated by default

By default, the schema runs against the merged **body + query** (params are excluded — the route already validated them by matching the path). To include params or headers:

```ts
createProductController.validation = {
  schema: createProductSchema,
  validating: ["body", "query", "params"],
};
```

## A real example end-to-end

Here's the actual `login` controller from the reference codebase. Three input sources, one use-case, two response paths:

```ts title="src/app/auth/controllers/login.controller.ts"
import { t, type Request, type RequestHandler } from "@warlock.js/core";
import { type LoginSchema, loginSchema } from "../schema/login.schema";
import { loginUseCase } from "../use-cases/login.usecase";

export const login: RequestHandler<Request<LoginSchema>> = async (request, response) => {
  const result = await loginUseCase({
    data: request.validated(),
    deviceInfo: {
      userAgent: request.userAgent,
      ip: request.ip,
    },
  });

  if (!result) {
    return response.unauthorized({
      error: t("auth.invalidCredentials"),
    });
  }

  return response.success(result);
};

login.description = "User Login";

login.validation = {
  schema: loginSchema,
};
```

Read it top-to-bottom:

1. The controller is typed `RequestHandler<Request<LoginSchema>>` — schema and type come from one schema file. The schema is attached at the bottom.
2. It calls `loginUseCase` with the validated credentials + device metadata from the headers.
3. If the use-case returns nothing, the controller maps that to a 401 with a translated error.
4. Otherwise it sends the result through `response.success(...)`.
5. The `.description` property feeds documentation generation.

Twenty-five lines, no business logic. The credential check, token issuance, and session creation all live in `loginUseCase` and its service — the controller is just the HTTP shell.

## Optional handler metadata

Three properties you can attach to a handler:

```ts
createProductController.validation = { schema: createProductSchema };
createProductController.description = "Create a new product (admin only)";
createProductController.responseSchema = {
  201: { body: { product: ProductResource } },
  400: { body: { errors: "array" } },
};
```

- **`validation`** — what's covered above.
- **`description`** — surfaces in dev-server logs and feeds OpenAPI / Swagger generation (planned per `domains/core/backlog.md`).
- **`responseSchema`** — declares the response shape per status code, also for docs generation.

## What belongs in a controller (and what doesn't)

**Belongs:**

- Input pulling (`request.validated()` / `request.input(...)`)
- Calling exactly one service or use-case
- HTTP-shaped error branching (`if (!product) return response.notFound(...)`)
- Returning via `response.<helper>()`

**Doesn't belong:**

- Database queries → push to a repository, called by a service
- Transactions → use-cases own them
- External API calls → services
- Cross-cutting orchestration of multiple services → use a use-case
- Logging beyond what the framework does automatically

A controller that's longer than ~30 lines usually has work hiding inside it. Extract a service.

## Gotchas

- **Don't `throw` for HTTP-shaped errors.** Use `response.<helper>()`. Throwing escalates to the framework's 500 handler unless you throw an `HttpError` subclass (`BadRequestError`, `ForbiddenError`, `ResourceNotFoundError`, …) — and even then, `response.<helper>()` reads more naturally.
- **Don't read `request.body` directly.** Use `request.all()` / `request.validated()` — they handle multipart, JSON, and form bodies uniformly.
- **Don't forget `: Response`** on the parameter — without it, autocomplete can't see the helpers and you'll think they don't exist.
- **The `validation` property is on the handler, not the route.** A common slip-up is setting it on the result of `router.get(...)`. The property goes on the controller function itself.

## See also

- **[Use-cases](./04-use-cases.md)** — the structured pipeline a controller hands off to.
- **[Routing](./02-routing.md)** — how the controller gets wired to a URL.
- **[HTTP request](./http-request.md)** — the full Request surface (cookies, files, headers, locale).
- **[HTTP response](./http-response.md)** — the full Response surface (redirects, files, streams, SSE).
- **[Validation](./validation.md)** — schema patterns, custom validators, conditional rules.

## Next

Continue to **[Use-cases](./04-use-cases.md)** to see the structured pipeline the controller calls into.
