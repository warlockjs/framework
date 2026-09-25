---
title: "Serve over SSE"
description: Safely expose a streamable AI primitive as a Node HTTP Server-Sent Events endpoint.
sidebar:
  order: 5
  label: "Serve over SSE"
---

`ai.serve` turns any streamable primitive - an agent, supervisor, or orchestrator - into a `node:http` request handler that streams its run as Server-Sent Events (SSE). It is the production-serving primitive: it supplies the streaming response, safe request defaults, and optional bearer-token protection without hand-writing a transport.

It is distinct from [`ai.mcp.serve`](/v/latest/ai/tools/connect-mcp/#expose-a-warlock-agent-as-an-mcp-server), which exposes a primitive as an MCP server. `ai.serve` is a plain `text/event-stream` HTTP endpoint.

## The shape

```ts
import { createServer } from "node:http";
import { ai } from "@warlock.js/ai";

const agent = ai.agent({ model, instructions: "Be helpful." });

createServer(ai.serve(agent, { authToken: process.env.AGENT_TOKEN })).listen(8787);
```

`ai.serve(executable, options?)` returns a `(req, res) => void` handler. Pass it directly to `createServer` or mount it in an existing router. Any executable whose `stream(input, options)` returns the framework stream shape qualifies; agents, supervisors, and orchestrators already do.

## Request and size contract

The handler accepts **POST only**; another method receives `405 { "error": "method_not_allowed" }`. The body must be a JSON object, and the default input is `body.input`:

```jsonc
{ "input": "Refund order #1841, it arrived broken." }
```

The JSON body is untrusted input. In particular, `sessionId` and `history` fields in it are ignored: a client cannot select another conversation or inject prior turns. Invalid JSON receives `400 { "error": "invalid_json" }`; an empty body parses as `{}`.

Requests are limited to **1 MiB (1,048,576 bytes)** by default. An oversized request receives `413 { "error": "payload_too_large" }` before the executable runs. Set `maxBodyBytes` only when the endpoint has a deliberate larger-payload policy:

```ts
ai.serve(agent, { maxBodyBytes: 256 * 1024 }); // 256 KiB
```

## SSE response

A valid request responds `200` with `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, and `connection: keep-alive`. It emits one SSE frame per stream event, a final `result` frame, and terminal `data: [DONE]`:

```text
event: agent.trip.streaming
data: {"type":"agent.trip.streaming","delta":"Refund"}

event: result
data: {"data":{"refunded":true}}

data: [DONE]
```

If streaming throws, the handler emits an `error` event containing `{ "message": "..." }` and closes the stream.

## Bearer auth

Set `authToken` to require `Authorization: Bearer <token>` on every request. Missing or invalid credentials receive `401 { "error": "unauthorized" }` before the body is read:

```ts
ai.serve(agent, { authToken: process.env.AGENT_TOKEN });
```

For equal-length bearer values, token comparison is timing-safe. This is a shared-secret guard, not a replacement for application identity and authorization. Every response also carries `x-content-type-options: nosniff`, `x-frame-options: DENY`, and `referrer-policy: no-referrer`.

## Server-owned sessions and execution options

`serve` owns the execution session context. By default it creates a fresh UUID for every request and supplies no history. Configure `session` to derive an ID and load history from trusted server-side state.

```ts
ai.serve(orchestrator, {
  authToken: process.env.AGENT_TOKEN,

  session: {
    createId: (req) => sessionIdForAuthenticatedRequest(req),
    loadHistory: ({ sessionId }) => historyStore.load(sessionId),
  },

  toInput: (body) => body.message,

  toOptions: ({ req, sessionId, history, signal }) => ({
    tenantId: tenantForAuthenticatedRequest(req),
    traceSession: sessionId,
    historyCount: Array.isArray(history) ? history.length : 0,
    signal,
  }),
});
```

`toInput` receives the parsed request body and defaults to `(body) => body.input`. `toOptions` receives trusted request context instead:

```ts
type ServeRequestContext = {
  req: IncomingMessage;
  sessionId: string;
  history: unknown;
  signal: AbortSignal;
};
```

The handler always supplies its `sessionId`, `history`, and `signal` to `stream()` after `toOptions` runs, so those execution-critical values remain server-owned.

### Migrate body-based `toOptions`

Move session state out of the body and into `session`; use the callback context for additional trusted options:

```ts
// Before: client controls the session and history.
toOptions: (body) => ({ sessionId: body.sessionId, history: body.history })

// After: the server selects them.
session: {
  createId: (req) => sessionIdForAuthenticatedRequest(req),
  loadHistory: ({ sessionId }) => historyStore.load(sessionId),
},
toOptions: ({ sessionId, history }) => ({ sessionId, history })
```

### Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `authToken` | `string` | - | Require `Authorization: Bearer <token>`, else `401`. |
| `toInput` | `(body) => TInput` | `body.input` | Map parsed JSON to executable input. |
| `toOptions` | `(context: ServeRequestContext) => Record<string, unknown>` | `() => ({})` | Add trusted per-call stream options. |
| `session` | `ServeSessionOptions` | Fresh UUID and no history | Own the request session ID and optional server-loaded history. |
| `maxBodyBytes` | `number` | `1_048_576` (1 MiB) | Maximum JSON request size; oversized bodies get `413`. |

## Client disconnects cancel the run

Each request gets an `AbortSignal` in `ServeRequestContext` and in the options passed to `stream()`. If the client aborts its request or closes the response before the stream finishes, `serve` aborts that signal and stops writing SSE frames. Forward it through work added in `toOptions` so downstream work can stop promptly:

```ts
toOptions: ({ signal }) => ({ signal })
```

Cancellation is cooperative: the executable and its provider or dependencies must honor the signal to stop in-flight work.

## Durable multi-turn serving

For durable multi-turn serving, pair `serve` with an [orchestrator](/v/latest/ai/orchestration/run-orchestrator/). Configure `session.createId` and `session.loadHistory` from trusted server-side state; the orchestrator then loads and checkpoints its own session state while `serve` streams the turn. Because each POST is independent, add a session lock (or rely on orchestrator snapshot/checkpoint discipline) when one session can receive concurrent turns.

## Building blocks

For a custom sink such as another HTTP framework, WebSocket, or test harness, use the transport-agnostic helpers directly:

- `streamToSSE(stream)` converts a primitive event stream into frame strings: event frames, `result` (or `error`), then `[DONE]`.
- `encodeSSE({ event?, data, id? })` encodes one SSE frame and splits multi-line data as required by the SSE format.

```ts
import { streamToSSE } from "@warlock.js/ai";

for await (const frame of streamToSSE(agent.stream("Hi"))) {
  res.write(frame);
}
```

## Related

- [Run orchestrator](/v/latest/ai/orchestration/run-orchestrator/) - durable multi-turn serving.
- [Connect MCP](/v/latest/ai/tools/connect-mcp/) - the MCP-server counterpart.
- [Handle errors](/v/latest/ai/reliability/handle-errors/) - how run errors surface.
