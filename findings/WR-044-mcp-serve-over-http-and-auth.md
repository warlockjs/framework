# WR-044 — `ai.mcp.serve` over HTTP, auth hooks and collision safety

- **Package:** `@warlock.js/ai-tools` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-17, while designing an API-key agent harness on `@warlock.js/ai` that mimics a coding CLI.

## Observed

- `ai.mcp.serve(...).start()` supports stdio only. HTTP needs `createServeHandler` wired by hand, and `start()` rejects `http`.
- The client takes static `headers` only: no per-request or rotating auth, no OAuth.
- Tool names from several servers can collide silently.
- Only tools are mapped, not resources or prompts.

## Request

- `serve(..., { transport: { type: "http", host: "127.0.0.1", port: 0 }, auth: { bearer } | (req) => boolean })` returning `{ url, close }`. This is what a host needs to give each agent session its own loopback endpoint.
- A per-call `headers: () => Record<string,string>` on the client, with OAuth as a later step.
- `ai.mcp` throws, or prefixes automatically, on a tool-name collision across servers.
- Optional mapping of MCP resources and prompts.
