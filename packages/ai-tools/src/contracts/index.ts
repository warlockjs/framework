// Every contract in this package is a pure type declaration (interfaces +
// unions), so all re-exports are `export type`. Value exports (the tool
// factories, the MCP client/server, error classes) live outside
// `contracts/`.

export type {
  FetchUrlExtract,
  FetchUrlInput,
  FetchUrlOptions,
  FetchUrlResult,
  SearchProvider,
  WebSearchInput,
  WebSearchOptions,
  WebSearchResult,
  WebSearchResultItem,
} from "./web.type";
export type {
  HttpMethod,
  HttpRequestInput,
  HttpRequestOptions,
  HttpRequestResult,
} from "./http.type";
export type {
  CalculatorInput,
  CalculatorOptions,
  CalculatorResult,
  DateTimeInput,
  DateTimeOp,
  DateTimeOptions,
  DateTimeResult,
} from "./utility.type";
export type {
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
  McpToolCallResult,
  McpToolDescriptor,
  McpTransport,
} from "./mcp.type";
export type {
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
  McpToolSource,
} from "./mcp-serve.type";
