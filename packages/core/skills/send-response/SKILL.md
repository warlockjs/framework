---
name: send-response
description: 'Send HTTP responses via @warlock.js/core''s Response helpers — success/error variants, status helpers, redirects, files, streams, and SSE. Picking the right helper carries the HTTP semantic without manual status codes. Triggers: `response.success`, `response.successCreate`, `response.notFound`, `response.forbidden`, `response.badRequest`, `response.sendFile`, `response.stream`, `response.sse`, `response.replay`, `ResourceNotFoundError`, `ForbiddenError`; "return a 201 from a controller", "send a file", "stream Server-Sent Events", "throw HTTP-shaped errors from services"; typical import `import type { RequestHandler, Response } from "@warlock.js/core"`. Skip: controller shape — `@warlock.js/core/create-controller/SKILL.md`; route registration — `@warlock.js/core/register-route/SKILL.md`; competing patterns: hand-rolled status codes via `reply.code(404).send(...)`, raw Fastify reply.'
---

# Warlock — send a response

`Response` is the helper-rich object passed to every controller. Pick the helper that matches the outcome — the helper carries the status code, so you almost never set one by hand.

## The shape

```ts
import type { RequestHandler, Response } from "@warlock.js/core";

export const myController: RequestHandler = async (request, response: Response) => {
  // …choose a helper and return it
  return response.success({ data: "…" });
};
```

Always `return response.<helper>(...)`. The return value drives Fastify's send.

## Success helpers

| Method                              | Status | When                                      |
| ----------------------------------- | ------ | ----------------------------------------- |
| `response.success(data?)`           | 200    | normal read / update                      |
| `response.successCreate(data)`      | 201    | resource created (POST)                   |
| `response.noContent()`              | 204    | delete succeeded, no body needed          |

```ts
return response.success({ products: [...] });

return response.successCreate({ product });

return response.noContent();
```

`response.success()` (no argument) defaults to `{ success: true }` — useful for void operations that still need a body.

## Client-error helpers

| Method                                              | Status | When                                  |
| --------------------------------------------------- | ------ | ------------------------------------- |
| `response.badRequest(data)`                         | 400    | malformed or invalid input            |
| `response.unauthorized(data?)`                      | 401    | missing/invalid auth token            |
| `response.forbidden(data?)`                         | 403    | authenticated but not allowed         |
| `response.notFound(data?)`                          | 404    | record missing                        |
| `response.conflict(data?)`                          | 409    | uniqueness violation, state conflict  |

```ts
return response.badRequest({ error: t("validation.invalid") });

return response.unauthorized({ error: t("auth.invalidCredentials") });

return response.forbidden({ error: t("permission.denied") });

return response.notFound({ error: t("product.notFound") });

return response.conflict({ error: t("product.duplicateSku") });
```

Most error helpers accept an optional payload — if you omit it, they send a default `{ error: "<status name>" }` shape.

## Redirects

```ts
return response.redirect("/login");                    // 302
return response.redirect("/new-home", 301);            // permanent
```

## Files

```ts
// stream a file from disk
return response.sendFile("/abs/path/to/file.pdf");

// cache for 1 year (default)
return response.sendCachedFile("/abs/path/to/asset.css");

// send a buffer with content type
return response.sendBuffer(buffer, { contentType: "image/png" });
```

`SendFileOptions` lets you set `cacheTime`, `immutable`, `inline`, `filename` (download attachment name).

## Streams

```ts
const stream = response.stream("text/plain");

stream.send("first chunk\n");
stream.send("second chunk\n");
stream.end();
```

`response.stream(contentType?)` returns a controller with `.send(chunk)`, `.render(reactNode)`, `.end()`, and an `.ended` getter. Use for large dynamic payloads where buffering would blow memory. Calling `.send()` after `.end()` throws.

## Throwing HTTP errors

Most of the time, controllers don't need to *choose* an error helper — they throw from the service layer instead. The request middleware (`http/middleware/inject-request-context.ts`) catches every `HttpError` subclass and produces the matching response. The error classes mirror the helpers above:

```ts
import {
  ResourceNotFoundError,   // 404
  UnAuthorizedError,        // 401
  ForbiddenError,           // 403
  BadRequestError,          // 400
  ConflictError,            // 409
  NotAcceptableError,       // 406
  NotAllowedError,          // 405
  ServerError,              // 500
  HttpError,                // base class — `new HttpError(status, message, payload?)` for arbitrary codes
} from "@warlock.js/core";

throw new ResourceNotFoundError("product.notFound");
throw new ForbiddenError("permission.denied", { resource: "product", id });
throw new ConflictError("user.duplicateEmail");
```

Each class takes `(message, payload?)`. The payload merges into the response body alongside `error`. In development mode, the stack trace is included too.

Pick the class, throw from the service or use-case, and forget about response shaping at the call site. The controller stays focused on the success path:

```ts
export const getProductController: RequestHandler = async (request, response) => {
  const product = await getProductService(request.input("id"));   // throws ResourceNotFoundError on miss
  return response.success({ product });
};
```

See [`create-controller`](../create-controller/SKILL.md) for the "throw from service, return from controller" pattern.

## Server-Sent Events

```ts
const sse = response.sse();

sse.send("tick", { count: 1 });             // event name, data, optional id
sse.send("tick", { count: 2 }, "msg-2");    // third arg is the SSE event id
sse.comment("keep-alive");                  // invisible to the client, prevents timeout
sse.end();
```

`response.sse()` returns a controller with `send(event, data, id?)`, `comment(text)`, `end()`, `onDisconnect(handler)`, and an `.ended` getter. The `send` signature is positional — `event` name first, then the `data` payload (JSON-stringified for you), then an optional event `id`. After the client disconnects, `send`/`comment` become silent no-ops and any `onDisconnect` handlers fire — register cleanup there:

```ts
const sse = response.sse();
const listener = (chunk: string) => sse.send("chunk", { chunk });

eventBus.on(messageId, listener);
sse.onDisconnect(() => eventBus.off(messageId, listener));
```

Browsers consume SSE via `new EventSource(url)`. Cheaper than websockets when you only need server-to-client push.

## Setting headers and cookies

```ts
response.header("X-Total-Count", "42");

// JSON-wrapped (default) — round-trips with request.cookie("prefs")
response.cookie("prefs", { theme: "dark" }, { httpOnly: true });

// Plain string — use raw: true for session tokens / opaque IDs that
// shouldn't be JSON-quoted on the wire
response.cookie("session_id", "abc.def.ghi", { raw: true, httpOnly: true });

response.clearCookie("session_id");
```

`response.cookie()` JSON-stringifies the value by default so structured cookies round-trip cleanly with `request.cookie(name)`. Pass `{ raw: true }` to skip the wrapping for plain-string cookies (session tokens, opaque IDs, simple flags). The new `CookieOptions` type extends Fastify's `CookieSerializeOptions` with the `raw` flag.

These mutate the response in place; chain or call before the final `return response.<helper>()`.

## Common patterns

### Localized error

```ts
import { t } from "@warlock.js/core";

if (!result) {
  return response.unauthorized({ error: t("auth.invalidCredentials") });
}

return response.success(result);
```

### Created with link header

```ts
const product = await createProductService(request.validated());

response.header("Location", `/products/${product.id}`);

return response.successCreate({ product });
```

### Streaming an LLM reply

```ts
import { ai } from "@warlock.js/ai";

const stream = response.stream("text/event-stream");
const streamedAgent = await myAgent.stream(request.input("message"));

for await (const event of streamedAgent.events) {
  if (event.type === "text-delta") {
    stream.send(`data: ${JSON.stringify({ delta: event.text })}\n\n`);
  }
}

stream.end();
```

(For the agent surface itself, see `@warlock.js/ai/skills/subskills/agent.md`.)

### Replaying a cached response

For cache-pattern middleware (idempotency, response cache) that needs to send a previously-captured response without re-running the controller:

```ts
return response.header("X-Cache", "HIT").replay({
  status: cached.status,
  body: cached.body,
  contentType: cached.contentType,
  headers: cached.extraHeaders,
});
```

`replay()` sets the status, content-type, and extra headers, then calls `send(body)` so the full event lifecycle still fires — cross-cutting observers (logger, metrics) stay consistent between fresh and replayed responses. Built-in `middleware.idempotency` and `middleware.cache` use this internally; reach for it when writing your own cache-pattern middleware.

## Gotchas

- **Don't manually set the status code.** Use the matching helper. `response.send(...)` with a hand-rolled status loses error-handler integration.
- **Don't call multiple helpers.** First helper wins; subsequent calls log a "response already sent" warning.
- **Cookie options vary by environment.** Set `secure: Application.isProduction` so cookies work in dev (HTTP) and prod (HTTPS) without changing code.
- **Streaming and SSE consume the response.** No `response.success(...)` afterward — call `stream.end()` / `sse.end()` to finish.

## See also

- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — what calls `response.<helper>()` from.
- [`register-route/SKILL.md`](../register-route/SKILL.md) — wiring the controller to a URL.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — when to use HTTP error helpers vs `throw`.
