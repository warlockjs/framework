# WR-001: HTTP MCP serving cannot preserve an existing CallToolResult

Date: 2026-10-18
Package: @warlock.js/ai-tools 5.31.0
Observed in: esm/mcp/serve.mjs, callTool (around lines 202–233)

Bureau is upgrading its existing per-session authenticated MCP server to ai.mcp.serve. Its tools already return native MCP CallToolResult objects (content, isError and potentially structuredContent/_meta). serve always serializes result.data into a new single text block, with isError:false. Passing a native result therefore nests its content as JSON and loses protocol-level error/structured-output semantics.

Reproduction: serve a ToolContract whose invoke resolves {data:{content:[{type:"text",text:"hello"}],isError:true}}. tools/call returns isError:false and text containing the serialized object, rather than the native result. This is directly visible in callTool's return statement.

Requested: an explicit native-result adapter/option or raw MCP handler extension preserving CallToolResult and request identity. Bureau must retain its existing native server until that contract can be preserved; replacing transport alone changes all callers' response shapes. No framework files changed here.

## Executed probe

2026-10-18, Bureau B8 worktree, Node 22.23.3. Called `createServeHandler([ai.tool({name:"native-result",execute:async()=>({content:[{type:"text",text:"fixture"}],isError:true})})]).handle(...)` locally (no socket, provider or secret). Observed `result.isError === false` and `result.content[0].text === '{"content":[{"type":"text","text":"fixture"}],"isError":true}'`. Evidence: Bureau worktree `apps/bureau/.runtime/b8-evidence/framework-findings-proof.json`.
