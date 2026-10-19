import { ai, type ToolContract } from "@warlock.js/ai";
import type {
  CalculatorInput,
  CalculatorOptions,
  CalculatorResult,
  DateTimeInput,
  DateTimeOptions,
  DateTimeResult,
  FetchUrlInput,
  FetchUrlOptions,
  FetchUrlResult,
  HttpRequestInput,
  HttpRequestOptions,
  HttpRequestResult,
  WebSearchInput,
  WebSearchOptions,
  WebSearchResult,
} from "./contracts";
import { httpRequestTool } from "./http/http-request";
import { type McpFactory, mcp } from "./mcp";
import { calculatorTool } from "./utility/calculator";
import { dateTimeTool } from "./utility/date-time";
import { fetchUrlTool } from "./web/fetch-url";
import { webSearchTool } from "./web/web-search";

export type { AiToolsNamespace } from "@warlock.js/ai";

/** Extend the core tool utilities without replacing the catalogue namespace. */
declare module "@warlock.js/ai" {
  interface AiToolsNamespace {
    /** Search the web via a chosen provider. */
    webSearch(options: WebSearchOptions): ToolContract<WebSearchInput, WebSearchResult>;
    /** Fetch a URL with host, byte and timeout caps. */
    fetchUrl(options?: FetchUrlOptions): ToolContract<FetchUrlInput, FetchUrlResult>;
    /** Guarded HTTP client. */
    http(options?: HttpRequestOptions): ToolContract<HttpRequestInput, HttpRequestResult>;
    calculator(options?: CalculatorOptions): ToolContract<CalculatorInput, CalculatorResult>;
    dateTime(options?: DateTimeOptions): ToolContract<DateTimeInput, DateTimeResult>;
  }
  interface Ai {
    mcp: McpFactory;
  }
}

// Runtime registration: attach `tools` and `mcp` onto the shared `ai`
// object the moment this module is imported (the augmentation above types
// them). The `dateTime` factory's optional injectable-clock `deps` is a
// test/advanced seam, omitted from the agent-facing signature — call
// `dateTimeTool` directly to use it.
Object.assign(ai.tools, {
  webSearch: webSearchTool,
  fetchUrl: fetchUrlTool,
  http: httpRequestTool,
  calculator: calculatorTool,
  dateTime: (options?: DateTimeOptions) => dateTimeTool(options),
});

ai.mcp = mcp;
