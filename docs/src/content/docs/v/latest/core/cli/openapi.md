---
title: "warlock generate.openapi"
description: Generate an OpenAPI 3.1 document from your registered routes — paths, parameters, request bodies from Seal validation, responses from responseSchema, 401/422 and bearer/cookie security. Options, what is and is not documented, the live API docs page in devtools, and importing the file into Postman or Insomnia.
sidebar:
  order: 7
  label: "warlock generate.openapi"
---

`warlock generate.openapi` writes an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) JSON document describing your API. Nothing is annotated by hand: the document is derived from what your app already declares — the route table, each handler's `validation`, `description` and `responseSchema`, and the auth middleware on the route.

```bash
warlock generate.openapi
```

```
OpenAPI 3.1.0 written to /your/app/storage/openapi/openapi.json (12 paths, 17 operations).
```

Like [`warlock routes`](./routes.md), it loads your route modules in an isolated child process — the same one `warlock build` uses — so **no connector starts** (no database, cache or socket connection) and a running dev server is untouched. If the app cannot be loaded, the command fails. Gaps in a single route never fail it; they are printed as warnings after the summary. The child honours `WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS`.

## Options

| Option            | Default                                       | Description                                                                                                                                   |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--out, -o`       | `storage/openapi/openapi.json`                | Output file, relative to the project root. Missing folders are created.                                                                        |
| `--title`         | `name` in `package.json` (else `Warlock API`) | `info.title`. `info.version` is the `package.json` `version` (else `0.0.0`) and `info.description` its `description`.                          |
| `--server`        | `http://<host>:<port>` from the `http` config | `servers[0].url`. A wildcard bind address (`0.0.0.0`, `::`) is written as `localhost`.                                                        |
| `--include-pages` | off                                           | Also document page (SSR) routes. Each one is a `200` with a `text/html` body.                                                                  |

```bash
warlock generate.openapi --out docs/openapi.json --title "Shop API" --server https://api.shop.test
```

## Declare what you want documented

A handler that already has a schema and a description is most of the way there. Add `responseSchema` to describe what it sends back:

```ts title="src/app/products/controllers/create-product.controller.ts"
import type { Request, RequestHandler } from "@warlock.js/core";
import { ProductResource } from "app/products/resources/product.resource";
import { type CreateProductSchema, createProductSchema } from "../schema/create-product.schema";
import { createProductUseCase } from "../use-cases/create-product.usecase";

export const createProduct: RequestHandler<Request<CreateProductSchema>> = async ({
  request,
  response,
}) => {
  const product = await createProductUseCase(request.validated());

  return response.successCreate({ product });
};

createProduct.description = "Create a product";

createProduct.validation = {
  schema: createProductSchema,
};

createProduct.responseSchema = {
  201: { body: { product: ProductResource } },
};
```

```ts title="src/app/products/routes.ts"
import { router } from "@warlock.js/core";
import { authMiddleware } from "@warlock.js/auth";
import { createProduct } from "./controllers/create-product.controller";

router.post("/products", createProduct, {
  name: "products.create",
  middleware: [authMiddleware()],
});
```

`POST /products` now appears with its request body (from `createProductSchema`), a `201` response that references `ProductResource`, a `422` for failed validation, a `401`, and a bearer security requirement.

The grammar of a `responseSchema` body — cast strings with suffixes, a resource, `[Resource]`, nested objects — is covered in [Controllers](../the-basics/03-controllers.md#declare-response-types-with-responseschema). The same declaration also types the client; see [Typed API responses](/v/latest/web/essentials/14-form-submission/#typed-api-responses).

## What is documented

| Part                  | Where it comes from                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paths                 | Every registered route. `:id` becomes `{id}`. An `all` route expands into one operation per verb (get, post, put, patch, delete, options, head).                                                  |
| `operationId`         | The route `name` (`name.<verb>` when an `all` route expands), otherwise `<verb>_<path_slug>` such as `get_users_id`. A duplicate is renamed with a warning.                                       |
| Tags                  | The first static path segment: `/users/:id` is tagged `users`.                                                                                                                                   |
| Summary, description  | The route `label` is the summary. The route or handler `description` is the description, followed by a line about the required user types and, for cookie auth on unsafe verbs, the same-origin CSRF rule. |
| Path parameters       | `validation.params` gives typed ones. A path segment with no schema is a required `string`.                                                                                                       |
| Request body, query   | `validation.schema`, converted with the Seal schema's JSON Schema output. It becomes the JSON request body for POST/PUT/PATCH and query parameters for GET/HEAD/DELETE, following `validating` the way validation reads the request. |
| Responses             | `handler.responseSchema`, one response per declared status code. A route with no 2xx declared gets a `200` with the description "Successful response".                                            |
| `422`                 | Added when the route has `validation.schema`. Its body follows `validation.response` (`errors`, `inputKey`, `inputError` and `status`; core's default status is 422) and is stored once as `ValidationFailed`. A route with only `validation.params` gets none. |
| `401`                 | Added when the route is guarded, with the conventional `{ error: string }` body, stored once as `Unauthorized`. A status you declare yourself is kept.                                            |
| Security schemes      | From `authMiddleware()`, see below.                                                                                                                                                              |

### Responses

`responseSchema` values map to JSON Schema like this:

- A cast string: `string` and `localized` are `string`; `url`, `uploadsUrl` and `storageUrl` are `string` with `format: uri`; `number` and `float` are `number`; `int` is `integer`; `boolean`, `object` and `array` map directly; `date` is the default date object (`iso`, `format`, `timestamp`, `humanTime`).
- Suffixes: `x[]` is an array and `x?` is `type: [T, "null"]` (OpenAPI 3.1 style).
- A resource becomes an entry in `components.schemas`, named after its export (`ProductResource`), and every use is a `$ref`. Nested, lazy and `"self"` fields point at the same entry, so recursive resources do not unroll. A resource that is not exported from a `*.resource.ts(x)` file gets a generic name.
- `[Resource]` is an array of that `$ref`. A nested plain object is an object schema.
- Every listed key is marked `required`.

```json
"201": {
  "description": "Created",
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "properties": {
          "product": { "$ref": "#/components/schemas/ProductResource" }
        },
        "required": ["product"]
      }
    }
  }
}
```

### Security

`authMiddleware()` from `@warlock.js/auth` tags the middleware it returns with a descriptor under `Symbol.for("warlock.auth")`: `{ sources, userTypes }`. Core reads it without importing the auth package and emits only the schemes a route actually uses:

| Credential source        | Scheme in `components.securitySchemes`                        |
| ------------------------ | ------------------------------------------------------------- |
| the `Authorization` header | `bearerAuth` — HTTP bearer                                   |
| a cookie                 | `cookieAuth` — an API key in that cookie (a second, different cookie gets its own `cookieAuth_<name>` scheme) |

A guard that accepts the header and a cookie is an OR: one security requirement for each. Allowed user types appear in the operation description. Middleware that has no descriptor is ordinary middleware and adds no security entry.

## Warnings

Anything that cannot be described statically is documented as `{}` and listed after the run. The usual ones:

- A field builder or resolver function in a resource, or an unknown cast — declare the field with a cast string to document it.
- A `validation.validate` hook: it is custom middleware and is not documented.
- A `validation.schema` or `validation.params` that is not an object schema, or cannot be converted.
- A route whose method and path are already documented by an earlier route.
- An auth descriptor with the wrong shape (the route is documented without security).

## Live API docs in development

With [`@warlock.js/devtools`](/v/latest/devtools/) installed, `warlock dev` renders the same document without a CLI run:

- `http://localhost:<port>/__warlock/docs` is an API reference rendered with [Scalar](https://github.com/scalar/scalar). The dashboard has an **API** tab that shows the same page.
- `GET /__warlock/api/openapi.json` returns the raw document, rebuilt from the routes registered in the running process on every request. It is built by `getDevelopmentOpenApiDocument()`, exported from `@warlock.js/core`; that function throws outside `warlock dev`.
- Pages are not included, and each distinct warning is logged once per process instead of on every request.

It stays behind devtools' dev-only, loopback-only guard, and the page makes no outside request: Scalar is bundled with devtools, with its web fonts, telemetry, AI agent and MCP turned off.

## Use the file in a client

The output is plain OpenAPI 3.1 JSON. Import `storage/openapi/openapi.json` into Postman or Insomnia with their Import action, or hand it to any client or SDK generator that reads OpenAPI. Support for version 3.1 is the tool's own, so update it if an older release refuses the file. Regenerate whenever routes change, or commit the file if you publish it.

## Build the document yourself

`buildOpenApiDocument(routes, context)` is exported from `@warlock.js/core`. It is a pure function from `router.list()` routes to `{ document, warnings }`; the CLI calls the same function inside its child process.

```ts
import { buildOpenApiDocument, router } from "@warlock.js/core";

const { document, warnings } = buildOpenApiDocument(router.list(), {
  info: { title: "Shop API", version: "1.0.0" },
  servers: ["https://api.shop.test"],
});
```

`context` also accepts `includePages`, `resolveResourceName` (how a resource is named in `components.schemas`) and `validationResponse` (your `validation.response` configuration).

## Gotchas

- **The document describes what you declare.** A route without `responseSchema` documents only a `200` description; nothing is inferred from the controller body.
- **Export each resource from its own `*.resource.ts` file** so its schema is named after the export.
- **The `401` body is `{ error: string }`.** The auth middleware's real rejection also carries an `errorCode`, which the document does not list.

## See also

- [`warlock routes`](./routes.md) — list the routes the document is built from.
- [Controllers](../the-basics/03-controllers.md) — `validation`, `description` and `responseSchema` on a handler.
- [Resources](../the-basics/06-resources.md) — resources become `components.schemas`.
- [Devtools](/v/latest/devtools/) — the dev-only dashboard that serves the API docs page.
