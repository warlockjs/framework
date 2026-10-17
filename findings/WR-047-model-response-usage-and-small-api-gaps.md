# WR-047 — `ModelResponse` has no usage; small API gaps in tools and MCP

- **Packages:** `@warlock.js/ai` 5.30.0, `@warlock.js/ai-tools` 5.30.0
- **Classification:** feature requests / typing fixes
- **Found:** 2026-10-17, while building an API-key agent harness on `@warlock.js/ai`.

1. **`model.complete()` returns no usage.** Side calls outside an agent (a history summary, a classifier) can't be
   measured or costed. Request: `ModelResponse.usage` (and cost when pricing is configured).
2. **`ToolContext.artifacts` is required** in the type, although `tool()` documents it as optional. Tools invoked
   outside the agent loop must fake it. Request: make it optional, or provide `createToolContext()`.
3. **`ai.mcp(...)` accepts no `AbortSignal`.** The client's lifetime can only be bound to a run by calling `close()`.
   Request: `ai.mcp(server, { signal })`, plus per-call `signal` forwarding on MCP tool invocations.
