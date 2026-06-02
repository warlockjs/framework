---
title: "HTTP request"
description: The Request surface in Warlock — every public method grouped by purpose, with the patterns you'll reach for from controllers and middleware.
sidebar:
  order: 5
  label: "HTTP request"
---

`request` is the first parameter every controller and middleware receives. It's a thin shell around the Fastify request with helpers tuned for how Warlock apps actually read data — pulling validated fields off a schema, reading multipart files, checking the authenticated user, picking up locale-aware translations.

This page is the complete surface, grouped by what you're trying to do. Reach for it when autocomplete isn't enough or you want to know whether something exists before writing it yourself.

## Mental model

A `Request` wraps one HTTP request for its full lifetime. It carries:

- The **payload** — query string, route params, parsed body — already normalised into one merged map and individual buckets you can read.
- A **handle to the user** (`request.user`) once `authMiddleware` has run.
- The **route** that matched and the **response** the controller will eventually use.
- **Locale-aware translation** via `request.t(...)`.
- An **identity dictionary** — `request.id`, `request.ip`, `request.userAgent`.

You never construct a `Request` yourself. The framework hands one to every middleware and controller. Type it as `Request<Schema>` when a validation schema is attached so `request.validated()` returns the right shape.

```ts
import type { RequestHandler, Response } from "@warlock.js/core";

export const listProductsController: RequestHandler = async (request, response: Response) => {
  const filters = request.all();
  const userId = request.user.id;

  return response.success({ filters, userId });
};
```

## Reading input

Five everyday helpers cover ~90% of what you'll do:

| Method                                | Returns                                       | Use when                                           |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `request.validated()`                 | schema-typed object                           | a schema is attached — always prefer this          |
| `request.input(key, default?)`        | one field from merged input                   | reading one named field                            |
| `request.all()`                       | full merged input (body + query + params)     | passing everything to a service                    |
| `request.allExceptParams()`           | body + query, no route params                 | excluding `:id`-style params                       |
| `request.only(keys)` / `.except(keys)`| subset / complement of `.all()`               | partial field passing                              |

`input()` returns `any`. `validated()` returns the schema's `Infer` type. That's the headline difference — if you have a schema, never go back to `input()` for the validated fields.

### `validated()` and `validatedExcept()`

When a schema is attached to the handler (see [Validation](./validation.md)), call `request.validated()` to get the typed object:

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
  const data = request.validated();
  // data.name, data.price — typed

  const product = await createProductService(data);

  return response.successCreate({ product });
};

createProductController.validation = {
  schema: createProductSchema,
};
```

Pass an array of keys to narrow the return:

```ts
const { name, price } = request.validated(["name", "price"]);
```

Or use the complement form when you want everything except a few:

```ts
const data = request.validatedExcept("internalNote", "auditTag");
```

If validation hasn't happened yet (no schema attached, or validation failed before the handler ran), `validated()` returns `{}`. In practice you only call it from handlers behind a schema — the framework guarantees data is there.

### `input()`, `all()`, and friends

For routes without a schema, or for fields you didn't put in the schema (e.g. an opaque debug query param), reach for `input()`:

```ts
const sort = request.input("sort", "createdAt");
const page = request.input("page", 1);
```

`input()` reads from one merged map of `body + query + params`. Default values kick in when the key is missing — they do **not** kick in on `null` or empty string.

`all()` returns the full merged map. Useful when you're forwarding everything to a service:

```ts title="src/app/faqs/controllers/list-faqs.controller.ts"
import { type RequestHandler } from "@warlock.js/core";
import { listFaqsService } from "../services/list-faqs.service";

export const listFaqsController: RequestHandler = async (request, response) => {
  const { data: faqs, pagination } = await listFaqsService({
    ...request.all(),
    organization_id: request.user.organizationId,
  });

  return response.success({ faqs, pagination });
};
```

When you specifically don't want route params:

```ts
const body = request.allExceptParams();
```

And the everyday subset helpers:

```ts
const { name, email } = request.only(["name", "email"]);
const rest = request.except(["password", "token"]);
```

`pluck(keys)` is `only(keys)` plus deletion — handy when one service consumes a slice and another consumes the leftovers:

```ts
const credentials = request.pluck(["email", "password"]); // also removes them from request payload
const profile = request.all();                            // no email/password here anymore
```

### Typed scalar shortcuts

When you want a coerced value without writing the conversion yourself:

| Method                                | Returns                              |
| ------------------------------------- | ------------------------------------ |
| `request.string("name", "")`          | `string` (coerced via `String(...)`) |
| `request.int("id", 0)`                | `number` (via `parseInt`)            |
| `request.float("price", 0)`           | `number` (via `parseFloat`)          |
| `request.number("count", 0)`          | `number` (via `Number(...)`)         |
| `request.bool("active", false)`       | `boolean` (handles "true"/"false")   |
| `request.email("email", "")`          | `string` lowercased                  |
| `request.idParam`                     | `number` — shortcut for `int("id")`  |

These don't run the schema validator — they just coerce. For untyped admin endpoints they're great; for typed controllers, stick with `validated()`.

### Body / query / params individually

When you need to know **which segment** a value came from:

```ts
request.body                    // parsed body only
request.query                   // query string only
request.params                  // route params only
```

You can also mutate them (rare, but useful in middleware that needs to inject defaults):

```ts
request.setBody("organization_id", request.user.organizationId);
request.setQuery("status", request.input("status", "active"));
request.setParam("id", String(canonicalId));
```

These mutate the request's parsed payload. The merged `all()` and validated views update accordingly.

### `has`, `set`, `setDefault`, `unset`

Mutating the merged payload for downstream services:

```ts
if (!request.has("status")) {
  request.setDefault("status", "active");
}

request.set("audited_by", request.user.id);
request.unset("password", "passwordConfirmation");
```

`setDefault` is a no-op if the key already exists. `unset` accepts variadic keys.

## Files

Multipart uploads land on the request as `UploadedFile` instances. Two readers:

```ts
const avatar = request.file("avatar");                  // single file → UploadedFile | undefined
const attachments = request.files("attachments");       // many files  → UploadedFile[]
```

The framework's multipart plugin attaches files to the body, so a schema with `v.file()` validators picks them up automatically:

```ts title="src/app/uploads/controllers/create-upload.controller.ts"
import { type RequestHandler } from "@warlock.js/core";
import { type UploadRequest } from "../requests";
import { uploadSchema } from "../schema";
import { createUploadService } from "../services/create-upload.service";

export const createUploadController: RequestHandler = async (request: UploadRequest, response) => {
  const { files } = request.validated();

  const uploads = await Promise.all(
    files.map((file) =>
      createUploadService({
        file,
        organizationId: request.user?.organizationId!,
        uploadedBy: request.user?.uuid,
      }),
    ),
  );

  return response.success({ uploads });
};

createUploadController.validation = {
  schema: uploadSchema,
};
```

See [File uploads](../digging-deeper/file-uploads.md) for the full `UploadedFile` surface — sizing, validation, saving, and image transforms.

## Headers

```ts
const correlationId = request.header("X-Correlation-Id");          // value or null
const userAgent = request.header("user-agent", "unknown");         // with default
const allHeaders = request.headers;                                // full map (Fastify)

request.setHeader("X-Internal", "true");                           // mutate (rare; usually for middleware)
```

The `header(name)` lookup is case-insensitive — pass `"X-Foo"` or `"x-foo"` interchangeably.

There's also `request.authorization` (the raw `Authorization` header), `request.authorizationValue` (the value after `Bearer ` or `Key `), and `request.accessToken` (just the bearer token portion, or `undefined` for non-bearer auth).

## Identity

Helpers for "who is this request":

| Property                    | Type                  | Note                                                       |
| --------------------------- | --------------------- | ---------------------------------------------------------- |
| `request.user`              | your user model       | populated by `authMiddleware`; `undefined` on guest routes |
| `request.id`                | `string`              | 32-char request id, regenerated per request                |
| `request.ip`                | `string`              | client IP (Fastify's parsed value)                         |
| `request.realIp`            | `string`              | proxy-aware (`x-real-ip` → `x-forwarded-for` → `ip`)       |
| `request.ips`               | `string[]`            | the full forwarded-for chain                               |
| `request.userAgent`         | `string \| undefined` | user-agent header                                          |
| `request.referer`           | `string \| undefined` | referer header                                             |
| `request.origin`            | `string`              | `Origin` header                                            |
| `request.originDomain`      | `string \| null`      | origin's hostname (no `www.`)                              |
| `request.method`            | `string`              | HTTP verb                                                  |
| `request.path` / `.url`     | `string`              | URL path                                                   |
| `request.fullUrl`           | `string`              | scheme + host + path                                       |
| `request.domain` / `.hostname` | `string`           | hostname (no `www.`)                                       |
| `request.route`             | `Route`               | the matched route object                                   |

`request.user` is only present after an auth middleware sets it. On guarded routes you can trust it; on public routes, you have to narrow:

```ts
if (request.user) {
  // safe
}
```

Or use the `guarded()` helper from `src/app/shared/utils/router.ts` so every controller in the group can assume `request.user` is set:

```ts title="src/app/shared/utils/router.ts"
import { authMiddleware } from "@warlock.js/auth";
import { router } from "@warlock.js/core";

export function guarded(callback: () => void) {
  router.group({ middleware: [authMiddleware("user")] }, callback);
}
```

```ts
guarded(() => {
  router.get("/me", meController);     // request.user is guaranteed
});
```

The user model is your project's class — typically `User` from `src/app/users/models/user`. Type the request as `Request<Schema> & { user: User }` if your auth middleware narrows the type by default in your project.

## Translation

Every request carries a locale-bound translator. Reach it via `request.t(...)` (alias of `request.trans(...)`):

```ts
const message = request.t("welcome.greeting", { name: request.user.firstName });
```

The locale is resolved from (in order):

1. The `translation-locale-code` header
2. The `locale` header or `?locale=` query string
3. `config.key("app.localeCode")` (default `"en"`)

You can force a different locale on a single call with `request.transFrom("ar", "welcome.greeting", ...)`, or set the request's locale for downstream code:

```ts
request.setLocaleCode("ar");
```

There's also a standalone `t(keyword, placeholders?)` exported from `@warlock.js/core` that reads from the request context — useful inside services and use-cases where you don't have a request parameter:

```ts
import { t } from "@warlock.js/core";

if (!result) {
  return response.unauthorized({ error: t("auth.invalidCredentials") });
}
```

Real example:

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
    return response.unauthorized({ error: t("auth.invalidCredentials") });
  }

  return response.success(result);
};

login.validation = { schema: loginSchema };
```

Three locale signals show up in twelve lines: `request.userAgent`, `request.ip`, and `t(...)` for the localized error message.

## Cookies

```ts
const themeRaw = request.cookie("theme");        // parsed value (auto-JSON if possible) or undefined
const theme = request.cookie("theme", "light");  // with default

const hasSession = request.hasCookie("session_id");
const all = request.cookies;                     // full map
```

Cookies are parsed by the framework's cookie plugin — they arrive on the request as already-decoded values. Set cookies on the **response** via `response.cookie(name, value, options)` — see [HTTP response](./http-response.md#cookies).

## Use-cases by example

### Reading one field

```ts
const search = request.input("search", "");
```

### Reading every field from a typed schema

```ts
const data = request.validated();
```

### Reading user identity on a guarded route

```ts
const userId = request.user.id;
const orgId = request.user.organizationId;
```

### Mixing validated + extra

```ts
const data = request.validated();
const sort = request.input("sort", "createdAt");

const result = await listService({ ...data, sort });
```

### Forwarding everything plus an injected field

```ts
const result = await listService({
  ...request.all(),
  organization_id: request.user.organizationId,
});
```

### Reading a header for tracing

```ts
const correlationId = request.header("X-Correlation-Id") ?? request.id;
log.info("orders", "create", { correlationId });
```

### Reading a typed param

```ts
router.get("/orders/:id", getOrderController);

// inside the controller
const id = request.idParam;            // typed number
```

## Gotchas

- **Prefer `validated()` over `all()` whenever a schema is attached.** `validated()` is typed, validated, and reflects the schema's transforms (trimmed strings, coerced numbers). `all()` is `any` and skips validation entirely.
- **`input()` returns `any`.** Cast or pipe it through validation if you need a strict type. Untyped inputs are how `undefined` slips into service calls.
- **`request.user` is undefined on guest routes.** Always narrow before reading or use the `guarded()` group helper so every route inside the group has it.
- **Default values fire on missing keys, not empty values.** `request.input("name", "John")` returns `""` for an empty string body field, not `"John"`. Handle empty strings explicitly if they matter.
- **`request.body` is the **parsed** body, not the raw one.** Don't `JSON.parse` it again — Fastify and the framework's parser already did. Use `all()` / `validated()` for normal field access.
- **Path-param names must match the URL pattern.** `router.get("/:id", ...)` exposes `request.input("id")` and `request.idParam`. A typo in the controller (`request.input("Id")`) silently returns `undefined`.

## See also

- **[Controllers](./03-controllers.md)** — the thin-function shape that consumes `request`.
- **[HTTP response](./http-response.md)** — the other half of the handler signature.
- **[Validation](./validation.md)** — attaching seal schemas so `validated()` returns a typed object.
- **[Middleware](./middleware.md)** — code that runs before the controller and can short-circuit the response.
- **[File uploads](../digging-deeper/file-uploads.md)** — the full `UploadedFile` surface that `request.file()` returns.
