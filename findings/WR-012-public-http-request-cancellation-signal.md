# WR-012: Public HTTP request cancellation signal

Package: `@warlock.js/core` 5.29.0; Node 22.13.0. This is a public API feature
request supported by installed declaration inspection. No runtime cancellation
leak or broken cancellation promise has been reproduced.

Expected addition: a request-lifetime `AbortSignal` on `Request` or `HttpContext`
that a controller can pass to long-running services. The public `Request`
declaration currently has no signal member or `AbortSignal` contract.
`RequestEvent` exposes only `executingMiddleware`, `executedMiddleware`,
`executingAction` and `executedAction`. Native request/reply objects are available
through the documented `baseRequest` and `baseResponse` escape hatches.

Impact: owner API start/status/cancel actions need a focused native adapter to
stop pending work after a real disconnect and compose that cancellation with a
deadline. Incoming request `close` alone is insufficient: normal completion of
request-body reading can produce it while a valid response is still running.

Evidence: the owned declaration probe
`.tmp/coordinator/framework-request-signal/reproduce.mjs` parses the installed
public declarations with TypeScript, verifies both escape hatches and the absent
signal/lifecycle event, and records exact source hashes in `evidence.json`.
Run it from the project root with
`node .tmp/coordinator/framework-request-signal/reproduce.mjs`. It starts no
server, makes no provider call and claims no observed process leak.

Application approach: listen to native request `aborted` and reply `close` when
the response has not finished, compose a bounded timeout, and remove listeners
when the handler finishes. The owner API HTTP integration is still being
qualified; the declaration probe does not establish runtime adapter correctness.

Request: provide a documented per-request signal with clear disconnect,
completion and timeout semantics, listener cleanup, and tests that distinguish
normal body completion from client disconnect. Keep it per invocation rather
than caching it on a reusable service. This is separate from SSE backpressure
(WR-006) and AI Workspace execution cancellation (WR-010).

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
