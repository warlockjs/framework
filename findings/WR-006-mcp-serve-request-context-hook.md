# WR-006: `ai.mcp.serve` gives tool handlers no request context, so apps keep their own MCP front end

Date: 2026-10-19
Package: @warlock.js/ai (MCP serving), 5.32.0
Observed in: Bureau B11 (the 5.32 upgrade that retired WR-001's stopgap)

**The gap.** WR-001's native results work, and Bureau now serves MCP through `ai.mcp.serve` with `mcpResult` /
`results: "native"`. But Bureau still has to keep a private front end in front of the framework server, because the
tool handlers can't see per-request context:

- the JSON-RPC request id, which Bureau uses as a replay and idempotency key for member tool calls;
- the authenticated caller (Bureau's per-member bearer and seat), which decides policy and custody;
- cancellation tied to that request id (`notifications/cancelled`).

So Bureau validates input exactly, assigns replay ids, checks capability hashes and applies the tool policy *before*
handing the call to `ai.mcp.serve` behind a second private bearer. That is two HTTP hops and duplicated protocol
handling for every member tool call.

**Request.** Pass a typed request context to tool handlers and serve hooks:

- `requestId`;
- the authenticated principal, from a pluggable `authenticate(request)` hook;
- an `AbortSignal` wired to MCP cancellation;
- an optional `beforeCall(context, tool, input)` hook that can refuse a call with a native error result.

Then an app can apply its own authority and replay rules inside the framework server, without a front end of its own.

**Bureau today:** this works, with no correctness problem. It's architecture and latency debt. Bureau will drop its
front end once a supported hook exists.
