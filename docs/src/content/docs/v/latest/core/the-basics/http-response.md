---
title: "HTTP response"
description: The Response surface in Warlock — success and error helpers, redirects, files, streams, SSE, cookies, and headers. Picking the right helper carries the HTTP semantic.
sidebar:
  order: 6
  label: "HTTP response"
---

`response` is the second parameter every controller receives. It's a helper-rich object whose job is to make picking the right HTTP outcome a one-line choice. Status codes live inside the helpers — `response.notFound(...)` already knows it's a 404; you almost never set a status by hand.

This page is the complete surface, grouped by what you're trying to do. Reach for it when autocomplete isn't enough or you want to confirm a helper exists before writing it yourself.

## Mental model

A `Response` builds up state — body, headers, cookies, status — and then sends it. The helpers (`success`, `notFound`, `redirect`, `sendFile`) wrap the right combination of those primitives for you. Most controllers end with one helper call:

```ts
return response.success({ products });
```

A few rules the framework enforces:

- **First helper wins.** Calling two terminal helpers from the same handler logs a warning; only the first one reaches the wire.
- **Streaming and SSE take over.** Once you call `response.stream()` or `response.sse()`, you cannot follow up with `response.success(...)` — call `.end()` on the controller they return.
- **Return the helper.** `return response.success(...)` — the return value drives the framework's send pipeline.

```ts
import type { RequestHandler, Response } from "@warlock.js/core";

export const showController: RequestHandler = async (request, response: Response) => {
  // build up state via helpers
  response.header("X-Total-Count", "42");

  // terminate with one helper
  return response.success({ ok: true });
};
```

## Success helpers

| Method                            | Status | When                                    |
| --------------------------------- | ------ | --------------------------------------- |
| `response.success(data?)`         | 200    | normal read / update                    |
| `response.successCreate(data)`    | 201    | resource created (POST)                 |
| `response.accepted(data?)`        | 202    | async work accepted, not yet processed  |
| `response.noContent()`            | 204    | delete succeeded, no body needed        |

```ts
return response.success({ products: [...] });

return response.successCreate({ product });

return response.accepted({ jobId: enqueued.id });

return response.noContent();
```

`response.success()` (no argument) defaults to `{ success: true }` — useful for void operations that still need a body.

## Client-error helpers

| Method                                | Status | When                                  |
| ------------------------------------- | ------ | ------------------------------------- |
| `response.badRequest(data)`           | 400    | malformed or invalid input            |
| `response.unauthorized(data?)`        | 401    | missing/invalid auth                  |
| `response.forbidden(data?)`           | 403    | authenticated but not allowed         |
| `response.notFound(data?)`            | 404    | record missing                        |
| `response.conflict(data?)`            | 409    | uniqueness violation, state conflict  |
| `response.unprocessableEntity(data)`  | 422    | semantic validation error             |

```ts
return response.badRequest({ error: t("validation.invalid") });

return response.unauthorized({ error: t("auth.invalidCredentials") });

return response.forbidden({ error: t("permission.denied") });

return response.notFound({ error: t("product.notFound") });

return response.conflict({ error: t("product.duplicateSku") });

return response.unprocessableEntity({ error: t("payment.cardDeclined") });
```

`unauthorized`, `forbidden`, and `notFound` each default to a `{ error: "<status name>" }` payload when called with no argument — fine for quick guards, but usually you want a translated message.

### Translated errors

Use the `t()` helper from `@warlock.js/core` for localized messages — it reads locale from the current request:

```ts
import { t } from "@warlock.js/core";

if (!result) {
  return response.unauthorized({ error: t("auth.invalidCredentials") });
}
```

Real example from the reference codebase:

```ts title="src/app/auth/controllers/login.controller.ts"
import { t, type Request, type RequestHandler } from "@warlock.js/core";
import { type LoginSchema, loginSchema } from "../schema/login.schema";
import { loginUseCase } from "../use-cases/login.usecase";

export const login: RequestHandler<Request<LoginSchema>> = async (request, response) => {
  const result = await loginUseCase({
    data: request.validated(),
    deviceInfo: { userAgent: request.userAgent, ip: request.ip },
  });

  if (!result) {
    return response.unauthorized({ error: t("auth.invalidCredentials") });
  }

  return response.success(result);
};

login.validation = { schema: loginSchema };
```

## Server-error helpers

| Method                                | Status | When                            |
| ------------------------------------- | ------ | ------------------------------- |
| `response.serverError(data)`          | 500    | unexpected failure              |
| `response.serviceUnavailable(data)`   | 503    | downstream is down, retry later |

```ts
return response.serverError({ error: "Unexpected" });

return response.serviceUnavailable({
  error: "Provider unavailable, retry in a minute",
});
```

You rarely call `serverError` directly — uncaught exceptions are mapped to it automatically by the framework's error handler (see `inject-request-context.ts`). Reach for it only when you want to surface a specific upstream failure without throwing.

## Redirects

```ts
return response.redirect("/login");                  // 302
return response.redirect("/new-home", 301);          // status override
return response.permanentRedirect("/new-home");      // 301 shortcut
```

`response.redirect(url, status?)` sets the `Location` header and the status code. Default is 302 (temporary). Use 301 for permanent moves so search engines update their indexes.

## Files

```ts
// stream a file from disk
return response.sendFile("/abs/path/to/file.pdf");

// cache for 1 year (default)
return response.sendCachedFile("/abs/path/to/asset.css");

// send a Buffer with content type
return response.sendBuffer(buffer, { contentType: "image/png" });
```

`SendFileOptions` and `SendBufferOptions` cover the common knobs:

| Option        | Type        | Effect                                                     |
| ------------- | ----------- | ---------------------------------------------------------- |
| `cacheTime`   | `number`    | seconds for `Cache-Control: max-age=...`                   |
| `immutable`   | `boolean`   | adds `immutable` to `Cache-Control`                        |
| `inline`      | `boolean`   | `true` → render inline; `false` → download attachment      |
| `filename`    | `string`    | download name (used in `Content-Disposition`)              |
| `contentType` | `string`    | (buffer only) MIME type                                    |
| `etag`        | `string`    | (buffer only) `ETag` header for conditional requests       |

`sendFile` is `If-None-Match` and `If-Modified-Since` aware out of the box — it returns 304 when the client's cached copy matches. If the path doesn't exist, it returns 404 with `{ error: "File Not Found" }` automatically.

For attachment-style downloads:

```ts
return response.downloadFile("/abs/path/report.pdf", "report-2026.pdf");
// or alias:
return response.download("/abs/path/report.pdf");
```

The framework sets `Content-Type: application/octet-stream` and `Content-Disposition: attachment; filename=...` for you.

## Streams

`response.stream(contentType?)` returns a stream controller — for large dynamic payloads where buffering would blow memory, or for progressive rendering:

```ts
const stream = response.stream("text/plain");

stream.send("first chunk\n");
stream.send("second chunk\n");
stream.send("third chunk\n");
stream.end();
```

The controller's surface:

| Method                                | Effect                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| `stream.send(data)`                   | write a chunk (string / Buffer)                         |
| `stream.render(reactElement)`         | server-render a React node and write it as HTML         |
| `stream.end()`                        | finish the response                                     |
| `stream.ended`                        | boolean — has `end()` been called                       |

Once you call `stream()`, the response is "claimed" — don't call `success(...)` or any other terminal helper afterward.

## Server-Sent Events

`response.sse()` is purpose-built for one-way server-to-client push — live notifications, progress updates, streaming LLM replies. Cheaper than websockets when the browser only needs to receive.

```ts
const sse = response.sse();

sse.send("message", { text: "Hello" });
sse.send("notification", { type: "info", body: "Update available" }, "msg-123");

sse.end();
```

The controller's surface:

| Method                                            | Effect                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sse.send(event, data, id?)`                      | emit an event (data JSON-stringified). `id` is optional, used by the browser's `Last-Event-ID`.     |
| `sse.comment(text)`                               | write an SSE comment (invisible to the client) — useful for keep-alive pings                        |
| `sse.onDisconnect(handler)`                       | register cleanup that runs when the client disconnects (cancel jobs, unsubscribe listeners)         |
| `sse.end()`                                       | finish the stream                                                                                   |
| `sse.ended`                                       | boolean — has the stream ended (manually or via disconnect)                                         |

Browsers consume SSE via `new EventSource(url)`. The framework already sets `text/event-stream`, `Cache-Control: no-cache`, and disables nginx buffering for you.

### Real SSE example — streaming an AI reply

This is the actual stream controller from the reference codebase. It pipes an AI message's chunks to the browser, cleans up on disconnect, and sends periodic keep-alives:

```ts title="src/app/chat-messages/controllers/stream-ai-message.controller.ts"
import { type Request, type RequestHandler } from "@warlock.js/core";
import { chatMessageEventBus, type AIStreamEvent } from "../events/chat-message.event-bus";

export const streamAiMessageController: RequestHandler = async (request: Request, response) => {
  const aiMessageId = request.input("id");
  const sse = response.sse();

  const listener = (event: AIStreamEvent) => {
    if (event.type === "chunk") {
      sse.send("chunk", { chunk: event.chunk });
    } else if (event.type === "done") {
      sse.send("done", { model: event.model, usage: event.usage });
      sse.end();
    } else if (event.type === "error") {
      sse.send("error", { message: event.message });
      sse.end();
    }
  };

  chatMessageEventBus.subscribe(aiMessageId, listener);
  sse.onDisconnect(() => chatMessageEventBus.unsubscribe(aiMessageId, listener));

  const keepAlive = setInterval(() => sse.comment("ping"), 25_000);
  sse.onDisconnect(() => clearInterval(keepAlive));
};
```

Three things to notice:

1. The listener decides which SSE event name to emit (`chunk`, `done`, `error`).
2. `sse.onDisconnect(...)` is registered **twice** — once to unsubscribe from the event bus, once to clear the keep-alive interval. Both fire on client drop.
3. Background jobs writing to a dead socket are a silent no-op — the framework swallows further `sse.send(...)` calls after disconnect.

### Streaming a Warlock AI agent

If you're producing the events yourself with `@warlock.js/ai`, the producer side looks like:

```ts
import { ai } from "@warlock.js/ai";

const sse = response.sse();
const run = await chatAgent.stream(request.input("message"));

for await (const event of run.events) {
  if (event.type === "text-delta") {
    sse.send("delta", { text: event.text });
  } else if (event.type === "done") {
    sse.send("done", { usage: event.usage });
    sse.end();
  }
}
```

See `@warlock.js/ai/skills/subskills/agent.md` for the agent's event surface.

## Cookies

```ts
response.cookie("theme", "dark", { httpOnly: true, secure: Application.isProduction });
response.cookie("preferences", { lang: "en", notifications: true });  // objects auto-JSON-stringified
response.clearCookie("session_id");
```

Cookie options come from Fastify's `@fastify/cookie` (`CookieSerializeOptions`): `domain`, `path`, `secure`, `httpOnly`, `sameSite`, `maxAge`, `expires`, `signed`.

The framework merges your options on top of the global defaults from `config.get("http.cookies.options")`. The reference project sets:

```ts title="src/config/http.ts"
import { Application, env } from "@warlock.js/core";

const httpConfigurations = {
  cookies: {
    secret: env("COOKIE_SECRET", "super-secret-key-change-me"),
    options: {
      httpOnly: true,
      secure: Application.isProduction,
      path: "/",
    },
  },
};
```

`secure: Application.isProduction` so cookies work in dev (HTTP) and prod (HTTPS) without changing per-call code.

## Headers

```ts
response.header("X-Total-Count", "42");
response.header("Cache-Control", "no-cache");

response.headers({ "X-A": "1", "X-B": "2" });   // batch set

response.removeHeader("X-Internal");
const ct = response.getHeader("Content-Type");
const all = response.getHeaders();
```

`header(name, value)` chains — you can call it multiple times before the terminal helper.

## Status code (escape hatch)

Most of the time the helper carries the status. When you genuinely need to set one by hand (custom 418, a 207 multi-status for batch jobs):

```ts
return response.setStatusCode(207).send({ results });
```

`send(data, statusCode?)` is the underlying terminal — every helper above is sugar over it. Avoid calling it directly when a helper exists; the helper's semantic is what makes the controller readable.

## Patterns by use-case

### Created with a Location header

```ts
const product = await createProductService(request.validated());

response.header("Location", `/products/${product.id}`);

return response.successCreate({ product });
```

### Conditional 404 vs 200

```ts
const product = await getProductService(request.input("id"));

if (!product) {
  return response.notFound({ error: t("product.notFound") });
}

return response.success({ product });
```

### Heavy file with cache

```ts
return response.sendFile("/var/data/report.pdf", {
  cacheTime: 60 * 60,
  inline: true,
  filename: "report.pdf",
});
```

### Synthetic event stream (line-by-line)

```ts
const stream = response.stream("text/plain");

for (const line of generateLines()) {
  stream.send(line + "\n");
}

stream.end();
```

### Setting then sending

```ts
response.header("X-Cache", "MISS");
response.cookie("seen_at", new Date().toISOString());

return response.success({ data });
```

## Gotchas

- **Don't manually call `send` with a hand-rolled status when a helper exists.** `response.send(data, 404)` works, but loses the error-event integration and reads worse than `response.notFound(data)`. The helpers are the public API.
- **First helper wins.** Two terminal calls log a warning; only the first one writes to the wire. If you find yourself wanting "send-or-fail-quietly" logic, branch with an `if`.
- **`stream()` and `sse()` consume the response.** No `success(...)` afterward — call `stream.end()` / `sse.end()` to finish. Background work writing after `end()` is silently dropped.
- **Set `secure: Application.isProduction` for cookies.** Hard-coding `secure: true` breaks dev (HTTP); `secure: false` is a security smell in prod. Read it from the application flag.
- **`response.success()` with no arg returns `{ success: true }`.** If you want truly empty, use `response.noContent()` (204).
- **`sendFile(path)` checks file existence and returns 404 if missing.** You don't need to pre-`fs.access` it.
- **SSE keep-alives matter.** Most proxies (nginx, Cloudflare) close idle connections after 30–60s. Send a `sse.comment("ping")` every 25 seconds for long-lived streams.

## See also

- **[Controllers](./03-controllers.md)** — where `response.<helper>()` is called from.
- **[HTTP request](./http-request.md)** — the other half of the handler signature.
- **[Middleware](./middleware.md)** — short-circuit a request by returning a response from middleware.
