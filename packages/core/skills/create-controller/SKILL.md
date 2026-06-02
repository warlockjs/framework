---
name: create-controller
description: 'Author HTTP controllers in @warlock.js/core — RequestHandler signature, validated input via seal schemas, response helpers, attaching metadata. Controllers are thin functions; business logic moves to services or use-cases. Triggers: `RequestHandler`, `Request<TSchema>`, `GuardedRequestHandler`, `request.validated`, `request.input`, `controller.validation`, `response.success`, `response.successCreate`; "write a controller", "attach a schema to a handler", "thin controller pattern", "guarded request type"; typical import `import { type RequestHandler } from "@warlock.js/core"`. Skip: response helper menu — `@warlock.js/core/send-response/SKILL.md`; schema authoring — `@warlock.js/core/validate-input/SKILL.md`; URL wiring — `@warlock.js/core/register-route/SKILL.md`; competing patterns: `express` middleware functions, `@nestjs/common` `@Controller`/`@Get` decorators.'
---

# Warlock — create a controller

A controller is a thin function: pull inputs from `request`, call work, return through a `response.<helper>()`. No classes. No decorators. No DI.

## The shape

```ts title="src/app/<module>/controllers/<action>.controller.ts"
import { type RequestHandler } from "@warlock.js/core";

export const listProductsController: RequestHandler = async (request, response) => {
  return response.success({ products: [] });
};
```

That's the full contract. The `RequestHandler` annotation carries both parameter types — `request` and `response` infer automatically; you never annotate them by hand.

## File location and naming

- One controller per file.
- File: `src/app/<module>/controllers/<action>.controller.ts`.
- Export name matches the action in camelCase + `Controller` suffix: `listProductsController`, `createProductController`, `getProductController`.

Scaffold with: `yarn warlock generate.controller <module>/<action>` (add `--with-validation` to get the schema generated alongside).

## Reading input

| Method                            | Returns                                          | Use when                                            |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `request.input("key", default?)`  | one field                                        | reading a single param/body field by name           |
| `request.all()`                   | full input object                                | passing the whole input straight to a service       |
| `request.validated()`             | schema-typed object (only after schema attached) | controllers with a schema — preferred over `.all()` |
| `request.user`                    | authenticated user                               | guarded routes (see "Typing a guarded handler")     |
| `request.file("key")`             | `UploadedFile`                                   | multipart uploads                                   |
| `request.header("X-Foo")`         | header value                                     | reading request metadata                            |
| `request.ip`, `request.userAgent` | strings                                          | logging, device info                                |

Prefer `request.validated()` once a schema is attached — it's typed.

## Returning output

Pick the helper that matches the outcome. Full surface in [send-response](../send-response/SKILL.md). Quick map:

| Helper                             | Status | Use when                      |
| ---------------------------------- | ------ | ----------------------------- |
| `response.success(data)`           | 200    | normal read                   |
| `response.successCreate(data)`     | 201    | resource created              |
| `response.noContent()`             | 204    | delete succeeded              |
| `response.badRequest({ error })`   | 400    | invalid input                 |
| `response.unauthorized({ error })` | 401    | missing/invalid token         |
| `response.forbidden({ error })`    | 403    | authenticated but not allowed |
| `response.notFound({ error })`     | 404    | record missing                |
| `response.conflict({ error })`     | 409    | uniqueness / state            |

Always `return response.<helper>(...)` — the return value is the request's response.

## Attaching a validation schema

The schema is a property on the handler function, not a decorator. The handler's type generic carries the schema shape so `request.validated()` is typed end-to-end:

```ts title="src/app/products/controllers/create-product.controller.ts"
import { type Request, type RequestHandler } from "@warlock.js/core";
import { type CreateProductSchema, createProductSchema } from "../schema/create-product.schema";
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

Two pieces:

1. **`RequestHandler<Request<TSchema>>`** as the controller's annotation — types `request.validated()` and keeps `request`/`response` inferred. No separate `*.request.ts` alias file is needed; the schema's exported `TSchema` type is the single source of truth.
2. **`controller.validation = { schema }`** at module top level so the framework knows to validate before calling the handler.

If validation fails, the framework returns a 400 with an `errors` payload and your handler never runs.

### Typing a guarded handler

Routes behind `authMiddleware` need `request.user` typed. Project conventions add a `GuardedRequest<TSchema>` (adding `user: User`) and a paired `GuardedRequestHandler<TSchema>` alias in `app/auth/requests/guarded.request`:

```ts
import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { type CreateProductSchema, createProductSchema } from "../schema/create-product.schema";

export const createProductController: GuardedRequestHandler<CreateProductSchema> = async (
  request,
  response,
) => {
  // request.user is typed
  const product = await createProductService(request.validated());
  return response.successCreate({ product });
};

createProductController.validation = { schema: createProductSchema };
```

Use `RequestHandler<Request<TSchema>>` for public routes, `GuardedRequestHandler<TSchema>` for guarded ones. The `generate.controller`/`generate.module` scaffolds emit `GuardedRequestHandler` by default, since generated routes are wired behind `guarded(...)` — swap to `RequestHandler` when the endpoint is public.

## Optional metadata

```ts
createProductController.description = "Create a new product (admin only)";
```

Used by OpenAPI/Swagger generation (planned per `domains/core/backlog.md`) and surfaces in dev-server logs.

## What belongs in a controller (and what doesn't)

**Belongs:**

- Input pulling (`request.validated()` / `request.input(...)`)
- Calling exactly one service or use-case
- Returning the success path via `response.<helper>()`

Errors? Throw from the service. The framework catches every `HttpError` subclass and produces the matching response — controllers stay branch-free. See the next section.

**Doesn't belong:**

- Database queries (push to a repository, called by a service)
- Transactions (use-cases own them)
- External API calls (services)
- Cross-cutting orchestration of multiple services (use a `useCase()` — see `write-use-case` skill in Slice 2)
- Logging beyond what the framework does automatically

If your controller is over ~30 lines, the work probably belongs in a service.

## Common patterns

### Read

```ts
import { type RequestHandler } from "@warlock.js/core";
import { listProductsService } from "../services/list-products.service";

export const listProductsController: RequestHandler = async (request, response) => {
  const { data: products, pagination } = await listProductsService({
    ...request.all(),
    organization_id: request.user.organizationId,
  });

  return response.success({ products, pagination });
};
```

### Create

```ts
import { type Request, type RequestHandler } from "@warlock.js/core";
import { type CreateProductSchema, createProductSchema } from "../schema/create-product.schema";
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

### Service throws — controller stays branch-free

For HTTP-shaped errors (`404` not found, `403` forbidden, `400` bad request, `409` conflict, `500` server error), **throw from the service**. The request middleware (`http/middleware/inject-request-context.ts`) catches every `HttpError` subclass and produces the matching response. Controllers stay focused on the success path:

```ts title="src/app/products/services/get-product.service.ts"
import { ResourceNotFoundError } from "@warlock.js/core";
import { productsRepository } from "../repositories/products.repository";

export async function getProductService(id: string) {
  const product = await productsRepository.find(id);

  if (!product) {
    throw new ResourceNotFoundError("product.notFound");
  }

  return product;
}
```

```ts title="src/app/products/controllers/get-product.controller.ts"
import type { RequestHandler } from "@warlock.js/core";
import { getProductService } from "../services/get-product.service";

export const getProductController: RequestHandler = async (request, response) => {
  const product = await getProductService(request.input("id"));

  return response.success({ product });
};
```

No `if (!product)` branch in the controller. The error class carries the HTTP semantic (`404` for `ResourceNotFoundError`, `403` for `ForbiddenError`, `400` for `BadRequestError`, `409` for `ConflictError`, `500` for `ServerError`). Full list in [`send-response`](../send-response/SKILL.md#throwing-http-errors). `product.notFound` is a translation key — see localization conventions in your project's `utils/locales.ts`.

## Gotchas

- **DO throw HTTP-shaped errors from services.** `ResourceNotFoundError`, `ForbiddenError`, `BadRequestError`, etc. — the framework's request middleware (`http/middleware/inject-request-context.ts`) catches every `HttpError` subclass and produces the right response. Controllers stay clean of branching; only catch when you genuinely need to recover and continue.
- **Don't read `request.body` directly.** Use `request.all()` / `request.validated()` — they handle multipart, JSON, and form bodies uniformly.
- **Don't annotate `request`/`response` by hand.** They flow from the `RequestHandler<...>` generic. Adding `request: SomeRequest` separately re-introduces a contravariance error and defeats the inference.
- **Don't keep a `*.request.ts` alias file.** The schema's exported `TSchema` type plus `RequestHandler<Request<TSchema>>` (or `GuardedRequestHandler<TSchema>`) is the single source of truth. Separate request alias files drift from the schema and add an indirection that pays no rent.

## See also

- [`register-route/SKILL.md`](../register-route/SKILL.md) — wiring a controller to a URL.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — full Response helper surface.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — controller-service-repository layering.
