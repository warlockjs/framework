---
description: "Ready-made tools for @warlock.js/ai agents: web search, URL fetch, HTTP requests, calculator, date-time, and MCP client and server support. Exports `webSearchTool`, `fetchUrlTool`, `httpRequestTool`, `calculatorTool`, `dateTimeTool`, `mcp`, `serve`, `createServeHandler`, `McpTransportError`. Use for: let an agent search the web, fetch a page, call an HTTP API, do math, get the current date, connect to an MCP server, expose my tools as an MCP server. Not this package: defining your own tool or the agent itself → @warlock.js/ai; file and shell tools → @warlock.js/ai-workspace."
---

# @warlock.js/ai-tools

A belt of prebuilt tools for `@warlock.js/ai` agents plus the Model Context Protocol bridge in both directions. Importing the package attaches `ai.tools.*` and `ai.mcp` onto the shared `ai` object; the factories are also exported directly.

## The 80% path

1. Give an agent web or API access with the factories (`use-web-and-http-tools.md`); pass the results in the agent's `tools` array.
2. Consume tools from an external MCP server (`connect-mcp-server.md`); they arrive as normal agent tools.
3. Publish your own tools to MCP clients such as editors (`expose-as-mcp-server.md`).

## Conventions and pitfalls

- Direction A (`connect-mcp-server.md`) consumes; Direction B (`expose-as-mcp-server.md`) serves. Do not mix them up.
- `fetchUrlTool` and `httpRequestTool` are policy-gated: set host allowlists and byte caps rather than opening them fully.
- `webSearchTool` needs a search provider choice and its API key (tavily, brave, or serpapi).
- Every error class extends the `AIError` of `@warlock.js/ai`; catch by subclass.
- Writing a custom tool with `ai.tool()` lives in `@warlock.js/ai` (`define-ai-tool.md`).
