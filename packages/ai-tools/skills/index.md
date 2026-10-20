---
description: 'Ready-made AI tools and MCP client/server support: `mcp`, `serve`, `webSearchTool`, `fetchUrlTool`, `httpRequestTool`, `calculatorTool` and `dateTimeTool`; also mounts `ai.mcp` and `ai.tools`. Use for "connect an MCP server", "serve tools over MCP", "search the web" or "fetch a URL". Not this package → @warlock.js/ai for custom tools and agents; @warlock.js/ai-workspace for filesystem and shell tools.'
---

# @warlock.js/ai-tools

A belt of prebuilt tools for `@warlock.js/ai` agents plus the Model Context Protocol bridge in both directions. Importing the package attaches `ai.tools.*` and `ai.mcp` onto the shared `ai` object; the factories are also exported directly.

## The 80% path

1. Give an agent web or API access with the factories (`use-web-and-http-tools.md`); pass the results in the agent's `tools` array.
2. Consume tools from an external MCP server (`connect-mcp-server.md`); they arrive as normal agent tools.
3. Publish your own tools to MCP clients such as editors or agent CLIs, over stdio or a loopback HTTP endpoint with a bearer token (`expose-as-mcp-server.md`).

## Conventions and pitfalls

- Direction A (`connect-mcp-server.md`) consumes; Direction B (`expose-as-mcp-server.md`) serves. Do not mix them up.
- `fetchUrlTool` and `httpRequestTool` are policy-gated: set host allowlists and byte caps rather than opening them fully.
- `webSearchTool` needs a search provider choice and its API key (tavily, brave, or serpapi).
- Every error class extends the `AIError` of `@warlock.js/ai`; catch by subclass.
- Writing a custom tool with `ai.tool()` is covered by the `define-ai-tool` topic of the `@warlock.js/ai` package.
