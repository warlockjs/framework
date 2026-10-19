# WR-021: configurable HTTP auth refusal for ai.mcp.serve

Date: 2026-10-19 · Package: @warlock.js/ai-tools 5.34.0 · From: Bureau U6

The new listFilter, transport.routes and validateCallParams hooks let Bureau remove its MCP HTTP compatibility shim. Native bearer authentication and Host/Origin validation remain strict. One wire contract cannot be preserved: the shim returned HTTP 401 with `{ "error": "WORKER_SEAT_UNAUTHORIZED" }`; native HTTP authentication returns a JSON-RPC `Unauthorized.` refusal. Bureau explicitly accepts this change during the 5.34 migration.

Request: an optional typed HTTP auth-refusal response hook, shared by the MCP endpoint and transport.routes. It should customize status, safe headers and JSON body after a failed authentication check without overriding Host/Origin validation, granting authority, exposing thrown auth errors, or invoking route/tool handlers. Keep the current refusal as the default. This would allow applications to retain their existing auth-error contracts while using native serving.

No framework files changed and no checks executed for this request.
