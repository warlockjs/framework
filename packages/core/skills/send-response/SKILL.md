---
name: send-response
description: 'Send HTTP responses via @warlock.js/core''s Response helpers — success/error variants, status helpers, redirects, files, streams, and SSE. Picking the right helper carries the HTTP semantic without manual status codes. Triggers: `response.success`, `response.successCreate`, `response.notFound`, `response.forbidden`, `response.badRequest`, `response.sendFile`, `response.stream`, `response.sse`, `response.replay`, `ResourceNotFoundError`, `ForbiddenError`, `request.cookie`, `request.hasCookie`, `CookieJarUnavailableError`; "return a 201 from a controller", "send a file", "stream Server-Sent Events", "throw HTTP-shaped errors from services"; typical import `import type { RequestHandler, Response } from "@warlock.js/core"`. Skip: controller shape — the `create-controller` topic; route registration — the `register-route` topic; competing patterns: hand-rolled status codes via `reply.code(404).send(...)`, raw Fastify reply.'
---

# Warlock — send a response

`Response` is the helper-rich object passed to every controller. Pick the helper that matches the outcome — the helper carries the status code, so you almost never set one by hand.

## The shape

```ts
import type { RequestHandler } from "@warlock.js/core";

export const myController: RequestHandler = async ({ request, response }) => {
  // …choose a helper and return it
  return response.success({ data: "…" });
};
```

Always `return response.<helper>(...)`. The return value drives Fastify's send.

## Success helpers

| Method                         | Status | When                             |
| ------------------------------ | ------ | -------------------------------- |
| `response.success(data?)`      | 200    | normal read / update             |
| `response.successCreate(data)` | 201    | resource created (POST)          |
| `response.noContent()`         | 204    | delete succeeded, no body needed |

```ts
return response.success({ products: [...] });

return response.successCreate({ product });

return response.noContent();
```

`response.success()` (no argument) defaults to `{ success: true }` — useful for void operations that still need a body.

## Client-error helpers

| Method                         | Status | When                                 |
| ------------------------------ | ------ | ------------------------------------ |
| `response.badRequest(data)`    | 400    | malformed or invalid input           |
| `response.unauthorized(data?)` | 401    | missing/invalid auth token           |
| `response.forbidden(data?)`    | 403    | authenticated but not allowed        |
| `response.notFound(data?)`     | 404    | record missing                       |
| `response.conflict(data?)`     | 409    | uniqueness violation, state conflict |

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
return response.redirect("/login"); // 302
return response.redirect("/new-home", 301); // permanent
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

`response.xml(string | XMLable, statusCode?)` sends `application/xml` — pass a raw XML string, or anything with a `toXML(): string` method (structural, so core never depends on `@warlock.js/sitemap`). This is for BOUNDED values only: a raw string, or a single `@warlock.js/sitemap` `Sitemap` under the sitemaps.org 50,000-URL / 50MB ceiling. `SitemapIndex` has no `toXML()` — it is the streaming path for larger URL sets and does not fit in one response body. It writes shards plus a master index as FILES via `saveTo`/`publish`, and those files are served directly rather than passed through `xml()`. In Warlock web this is the `web.sitemap` config: `enabled`, `outputDir` (default `storagePath("sitemap")`), and `path` (default `/sitemap.xml`) — the app serves the generated files from `outputDir` at that route, it never builds a `SitemapIndex` response inline.

## Streams

```ts
const stream = response.stream("text/plain");

stream.send("first chunk\n");
stream.send("second chunk\n");
stream.end();
```

`response.stream(contentType?, { retainChunks? })` returns a controller with `.send(chunk)`, `.render(reactNode)`, `.end()`, and an `.ended` getter, plus `await .write(chunk)` / `await .drain()` (wait for a slow client; `false` once it left), `.backpressured`, `.signal` (aborted on client disconnect) and `.onDisconnect(fn)`. Use for large dynamic payloads where buffering would blow memory; loop on `await stream.write(chunk)` when the producer can outrun the client. Calling `.send()` after `.end()` throws; after a client disconnect it is a silent no-op. Written chunks are not kept on `response.body` unless `retainChunks` asks for a tail.

## Throwing HTTP errors

Most of the time, controllers don't need to _choose_ an error helper — they throw from the service layer instead. The request middleware (`http/middleware/inject-request-context.ts`) catches every `HttpError` subclass and produces the matching response. The error classes mirror the helpers above:

```ts
import {
  ResourceNotFoundError, // 404
  UnAuthorizedError, // 401
  ForbiddenError, // 403
  BadRequestError, // 400
  ConflictError, // 409
  NotAcceptableError, // 406
  NotAllowedError, // 405
  ServerError, // 500
  HttpError, // base class — `new HttpError(status, message, payload?)` for arbitrary codes
} from "@warlock.js/core";

throw new ResourceNotFoundError("product.notFound");
throw new ForbiddenError("permission.denied", { resource: "product", id });
throw new ConflictError("user.duplicateEmail");
```

A program that must not load the framework (a standalone helper, a worker
bundle) imports the same classes from `@warlock.js/core/errors`, which pulls in
nothing else. Domain errors that cannot extend `HttpError` get a status at the
edge through `http.errorMapper` (`(error, request) => ({ status, message?, payload? }) | undefined`);
anything unmapped and not an `HttpError` answers an opaque `500`.

Each class takes `(message, payload?)`. The framework keeps the optional
detail nested under `payload`:

```json
{
  "error": "Product not found",
  "payload": { "id": 42 }
}
```

Every unhandled error response also carries
`Cache-Control: private, no-store`, regardless of status. The floor is
applied once at the shared error funnel, so API-route errors cannot be stored
and replayed across users. In development mode, the stack trace is included
too.

Pick the class, throw from the service or use-case, and forget about response shaping at the call site. The controller stays focused on the success path:

```ts
export const getProductController: RequestHandler = async ({ request, response }) => {
  const product = await getProductService(request.input("id")); // throws ResourceNotFoundError on miss
  return response.success({ product });
};
```

See the `create-controller` topic for the "throw from service, return from controller" pattern.

## Server-Sent Events

```ts
const sse = response.sse();

sse.send("tick", { count: 1 }); // event name, data, optional id
sse.send("tick", { count: 2 }, "msg-2"); // third arg is the SSE event id
sse.comment("keep-alive"); // invisible to the client, prevents timeout
sse.end();
```

For streams that can outrun the client (terminals, log tails, big feeds), `await sse.write(event, data)` instead of `send()`: it waits until the client has caught up and resolves `false` once the client is gone. `sse.drain()` waits without sending, `sse.backpressured` reports a backed-up transport, and `sse.signal` aborts on disconnect. Sent events are not kept on `response.body`; `response.sse({ retainEvents: n })` keeps the last `n` for logging/tests (default 0).

`response.sse()` returns a controller with `send(event, data, id?)`, `comment(text)`, `end()`, `onDisconnect(handler)`, and an `.ended` getter. The `send` signature is positional — `event` name first, then the `data` payload (JSON-stringified for you), then an optional event `id`. Line breaks (and NUL) in the event name and `id` are removed, so values built from user input cannot inject SSE fields. After the client disconnects, `send`/`comment` become silent no-ops and any `onDisconnect` handlers fire (a handler that throws is logged; the rest still run) — register cleanup there:

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
response.cookie("prefs", { theme: "dark" });

// Plain string — use raw: true for session tokens / opaque IDs that
// shouldn't be JSON-quoted on the wire
response.cookie("session_id", "abc.def.ghi", { raw: true });

// Deliberately readable by client-side JS — opt out explicitly
response.cookie("theme", "dark", { httpOnly: false });

response.clearCookie("session_id");
```

`response.cookie()` JSON-stringifies the value by default so structured cookies round-trip cleanly with `request.cookie(name)`. Pass `{ raw: true }` to skip the wrapping for plain-string cookies (session tokens, opaque IDs, simple flags). The `CookieOptions` type extends Fastify's `CookieSerializeOptions` with the `raw` flag.

### Secure by default (4.10.0)

Every response cookie gets `httpOnly: true`, `sameSite: "lax"`, and `secure: true` outside development, unless you override them:

| Flag       | Default                       | Why it's the default                                      |
| ---------- | ----------------------------- | --------------------------------------------------------- |
| `httpOnly` | `true`                        | without it, any injected script can read the cookie       |
| `sameSite` | `"lax"`                       | without it, the cookie rides along on cross-site requests |
| `secure`   | `true`, except in development | without it, the cookie travels in cleartext               |

`secure` is relaxed in development only — browsers drop a `Secure` cookie over plain http, which would silently break every local login. It stays on in test and staging.

Precedence, lowest to highest: **framework defaults → `http.cookies.options` → the per-call `options` argument.** Set an app-wide policy in config, override per cookie when a specific one genuinely needs different treatment.

### Reading cookies back — `request.cookie()` / `request.hasCookie()` throw when the jar is unavailable (5.15.0)

`request.cookie(name)` and `request.hasCookie(name)` are a deliberate
by-name assertion — "this cookie should be readable here" — so when
`@fastify/cookie` is not registered on the Fastify instance, both now
**throw `CookieJarUnavailableError`** naming the missing cookie, instead of
silently returning `undefined` / `false`. Register the plugin (see core's
`http/plugins.ts`) before reading cookies by name.

`request.cookies` (the plain getter, no by-name assertion) is unchanged and
stays lenient — it returns `{}` when the jar is unavailable, because the
framework's own opportunistic reads (e.g. locale resolution) must not throw
on a request that simply has no jar.

These are the flags whose absence never fails a test and is fatal in production: the app works perfectly and is simply insecure. Opting out is now explicit and visible in review.

These mutate the response in place; chain or call before the final `return response.<helper>()`.

### `Content-Security-Policy` (5.12.0)

Opt in via `http.csp.enabled` in `src/config/http.ts` (see
the `configure-app` topic for the full shape).
When enabled, every response through the shared request funnel
(`http/middleware/inject-request-context.ts`, the same seam that stamps
`X-Request-Id`) gets a `Content-Security-Policy` header — `-Report-Only`
instead when `reportOnly: true` — built from the framework's default policy
merged with your `directives`, with the current request's CSP nonce always
appended to `script-src`. It is a no-op, and adds no header, while `http.csp`
is unset — every existing app is unaffected until it opts in.

A route can still override it — call `response.header("Content-Security-Policy", ...)`
from a controller or middleware that runs after the funnel, and your value
wins, same as any other header.

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
- **Don't hand-set `secure: Application.isProduction` any more.** Since 4.10.0 `secure` already tracks the environment (on everywhere except development). Writing it by hand narrows the default — it would also switch `secure` off in test and staging.
- **Streaming and SSE consume the response.** No `response.success(...)` afterward — call `stream.end()` / `sse.end()` to finish.

## See also

- The `create-controller` topic — what calls `response.<helper>()` from.
- The `register-route` topic — wiring the controller to a URL.
- The `warlock-conventions` topic — when to use HTTP error helpers vs `throw`.

## Stream wire format, headers and synchronous producers

```ts
const sse = response.sse({
  headers: { "Cache-Control": "private, no-store" },
  maxQueuedBytes: 1024 * 1024,
  onOverflow: "disconnect",
});
sse.send(undefined, { status: "ready" }); // no event field: EventSource.onmessage
sse.enqueue(undefined, "already serialized\nsecond line", undefined, { raw: true });
```

The positional `send(event, data, id?, options?)` and `write(...)` calls still work.
An undefined event omits `event:`. Data is JSON by default; `{ raw: true }` requires
string data and emits one safe `data:` line per input line. Event/id line breaks
and NUL are removed, so raw data cannot inject event fields.

Both `sse({ headers })` and `stream(contentType, { headers })` apply caller headers
before flushing. Cache-Control keeps the safe stream default unless explicitly
set in options.headers; a pre-existing global cache header does not override it.
Protocol headers are protected: Content-Length is removed, SSE fixes its content
type and removes caller Transfer-Encoding, and graceful drain forces Connection: close.

Use synchronous `enqueue()` for event-bus producers. It returns false when closed
or overflowing. The byte cap includes queued UTF-8 data and Node's unsent buffer.
It defaults to 1 MiB for enqueue; `onOverflow: "disconnect"` aborts the signal and
runs disconnect cleanup, while `"drop"` rejects the newest chunk so the producer
can schedule a resync. Every drop increments controller.dropped, including drops
from send/write/render/comments. write() still returns false only when ended or
disconnected; true means ready to continue, so inspect dropped when using drop
mode. A single event exceeding the byte cap is always rejected (and disconnects
in the default overflow mode). Choosing maxQueuedBytes also bounds send/write/render and
SSE comments; using enqueue switches subsequent writes on that controller into
bounded mode. `drain()` waits for both queues. `end()` stops accepting new output
and flushes already accepted queued output before ending. Without a byte cap or
enqueue, send/write retain their existing behavior.

Graceful HTTP/1 drain tracks raw responses, including hijacked replies. Before
headers flush it adds Connection: close; already-streaming replies finish and
then have their idle connections reaped. A hand-written hijacked writer that sets
its own Connection header must preserve close during drain rather than overwrite
it with keep-alive. Headers already on the wire cannot be changed.
