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

With the default `toInput`, `input` must be a **string**. Any other value (an array of image or PDF content parts, an object, a number) receives `400 { "error": "invalid_input" }` before the executable runs, so a client cannot push raw multimodal content past attachment policy and input guardrails. To accept a structured body, map it yourself with `toInput`.

Set `maxInputChars` to cap the length of a string input; longer input receives `413 { "error": "input_too_large" }`:

```ts
ai.serve(agent, { maxInputChars: 8_000 });
```

Requests are limited to **1 MiB (1,048,576 bytes)** by default. An oversized request receives `413 { "error": "payload_too_large" }` before the executable runs. Set `maxBodyBytes` only when the endpoint has a deliberate larger-payload policy:

```ts
ai.serve(agent, { maxBodyBytes: 256 * 1024 }); // 256 KiB
```

## SSE response

A valid request responds `200` with `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, and `connection: keep-alive`. It emits one SSE frame per client-safe stream event, a final `result` frame, and terminal `data: [DONE]`:

```text
event: agent.trip.streaming
data: {"type":"agent.trip.streaming","delta":"Refund"}

event: agent.completed
data: {"type":"agent.completed"}

event: result
data: {"text":"Your refund is on its way.","data":{"refunded":true}}

data: [DONE]
```

### What the client receives

A run's full event stream carries the system prompt, tool inputs and outputs, reasoning, usage and raw error details. By default (`events: "safe"`) `serve` sends only what the user is meant to read:

| Event                                                                                                           | Frame data        |
| --------------------------------------------------------------------------------------------------------------- | ----------------- |
| `agent.trip.streaming`, `supervisor.agent.streaming`, `supervisor.ack.streaming`, `orchestrator.turn.streaming` | `{ type, delta }` |
| `agent.completed`, `supervisor.completed`, `orchestrator.turn.completed`, `orchestrator.turn.failed`            | `{ type }`        |
| `agent.error`, `supervisor.error`                                                                               | `{ type, error }` |

Every other event (tool calls, reasoning, usage, trip records, routing) is not sent. The `result` frame is `{ text, data, error }`: the run report is left out.

Choose another set with `events`, and another result shape with `toResult`:

```ts
ai.serve(agent, { events: ["agent.trip.streaming", "agent.tool.calling"] }); // listed types, verbatim
ai.serve(agent, {
  events: (event) => (event.type === "agent.trip.streaming" ? { delta: event.delta } : undefined),
  toResult: (result) => ({ answer: (result as { text?: string }).text }),
});
```

A function returns the frame data for an event, or `undefined` to drop it. For a trusted internal consumer that needs the whole trace, `events: "all"` sends every event verbatim (and raw error messages), and `toResult: (result) => result` sends the whole result.

### Errors

Errors reach the client as `{ code, message, reference }`: `code` is the `AIError` code (`"PROVIDER_TIMEOUT"`, `"GUARDRAIL_VIOLATION"`, …, or `"INTERNAL_ERROR"`), `message` is a fixed text for that kind of failure that says what to do next, and `reference` is a short id. The full error, with its original message and context, is logged on the server (module `ai.serve`, action `run.failed`) under the same reference, so a user can quote it to support.

An error inside the run appears on the `agent.error` frame and on `result.error`. If the stream itself fails, the handler emits an `error` event with `{ "error": { code, message, reference } }` and closes the stream.

A request that fails before the stream starts receives a JSON status instead: `500 { "error": "internal_error" }` when a callback (`authorize`, `toInput`, `session.createId`, `session.loadHistory`) throws, or the status and code of a `ServeHttpError` it throws:

```ts
import { ServeHttpError } from "@warlock.js/ai";

ai.serve(agent, {
  session: {
    createId: async (req) => {
      const sessionId = await sessionIdFromCookie(req);
      if (!sessionId) throw new ServeHttpError(401, "unauthorized");
      return sessionId;
    },
  },
});
```

## Bearer auth

Set `authToken` to require `Authorization: Bearer <token>` on every request. Missing or invalid credentials receive `401 { "error": "unauthorized" }` before the body is read:

```ts
ai.serve(agent, { authToken: process.env.AGENT_TOKEN });
```

For equal-length bearer values, token comparison is timing-safe. This is a shared-secret guard, not a replacement for application identity and authorization. Every response also carries `x-content-type-options: nosniff`, `x-frame-options: DENY`, and `referrer-policy: no-referrer`.

For application identity, use `authorize`. It receives the request and returns (or resolves to) `true` to run it, `false` for `401 { "error": "unauthorized" }`; throw a `ServeHttpError` for another status:

```ts
ai.serve(agent, { authorize: async (req) => Boolean(await userFromSession(req)) });
```

Every run spends provider credits, so an endpoint without `authToken` or `authorize` is open to anyone who can reach it. When `NODE_ENV` is `production`, such a handler logs a one-time warning (module `ai.serve`, action `auth.missing`). Set `public: true` to declare an open endpoint on purpose and silence it.

## Server-owned sessions and execution options

`serve` owns the execution session context. By default it creates a fresh UUID for every request and supplies no history. Configure `session` to derive an ID and load history from trusted server-side state. Both callbacks may be async; `serve` awaits them before the run starts.

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

| Option          | Type                                                        | Default                   | Purpose                                                                   |
| --------------- | ----------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `authToken`     | `string`                                                    | -                         | Require `Authorization: Bearer <token>`, else `401`.                      |
| `authorize`     | `(req) => boolean \| Promise<boolean>`                      | -                         | Decide per request; `false` answers `401`.                                |
| `public`        | `boolean`                                                   | `false`                   | Declare an open endpoint; silences the production warning.                |
| `toInput`       | `(body) => TInput`                                          | `body.input` (a string)   | Map parsed JSON to executable input; non-string default input gets `400`. |
| `maxInputChars` | `number`                                                    | no limit                  | Maximum string input length; longer input gets `413`.                     |
| `toOptions`     | `(context: ServeRequestContext) => Record<string, unknown>` | `() => ({})`              | Add trusted per-call stream options.                                      |
| `session`       | `ServeSessionOptions`                                       | Fresh UUID and no history | Own the request session ID and optional server-loaded history.            |
| `maxBodyBytes`  | `number`                                                    | `1_048_576` (1 MiB)       | Maximum JSON request size; oversized bodies get `413`.                    |
| `maxConcurrent` | `number`                                                    | no limit                  | Runs in flight at once; a request over the limit gets `503 busy`.         |
| `events`        | `"safe" \| "all" \| string[] \| (event) => unknown`         | `"safe"`                  | Which stream events reach the client, and their shape.                    |
| `toResult`      | `(result) => unknown`                                       | `{ text, data, error }`   | Shape of the final `result` frame.                                        |

## Client disconnects cancel the run

Each request gets an `AbortSignal` in `ServeRequestContext` and in the options passed to `stream()`. If the client aborts its request or closes the response before the stream finishes, `serve` aborts that signal and stops writing SSE frames. Forward it through work added in `toOptions` so downstream work can stop promptly:

```ts
toOptions: ({ signal }) => ({ signal });
```

Cancellation is cooperative: the executable and its provider or dependencies must honor the signal to stop in-flight work.

## What `serve` enforces, and what it does not

`serve` enforces the request body cap (`maxBodyBytes`), string input (and `maxInputChars` when set), optional bearer auth or `authorize`, the optional `maxConcurrent` cap, the client-safe event set, and abort on client disconnect. It applies no idle, header, or overall run timeout, and no per-client rate limit. Put those limits on the `node:http` server (`headersTimeout`, `requestTimeout`), a reverse proxy, or your own middleware.

Output guardrails apply to the stream: an agent with `ai.guardrail({ output: [...] })` holds each trip's text until the detectors approve it, so redacted or blocked text never reaches the client. See [Guardrails](/v/latest/ai/reliability/guardrails/#streaming).

## Durable multi-turn serving

For durable multi-turn serving, pair `serve` with an [orchestrator](/v/latest/ai/orchestration/run-orchestrator/). Configure `session.createId` and `session.loadHistory` from trusted server-side state; the orchestrator then loads and checkpoints its own session state while `serve` streams the turn. Because each POST is independent, add a session lock (or rely on orchestrator snapshot/checkpoint discipline) when one session can receive concurrent turns.

## Building blocks

For a custom sink such as another HTTP framework, WebSocket, or test harness, use the transport-agnostic helpers directly:

- `streamToSSE(stream, options?)` converts a primitive event stream into frame strings: event frames, `result` (or `error`), then `[DONE]`. Without `options` it sends every event and the whole result verbatim, so use it as-is only for trusted consumers; `options.mapEvent` (return `undefined` to drop an event), `options.mapResult` and `options.mapError` project the frames.
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
