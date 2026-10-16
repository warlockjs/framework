# WR-028 — SSE and stream responses: wire-format and cache-header control, bounded queues for synchronous producers

- **Packages:** `@warlock.js/core` 5.30.0 (`response.sse()`, `response.stream()`, graceful drain)
- **Classification:** feature request (no contract bug)
- **Found:** 2026-10-16, while moving an app's three long-lived event streams from hand-written raw writers onto the 5.30 `sse()`/`stream()` controllers.

## Expected

An app can serve a standard EventSource stream through the framework's controller, with the
retention, backpressure and disconnect handling 5.30 added, without changing its wire format or
cache policy and without converting every producer to `await write()`.

## Observed

1. **`sse()` always writes an `event:` line.** `writeMessage(event, data, id)` in
   `esm/http/response.mjs` emits `event: <name>` unconditionally, so there is no way to send the
   default `message` event that `EventSource.onmessage` receives. `data` is also always
   `JSON.stringify`-ed, so a producer that already has a serialized line cannot send it as-is.
2. **Cache headers are fixed.** `stream()` sets `Cache-Control: no-cache` and `sse()` sets
   `no-cache, no-store, must-revalidate`, both right before `raw.writeHead(...)` inside the call.
   An app that must send `Cache-Control: private, no-store` (for owner-only data) cannot override
   it, because headers are already flushed when the controller is returned.
3. **No bounded queue for synchronous producers.** The 5.30 controller exposes `write()` (awaitable),
   `drain()` and `backpressured`. A producer driven by a synchronous event-bus callback cannot await;
   it needs "queue up to N bytes, then disconnect the slow client" (or drop and send a resync marker).
   Every app has to build that queue itself.
4. **Graceful drain skips hijacked responses.** The 5.30 drain sends `Connection: close` on responses
   in flight, but a response whose reply was hijacked (`reply.hijack()` plus `raw.writeHead`) is not
   covered, so raw writers still have to set `Connection: close` themselves.

## Minimal reproduction

```ts
router.get("/events", (_request, response) => {
  const sse = response.sse();
  sse.send("x", { ok: true }); // wire: "event: x\ndata: {\"ok\":true}\n\n"; no event-less form
});

router.get("/raw", (_request, response) => {
  response.header("Cache-Control", "private, no-store");
  response.stream("text/event-stream"); // the header sent is "no-cache"
});
```

## Requests

- `sse.send(data, { event?, id? })`, or allow `event: undefined` to omit the line, plus a
  `raw: true` / string-data form that skips `JSON.stringify`.
- `stream(contentType, { headers })` / `sse({ headers })` (or "respect a Cache-Control already set
  on the response") so the caller controls caching.
- An optional bounded-buffer mode: `sse({ maxQueuedBytes, onOverflow: "disconnect" | "drop" })`
  with a synchronous `enqueue()` for producers that cannot await.
- Either cover hijacked raw responses in the drain, or document that hijacked writers must send
  `Connection: close` themselves.

## Impact and workaround

The app keeps three hand-written hijacked SSE writers (about 340 lines in total), each with its own 1 MB
byte queue, slow-client disconnect, `private, no-store` caching and `Connection: close`. Only
disconnect detection moved to the new `request.signal`.
