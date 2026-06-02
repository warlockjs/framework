---
title: "Attach request / trace context"
description: "Tag every log line for a request with the same requestId, userId, and trace fields so you can follow one request end-to-end."
sidebar:
  order: 2
  label: "Request / trace context"
---

When a request fans out across services and helpers, you want every line it produces to carry the same `requestId` (and maybe `userId`, `traceId`) so you can filter your logs down to one request. The logger's fourth argument — the **context** object — is exactly this; the trick is threading the same context through every call without retyping it.

## The context argument

Every level method takes structured context as its fourth argument. File and JSON channels persist it alongside the entry:

```ts
await log.info("orders", "checkout", "Order placed", {
  requestId: "req_9f2a",
  userId: 101,
  amount: 4999,
});
```

That works, but repeating `{ requestId, userId }` on every call is tedious and easy to forget. Wrap it once.

## A per-request helper

Build a small object at the start of each request that closes over its context and exposes the same level methods:

```ts title="src/request-logger.ts"
import { log } from "@warlock.js/logger";

/**
 * Bind a context object to every log call for the life of one request.
 * Returns the same level methods, each pre-filled with `base` context
 * (merged with any per-call context you pass).
 */
export function requestLogger(base: Record<string, unknown>) {
  const withBase = (context?: Record<string, unknown>) => ({
    ...base,
    ...context,
  });

  return {
    debug: (module: string, action: string, message: unknown, context?: Record<string, unknown>) =>
      log.debug(module, action, message as string, withBase(context)),
    info: (module: string, action: string, message: unknown, context?: Record<string, unknown>) =>
      log.info(module, action, message as string, withBase(context)),
    warn: (module: string, action: string, message: unknown, context?: Record<string, unknown>) =>
      log.warn(module, action, message as string, withBase(context)),
    error: (module: string, action: string, message: unknown, context?: Record<string, unknown>) =>
      log.error(module, action, message as string, withBase(context)),
    success: (module: string, action: string, message: unknown, context?: Record<string, unknown>) =>
      log.success(module, action, message as string, withBase(context)),
  };
}
```

Use it inside a request:

```ts title="src/middleware/logging.ts"
import { randomUUID } from "node:crypto";
import { requestLogger } from "../request-logger";

export function handleRequest(request, response) {
  const requestLog = requestLogger({
    requestId: request.headers["x-request-id"] ?? randomUUID(),
    userId: request.user?.id,
    method: request.method,
    path: request.url,
  });

  requestLog.info("http", "request", "Incoming request");

  // Pass `requestLog` down into your services. Every line they emit now
  // carries requestId + userId automatically.
  return runHandler(request, response, requestLog);
}
```

Now a single `requestId` filter in your log viewer surfaces the entire request.

## Timing the request

`log.timer` pairs naturally here — it returns an end-function that logs the elapsed duration. Merge the request context into the final entry:

```ts
const end = log.timer("http", `${request.method} ${request.url}`);

try {
  return await runHandler(request, response);
} finally {
  end({ requestId, status: response.statusCode });
  // → info "http" "GET /orders" "completed in 37ms" { durationMs: 37, requestId, status: 200 }
}
```

## Redact secrets that ride along in context

Once you're funneling request data into context, some of it is sensitive (auth headers, tokens). Set a redaction floor so those paths are scrubbed before any channel sees them:

```ts
log.configure({
  redact: {
    paths: ["context.headers.authorization", "context.token", "context.*.password"],
  },
});
```

See [Redaction](../advanced/01-redaction/) for the path syntax.

:::note[No ambient propagation yet]
This recipe threads context **explicitly** — you pass `requestLog` (or the context object) into the functions that need it. The logger does not yet auto-propagate context across `async` boundaries on its own, so there's no global "current request" you can read from anywhere. Threading it through is the reliable approach today.
:::

## See also

- [Your first log](../getting-started/03-your-first-log/) — the context argument and the `timer` helper
- [Redaction](../advanced/01-redaction/) — keep secrets out of the context you log
