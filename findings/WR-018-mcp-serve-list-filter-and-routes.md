# WR-018: ai.mcp.serve has no tools/list visibility filter and no extra HTTP routes (target 5.34)

Date: 2026-10-19 · Package: @warlock.js/ai, 5.33.0 · From: Bureau U2, adopting WR-006

**WR-006 works:** per-call `requestId`, `principal`, `signal` and `beforeCall`. Two hooks are still missing, so Bureau
keeps a small HTTP compatibility shim in front of `ai.mcp.serve`.

1. **No tools/list visibility filter.** `tools/list` enumerates the same snapshot `tools/call` uses. Bureau advertises a
   small stable core plus meta-tools, and keeps other tools callable but hidden, which is B9's token-saving discovery.
   - **Request:** a `listFilter(context, tools) → tools` hook, or a per-tool `advertise: boolean | (context) => boolean`,
     independent of callability.
2. **No extra HTTP routes.** The HTTP transport exposes one POST MCP path. Bureau's WJS runner also calls
   `GET <mcp.url>/tool-policy?name=…`, which returns `{ allowed }`, for live policy checks.
   - **Request:** a `routes` option, or a mountable handler, so an app can serve small authenticated side routes from the
     same server and authentication.

Bureau will drop its shim once both exist.

## Addendum (U2, 2026-10-19): error codes and the `task` envelope

3. **`beforeCall` throws always map to JSON-RPC -32602**, ignoring `McpError.code`. Apps can't express "denied"
   (-32600) as distinct from "invalid params". **Request:** honour a thrown `McpError`'s code and message.
4. **`params.task` is silently ignored** by `readCallParams`. **Request:** a hook, or a strict option, to refuse unknown
   call envelopes such as `task` with an app-defined error. Bureau refuses them today, through its shim.
