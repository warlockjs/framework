---
title: "Error handling & error codes"
description: Throw HttpError (or one of its eight subclasses) and the framework maps it to the right status, payload, and JSON body — plus the stable HttpErrorCodes clients branch on and the validation-failure envelope.
sidebar:
  order: 11
  label: "Error handling"
---

Warlock turns thrown errors into HTTP responses for you. Throw an `HttpError` (or one of its eight subclasses) from a controller, service, or use-case and the framework catches it, reads the status off the error, and sends a JSON body. You don't wire a `try/catch` into every handler — the request pipeline already wraps your code.

That's the honest scope. The framework handles the **mapping** (error → status → body) and a **stable code table** (`HttpErrorCodes`) that middleware uses so clients can branch on a code instead of parsing message text. What you decide is **which** error to throw and what to put in its payload. This page covers both — the error classes, how they reach the wire, the validation envelope, and the codes.

## The 30-second look

```ts title="src/app/orders/services/find-order.service.ts"
import { ResourceNotFoundError } from "@warlock.js/core";
import { Order } from "../models/order";

export async function findOrderOrFail(id: string) {
  const order = await Order.find(id);

  if (!order) {
    throw new ResourceNotFoundError("Order not found");
  }

  return order;
}
```

A controller calls this service and does nothing special. When the order is missing, the throw bubbles up, the request pipeline catches it, and the client gets:

```json
// HTTP 404
{
  "error": "Order not found"
}
```

No `try/catch` in the controller, no manual `response.notFound(...)`. The status code lives on the error class — `ResourceNotFoundError` is `404` — and the framework reads it.

## The error classes

All HTTP errors live in `@warlock.js/core` (and, on their own, in [`@warlock.js/core/errors`](#importing-the-errors-without-the-framework)). The base is `HttpError`; the eight subclasses are thin wrappers that pre-fill the status code so you don't pass it yourself.

```ts
export class HttpError extends Error {
  public constructor(
    public status: number,
    public message: string,
    public payload?: any,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
```

`HttpError` is the only class that takes a status as its first argument. Every subclass takes `(message, payload?)` and hard-codes the status:

| Class                   | Status       | Throw it when…                                                      |
| ----------------------- | ------------ | ------------------------------------------------------------------- |
| `HttpError`             | _you choose_ | You want a status the subclasses don't cover (e.g. `429`, `503`).   |
| `ResourceNotFoundError` | `404`        | A looked-up record or route target doesn't exist.                   |
| `UnAuthorizedError`     | `401`        | The caller isn't authenticated (missing / invalid credentials).     |
| `ForbiddenError`        | `403`        | The caller is authenticated but not allowed to do this.             |
| `BadRequestError`       | `400`        | The request is malformed or semantically wrong.                     |
| `ConflictError`         | `409`        | The action conflicts with current state (duplicate, version clash). |
| `NotAcceptableError`    | `406`        | The server can't produce a representation the client will accept.   |
| `NotAllowedError`       | `405`        | The HTTP method isn't allowed on this resource.                     |
| `ServerError`           | `500`        | Something broke server-side that the client can't fix.              |

Note the spelling: it's `UnAuthorizedError` (capital `A`), not `UnauthorizedError`.

```ts title="src/app/posts/services/publish-post.service.ts"
import { ConflictError, ForbiddenError, ResourceNotFoundError } from "@warlock.js/core";
import { Post } from "../models/post";

export async function publishPost(postId: string, userId: string) {
  const post = await Post.find(postId);

  if (!post) {
    throw new ResourceNotFoundError("Post not found");
  }

  if (post.get("authorId") !== userId) {
    throw new ForbiddenError("You can only publish your own posts");
  }

  if (post.get("status") === "published") {
    throw new ConflictError("Post is already published");
  }

  post.set("status", "published");
  await post.save();

  return post;
}
```

### The `payload` argument

Every error class accepts an optional second argument (third on `HttpError`) — a free-form `payload`. Use it to attach machine-readable detail the client can act on:

```ts
throw new ConflictError("Email already in use", {
  code: "EMAIL_TAKEN",
  field: "email",
});
```

How the payload reaches the response depends on which class you threw — see the next section.

## How a thrown error becomes a response

The request pipeline wraps your middleware, validation, and handler in a single `try/catch`. When something throws, it runs `handleRequestError`, which inspects the error type and sends a response.

Before it inspects the type, that single funnel sets
`Cache-Control: private, no-store`. The floor applies to every unhandled
error response—4xx and 5xx, page and API routes—so a CDN or shared cache cannot
replay one request's failure to another user or keep serving an outage after
its cause is gone.

```mermaid
flowchart TD
  A["Handler / service / use-case throws"] --> M{"instanceof HttpError?"}
  M -- "no" --> N["http.errorMapper (if configured)<br/>may turn it into an HttpError"]
  M -- "yes" --> C
  N --> B{"instanceof HttpError?"}
  B -- "yes" --> C["status = error.status<br/>body = { error: message }<br/>+ payload (if any)<br/>+ stack (dev only)"]
  B -- "no, DatabaseWriterValidationError" --> D["http.modelValidationErrorStatus<br/>(default 500)"]
  B -- "no, unknown error" --> E["logged with its stack<br/>500 { error: 'Internal server error.' }"]
  C --> F["JSON response sent"]
  D --> F
  E --> F
```

The first check is `instanceof HttpError`. Because **all eight subclasses extend `HttpError`**, that branch catches every framework error — `ResourceNotFoundError`, `ForbiddenError`, and the rest all flow through it. The resulting body is:

```ts
// Conceptually, for any HttpError (or subclass):
{
  error: error.message,        // always
  payload: error.payload,      // only when payload was provided
  stack: error.stack,          // only in the development environment
}
```

So a `ResourceNotFoundError("Order not found", { orderId })` produces:

```json
// HTTP 404
{
  "error": "Order not found",
  "payload": { "orderId": "abc123" }
}
```

The payload lands under a `payload` key, not spread at the top level. In `development` the response also carries a `stack` field; in production it's omitted.

**Unknown errors are an opaque 500.** If you throw something that isn't an `HttpError` — a plain `Error`, a `TypeError` — and no [error mapper](#mapping-your-own-errors-httperrormapper) claims it, the pipeline logs it with its stack and responds `500` with `{ error: "Internal server error." }`. Its message never reaches the client. One framework exception is wired in: `DatabaseWriterValidationError` from `@warlock.js/cascade` answers with `http.modelValidationErrorStatus` (default `500`); a 4xx status there sends its `errors` array.

A thrown error that resolves to a 4xx is logged once at `warn` (`Name: message (status)`, no stack); 5xx and unknown errors are logged at `error` with the stack.

### The 5xx error record

Every 5xx the HTTP layer answers writes **one** `error`-level logger record, however many stages saw the error. It covers a throw from a route middleware, from request validation, from a controller or handler, and a 5xx a handler returned without throwing (a returned `503` is the usual "unavailable on purpose" answer, such as maintenance mode or a failing readiness probe, so it is not logged as an error). A 4xx is never logged as an error.

The record's `module` is `http` and its `action` is `request.<phase>`. It has the same shape as the page-failure record `@warlock.js/web` writes, with these context fields:

| Field                      | Meaning                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `name`, `message`, `stack` | The thrown error                                                                                 |
| `phase`                    | `csrf`, `middleware`, `validation` or `handler`                                                  |
| `middleware`               | The name of the middleware that threw, when `phase` is `middleware`                              |
| `handler`                  | The route handler's function name (`(anonymous)` when it has none)                               |
| `file`                     | The routes file that declares the route                                                          |
| `routeName`, `routePath`   | The route's name and its pattern (`/posts/:id`)                                                  |
| `method`, `pathname`       | The request, without its query string                                                            |
| `requestId`                | The same id as the `X-Request-Id` header                                                         |
| `statusCode`               | The status the response carries                                                                  |

With no log channel configured, the failure still reaches the terminal through `console.error`.

In `development` the JSON error body also carries `requestId`, so a failing response can be matched to its record without opening the headers. Production bodies stay generic.

## Mapping your own errors: `http.errorMapper`

Domain errors often have to exist outside an HTTP process too — in a worker, a CLI, a standalone helper — where extending Core's `HttpError` would drag the framework in. Give them a status at the HTTP edge instead, with `http.errorMapper` in `src/config/http.ts`:

```ts title="src/config/http.ts"
import type { HttpConfigurations } from "@warlock.js/core";
import { RevisionConflict, WorkspaceNotFound } from "app/workspaces/errors";

const httpConfigurations: HttpConfigurations = {
  errorMapper(error) {
    if (error instanceof WorkspaceNotFound) return { status: 404 };
    if (error instanceof RevisionConflict) {
      return { status: 409, message: "Revision changed", payload: { revision: error.current } };
    }

    // a duck-typed contract, if your errors carry their own status
    if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
      return { status: (error as { status: number }).status };
    }
  },
};

export default httpConfigurations;
```

- The mapper runs only for errors that are **not** already an `HttpError`, and only when middleware or a handler throws.
- Return `{ status, message?, payload? }` (or an `HttpError`) to answer with it; return `undefined` to keep the default handling.
- `message` defaults to the error's own message for a **4xx** and to `"Internal server error."` for a **5xx**, so mapping a server fault never echoes an internal message. Set `message` explicitly to override.
- A status outside 400–599 is ignored. A mapper that throws is logged (`http` / `error-mapper`) and the original error is handled as if no mapper were configured.
- The mapped error keeps the original's name and stack in the request log, so `WorkspaceNotFound: … (404)` shows up at `warn`.

## Importing the errors without the framework

`@warlock.js/core/errors` exports `HttpError`, its subclasses and `CookieJarUnavailableError` — and nothing else. The root `@warlock.js/core` entry boots the application runtime (Cascade, Cache, the MongoDB driver, the HTTP layer); this subpath imports none of it, so a small standalone program can throw `BadRequestError` and still bundle on its own:

```ts
import { BadRequestError } from "@warlock.js/core/errors";
```

They are the same classes the root exports, so `instanceof HttpError` holds whichever entry an error was created from.

## The validation-failure envelope

Schema validation failures don't throw — they short-circuit into a dedicated envelope **before** your handler runs. When a route's schema validation fails, the framework calls `response.failedSchema(result)` and returns immediately.

The shape is driven by the `validation.response` config key (with built-in defaults):

```ts
// response.failedSchema reads this config, defaulting to:
const { errors, inputKey, inputError, status } = config.get("validation.response", {
  errors: "errors",
  inputKey: "input",
  inputError: "error",
  status: 422,
});
```

So an out-of-the-box validation failure looks like:

```json
// HTTP 422
{
  "errors": [
    { "input": "email", "error": "Email is required" },
    { "input": "password", "error": "Password must be at least 8 characters" }
  ]
}
```

| Config field (under `validation.response`) | Default    | Controls                                                                     |
| ------------------------------------------ | ---------- | ---------------------------------------------------------------------------- |
| `errors`                                   | `"errors"` | The top-level key holding the array of failures.                             |
| `inputKey`                                 | `"input"`  | The per-error key naming the failed input.                                   |
| `inputError`                               | `"error"`  | The per-error key holding the message.                                       |
| `status`                                   | `422`      | The HTTP status for a schema-validation failure.                             |
| `body`                                     | —          | A hook `(result, route) => body` that replaces the envelope for every route. |

Override any of these in your project config to reshape the envelope (for example, to match an existing API contract) without touching framework code. A route that must answer with its own stable error code sets `validation.onFailure`, which wins over `body`; see [Validation → Custom failure responses](../the-basics/validation.md#custom-failure-responses).

### Use-cases: `BadSchemaUseCaseError`

[Use-cases](../the-basics/04-use-cases.md) run their own schema check inside the pipeline. When a use-case's `schema` rejects the input, the pipeline throws `BadSchemaUseCaseError` — which **extends `HttpError`** with status `400`, so it flows through the same `handleRequestError` path as everything else:

```ts
export class BadSchemaUseCaseError extends HttpError {
  public constructor(result: ValidationResult) {
    super(400, `Invalid input data`, {
      code: "BAD_SCHEMA_USE_CASE",
      errors: result.errors,
    });
  }
}
```

The validation detail rides in the `payload` (under `code` and `errors`), so the client sees:

```json
// HTTP 400
{
  "error": "Invalid input data",
  "payload": {
    "code": "BAD_SCHEMA_USE_CASE",
    "errors": [/* per-field validation errors */]
  }
}
```

This is the difference between the two validation paths: **route schema validation** produces the flat `failedSchema` envelope (configurable keys), while **use-case schema validation** throws an `HttpError` whose payload carries the errors. Same `400`, different shape — branch on it accordingly.

## The `HttpErrorCodes` table

Some failures aren't tied to a single status — a client needs to distinguish "you reused an idempotency key with a different body" from "your idempotency key is malformed," and message text is a fragile thing to branch on. For those, core HTTP middleware attaches a **stable code** from the `HttpErrorCodes` enum.

```ts title="branching on the code, not the message"
import { HttpErrorCodes } from "@warlock.js/core";

if (response.body?.code === HttpErrorCodes.RateLimitExceeded) {
  // back off and retry — the code is stable, the message may be localized/reworded
}
```

| Code    | Enum member               | Meaning                                                                              |
| ------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `EC100` | `IdempotencyKeyConflict`  | Same idempotency key reused with a **different** request body — likely a client bug. |
| `EC101` | `IdempotencyKeyInvalid`   | Idempotency key header is malformed (wrong length / non-printable chars).            |
| `EC102` | `RateLimitExceeded`       | Per-route rate limit exceeded (distinct from the global `@fastify/rate-limit` 429).  |
| `EC103` | `ConcurrencyLimitReached` | Per-route concurrency cap reached — too many in-flight requests on this endpoint.    |
| `EC104` | `BodyTooLarge`            | Request `Content-Length` exceeds the per-route body cap.                             |
| `EC105` | `IpForbidden`             | Client IP failed the `ipFilter()` allow/deny check.                                  |
| `EC106` | `Maintenance`             | App is in maintenance mode and the request didn't match the allowlist.               |

### The numbering convention

The ranges are deliberately partitioned so codes never collide across packages:

- **`EC100`–`EC199`** is reserved for `@warlock.js/core` HTTP middleware. `EC100`–`EC106` are in use today; the rest of the range is held for future core middleware.
- **`EC001`–`EC099`** belongs to `@warlock.js/auth` (its `AuthErrorCodes`).

**Clients should branch on the code, not the message.** The enum values are the stable contract. Message text may be reworded, localized, or expanded over time; the `EC###` value will not change meaning. Treat the code the way you'd treat an HTTP status — a machine-readable signal — and reserve the message for humans reading logs.

## Throw vs. `response.notFound()`

Two ways exist to produce an error response. They're not equivalent — pick by **where you are** in the call stack.

**Throw an error** from deep in a service or use-case where you don't have (or shouldn't reach for) the `response` object:

```ts title="service — no response in scope, throw"
import { ResourceNotFoundError } from "@warlock.js/core";

export async function getProfile(userId: string) {
  const user = await User.find(userId);

  if (!user) {
    throw new ResourceNotFoundError("User not found");
  }

  return user;
}
```

**Call a `response` helper** when you're in a controller and already hold the `response` — it's the direct, explicit path and lets you shape the body freely:

```ts title="controller — response in hand, return it"
import type { RequestHandler } from "@warlock.js/core";

const showUser: RequestHandler = async ({ request, response }) => {
  const user = await User.find(request.input("id"));

  if (!user) {
    return response.notFound({ error: "User not found" });
  }

  return response.success({ user });
};

export default showUser;
```

The `response` object ships matching helpers for the common statuses — `response.notFound()`, `response.unauthorized()`, `response.forbidden()`, `response.badRequest()`, `response.conflict()`, `response.serverError()`, `response.tooManyRequests()`, `response.unprocessableEntity()`, and more. Each sets the status and sends the body in one call.

**Rule of thumb:** throw from services and use-cases (the error carries the status up the stack); return a `response.*` helper from controllers (you already have the object, no exception machinery needed). Throwing from a controller works too — it just takes the long way through the pipeline's `catch`.

## Gotchas

- **The base-class check wins.** `handleRequestError` checks `instanceof HttpError` first, and every subclass extends it — so all framework errors render through that single branch (`{ error, payload?, stack? }` at `error.status`). The per-subclass branches further down only matter for non-`HttpError` types like `DatabaseWriterValidationError`. Don't expect a `ForbiddenError`'s payload to be spread at the top level; it lands under `payload`.
- **Unknown throws become an opaque `500`.** A plain `Error` or `TypeError` is logged and answered `500` with `"Internal server error."`. Throw an `HttpError` subclass, or map the error with `http.errorMapper`, when the client should see a 4xx.
- **Stack traces are environment-gated.** The `stack` field is included only when the environment is `development`. Don't rely on it in production responses, and don't put secrets in error messages assuming they'll be hidden.
- **`UnAuthorizedError` has an odd capital `A`.** The class is `UnAuthorizedError`, not `UnauthorizedError`. The import will fail silently as a typo if you guess the conventional spelling.
- **Two validation paths, two shapes.** Route schema validation returns the flat `failedSchema` envelope (`{ errors: [{ input, error }] }`, configurable). Use-case schema validation throws `BadSchemaUseCaseError`, whose detail rides in `payload.errors`. Both are `400`; the body differs.
- **Error messages aren't a stable API.** If a client needs to branch on a specific condition, attach a code (via the error `payload`, or rely on `HttpErrorCodes` for middleware failures) — never parse the message string.

## See also

- [Use-cases](../the-basics/04-use-cases.md) — where `BadSchemaUseCaseError` is thrown, and the pipeline that catches your throws.
- [Validation](../the-basics/validation.md) — the schema layer that feeds the `failedSchema` envelope.
- [Logging](./logging.md) — the `log` API the pipeline uses when it records a failed request.

## Typed domain failures

`AppError<Details, Code>` is available from `@warlock.js/core` and the lightweight
`@warlock.js/core/errors` entry. Its constructor is
`new AppError(code, status, publicMessage, details?)`. Status must be an integer
from 400 to 599. The message and details are explicitly public, including for
5xx errors: never put diagnostics, credentials or private records there.

```ts
import { AppError } from "@warlock.js/core/errors";

throw new AppError("quotaExceeded", 429, "Try again later.", { retryAfter: 30 });
```

The default response is
`{ error: { code: "quotaExceeded", message: "Try again later.", details: { retryAfter: 30 } } }`.
Absent details are omitted; `false`, `0` and `null` details are preserved. Errors
retain the private, no-store cache policy, and server failures are logged.

`AppError` and `HttpError` are separate `Error` subclasses. Existing `HttpError`
constructors, inheritance, `payload` and legacy `{ error: message, payload? }`
bodies remain unchanged. Both bypass `http.errorMapper`; ordinary errors retain
the existing opaque 500 fallback. Choose `AppError` for new domain failures
that need stable codes, and keep existing HTTP error subclasses as they are.

`http.errorResponse` receives an optional typed `appError` alongside `body`,
`status` and `requestId`. No per-error mapper is needed:

```ts
import type { HttpErrorResponseFormatter } from "@warlock.js/core";

const errorResponse: HttpErrorResponseFormatter = ({ appError, requestId }) => {
  if (!appError) return undefined; // keep other JSON errors unchanged
  return {
    error: {
      code: appError.code,
      message: appError.publicMessage,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
    requestId,
  };
};
// Set this function as http.errorResponse in your HTTP configuration.
```

The formatter sees the original instance only for thrown `AppError`s handled
by the request lifecycle. Early Fastify rejections and returned helper responses
have no `appError`; use `body` and `status` for those cases. Do not spread an
error instance into the response.
