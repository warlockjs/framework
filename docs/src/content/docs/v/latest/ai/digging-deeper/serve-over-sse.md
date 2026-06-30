---
title: "Serve over SSE"
description: ai.serve in depth — turn an agent, supervisor, or orchestrator into a node:http handler that streams its run to the client as Server-Sent Events, with bearer auth and request/option mapping.
sidebar:
  order: 12
  label: "Serve over SSE"
---

`ai.serve` turns any streamable primitive — an agent, a supervisor, or an orchestrator — into a `node:http` request handler that streams its run to the client as **Server-Sent Events (SSE)**. It is the production-serving primitive (A3): you keep your model, prompt, and session logic in one executable, and `serve` exposes it over HTTP without you hand-writing the streaming, the headers, or the auth check.

It is distinct from [`ai.mcp.serve`](./connect-mcp#expose-a-warlock-agent-as-an-mcp-server), which exposes a primitive as an MCP server for other MCP clients. `ai.serve` exposes it as a plain HTTP SSE endpoint for any client that speaks `text/event-stream`.

## The shape

```ts
import { createServer } from "node:http";
import { ai } from "@warlock.js/ai";

const agent = ai.agent({ model, instructions: "Be helpful." });

createServer(ai.serve(agent, { authToken: process.env.AGENT_TOKEN })).listen(8787);
```

`ai.serve(executable, options?)` returns a `(req, res) => void` handler. Pass it straight to `createServer`, or mount it inside an existing router. The `executable` need only satisfy `ServableExecutable` — anything whose `stream(input, options)` returns the framework's stream shape qualifies, which every agent, supervisor, and orchestrator already does.

## The request contract

The handler accepts **POST only**; any other method gets `405 { "error": "method_not_allowed" }`. The body is parsed as JSON, and by default the executable's input is `body.input`:

```jsonc
// POST / with Content-Type: application/json
{
  "input": "Refund order #1841, it arrived broken.",
  "sessionId": "user-42",        // forwarded as a stream option (for orchestrators)
  "history": [/* prior turns */] // forwarded as a stream option
}
```

By default `sessionId` and `history` are passed straight through as per-call stream options, so an orchestrator turn resumes the right session. A body that is not valid JSON gets `400 { "error": "invalid_json" }`. An empty body parses to `{}`.

## The response: an SSE stream

On a valid request the handler replies `200` with `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, and `connection: keep-alive`, then streams frames:

1. **One frame per stream event**, named by the event's `type` — e.g. `event: agent.trip.streaming`, with the full event object as JSON `data`.
2. **A final `result` frame** carrying the run's resolved result (the same value `stream.result` resolves to).
3. **A terminal `data: [DONE]` frame** the client watches for to stop reading.

```text
event: agent.trip.streaming
data: {"type":"agent.trip.streaming","delta":"Refund"}

event: agent.trip.completed
data: {"type":"agent.trip.completed"}

event: result
data: {"data":{"refunded":true},"usage":{"totalTokens":312}}

data: [DONE]
```

If the run throws while streaming, an `event: error` frame is emitted with `{ "message": "..." }` before the stream closes — `execute()`-style errors never crash the handler.

A minimal browser client:

```ts
const res = await fetch("/", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ input: "Hello" }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  if (chunk.includes("[DONE]")) break;
  // parse `event:` / `data:` lines as they arrive
}
```

## Bearer auth

Set `authToken` and every request must send `Authorization: Bearer <token>`, or it gets `401 { "error": "unauthorized" }` before the body is even read:

```ts
ai.serve(agent, { authToken: process.env.AGENT_TOKEN });
```

This is the same coarse token control the local dashboard uses — fold it in for any deploy that is reachable off-localhost. Every response (including the error responses) also carries hardening headers: `x-content-type-options: nosniff`, `x-frame-options: DENY`, and `referrer-policy: no-referrer`.

## Reshaping the request and options

Two hooks let the endpoint accept a request shape other than the default `{ input, sessionId?, history? }`:

```ts
ai.serve(orchestrator, {
  authToken: process.env.AGENT_TOKEN,

  // Map the parsed body to the executable's input.
  toInput: (body) => body.message,

  // Map the parsed body to per-call stream options.
  toOptions: (body) => ({
    sessionId: body.conversationId,
    history: body.turns,
  }),
});
```

`toInput` defaults to `(body) => body.input`. `toOptions` defaults to forwarding `sessionId` and `history` when present. Override both to bridge an existing API contract onto the executable without changing the executable itself.

### Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `authToken` | `string` | — | When set, requires `Authorization: Bearer <token>` on every request, else `401`. |
| `toInput` | `(body) => TInput` | `body.input` | Map the parsed JSON body to the executable's input. |
| `toOptions` | `(body) => Record<string, unknown>` | passes `sessionId` / `history` through | Map the parsed body to per-call stream options. |

## Durable multi-turn serving

`ai.serve` is stateless per request — it streams one run and ends. For durable multi-turn serving, pair it with an [orchestrator](./run-orchestrator): the client sends `sessionId` + `history` on each POST, the orchestrator loads and checkpoints session state, and `serve` streams the turn. Because each POST is an independent run, add your own session lock (or rely on the orchestrator's snapshot/checkpoint discipline) if a single session can receive concurrent turns.

## The building blocks

`serve` is assembled from two pure, transport-agnostic helpers you can use directly when you need a custom sink (a different HTTP framework, a WebSocket, a test harness):

- **`streamToSSE(stream)`** — an async generator that converts a primitive's event stream into SSE frame strings: a frame per event, then the `result` frame (or an `error` frame if `stream.result` rejects), then `[DONE]`.
- **`encodeSSE({ event?, data, id? })`** — encode a single SSE frame, splitting multi-line `data` across multiple `data:` lines per the SSE spec.

```ts
import { streamToSSE } from "@warlock.js/ai";

for await (const frame of streamToSSE(agent.stream("Hi"))) {
  res.write(frame);
}
```

## Related

- [Run orchestrator](./run-orchestrator) — pair with `serve` for durable, multi-turn HTTP serving.
- [Connect MCP](./connect-mcp) — `ai.mcp.serve`, the MCP-server counterpart to `ai.serve`.
- [Log AI calls](./log-ai-calls) — the events `serve` streams are the same lifecycle events you can subscribe to in-process.
- [Handle errors](./handle-errors) — how run errors surface; `serve` mirrors them onto an `error` SSE frame.
