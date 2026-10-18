// Root barrel for `@warlock.js/ai-tools`.
//
// Importing this package runs `./register` for its side effect — attaching
// `ai.tools.*` + `ai.mcp` onto the shared `ai` object — and re-exports the
// value factories + option/result types. A single consolidated `declare
// module "@warlock.js/ai"` augmentation in `./register` widens the `Ai`
// interface so the runtime registrations are statically typed.

// ---------------------------------------------------------------------------
// Side-effect registration: attach `ai.tools.*` + `ai.mcp` onto the shared
// `ai` object on import. One consolidated `declare module "@warlock.js/ai"`
// augmentation + runtime assignment lives in `./register`.
// ---------------------------------------------------------------------------
import "./register";

// ---------------------------------------------------------------------------
// MCP — client (`mcp`) + server (`serve`) + the schema/transport seams.
// ---------------------------------------------------------------------------
export { mcp, serve, createServeHandler, mcpResult, SUPPORTED_PROTOCOL_VERSIONS } from "./mcp";
export { jsonSchemaToStandard } from "./mcp/json-schema-to-standard";
export { createJsonRpcClient, createTransport } from "./mcp/transport";
export type { JsonRpcClientHandle } from "./mcp/transport";
export type {
  McpFactory,
  McpNativeResult,
  McpServeRequestHandler,
  McpTransportClient,
} from "./mcp";

// ---------------------------------------------------------------------------
// The `ai.tools.*` namespace shape (declared once in `./register`).
// ---------------------------------------------------------------------------
export type { AiToolsNamespace } from "./register";

// ---------------------------------------------------------------------------
// Tool factories (also reachable as `ai.tools.*` after import).
// ---------------------------------------------------------------------------
export { webSearchTool, fetchUrlTool } from "./web";
export { httpRequestTool } from "./http/http-request";
export { calculatorTool, dateTimeTool } from "./utility";

// ---------------------------------------------------------------------------
// Error classes — every one extends the `@warlock.js/ai` `AIError` base.
// ---------------------------------------------------------------------------
export {
  CalculatorError,
  type CalculatorErrorOptions,
  type CalculatorFailure,
  DateTimeError,
  type DateTimeErrorOptions,
  type DateTimeFailure,
  HttpPolicyError,
  type HttpPolicyErrorOptions,
  type HttpPolicyFailure,
  McpServeError,
  type McpServeErrorOptions,
  type McpServeFailure,
  McpTransportError,
  type McpTransportErrorOptions,
  type McpTransportFailure,
  WebToolError,
  type WebToolErrorOptions,
  type WebToolFailure,
} from "./errors";

// ---------------------------------------------------------------------------
// Public types — options / inputs / results for every surface.
// ---------------------------------------------------------------------------
export type {
  CalculatorInput,
  CalculatorOptions,
  CalculatorResult,
  DateTimeInput,
  DateTimeOp,
  DateTimeOptions,
  DateTimeResult,
  FetchUrlExtract,
  FetchUrlInput,
  FetchUrlOptions,
  FetchUrlResult,
  HttpMethod,
  HttpRequestInput,
  HttpRequestOptions,
  HttpRequestResult,
  JsonRpcError,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcVersion,
  McpClient,
  McpClientOptions,
  McpContentBlock,
  McpBeforeCall,
  McpCallRefusal,
  McpGroupedToolSource,
  McpHttpAuth,
  McpHttpRequestInfo,
  McpHttpServeHandle,
  McpHttpServeTransport,
  McpPromptArgument,
  McpPromptMessage,
  McpServeCallContext,
  McpServeHandle,
  McpServeOptions,
  McpServePrompt,
  McpServeResource,
  McpServeSource,
  McpServeTransport,
  McpServeToolContext,
  McpStdioServeTransport,
  McpServer,
  McpToolCallResult,
  McpToolDescriptor,
  McpToolSource,
  McpTransport,
  SearchProvider,
  WebSearchInput,
  WebSearchOptions,
  WebSearchResult,
  WebSearchResultItem,
} from "./contracts";
