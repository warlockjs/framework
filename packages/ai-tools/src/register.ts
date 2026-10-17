import { ai, measureTools, type ToolContract } from "@warlock.js/ai";
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

/**
 * The `ai.tools.*` namespace — the five ready-made agent tools this
 * package vends. Each member is a factory returning a {@link ToolContract}
 * that drops straight into `ai.agent({ tools: [...] })`. Declared inline on
 * the `Ai` interface below (one block, one shape) rather than accreted
 * across the tool sub-barrels, mirroring the `ai.workspace` augmentation in
 * `@warlock.js/ai-workspace`.
 */
export interface AiToolsNamespace {
  /** Search the web via a chosen provider; returns ranked LLM-ready hits. */
  webSearch(options: WebSearchOptions): ToolContract<WebSearchInput, WebSearchResult>;
  /** Fetch a URL (host-allowlisted, byte-capped) and return its content. */
  fetchUrl(options?: FetchUrlOptions): ToolContract<FetchUrlInput, FetchUrlResult>;
  /** A guarded HTTP/REST client — method + host allowlists, byte/timeout caps. */
  http(options?: HttpRequestOptions): ToolContract<HttpRequestInput, HttpRequestResult>;
  /** A SAFE arithmetic-expression evaluator (no `eval`/`Function`). */
  calculator(options?: CalculatorOptions): ToolContract<CalculatorInput, CalculatorResult>;
  /** Clock/calendar ops — now / add / diff / format over ISO instants. */
  dateTime(options?: DateTimeOptions): ToolContract<DateTimeInput, DateTimeResult>;
  /**
   * Measure the input tokens a tool list adds to every call — natively
   * through the model's count endpoint when it has one, estimated
   * otherwise (`source` says which), per tool and in total, in `"full"`
   * or `"compact"` schema mode. Re-exports `measureTools` from
   * `@warlock.js/ai`.
   *
   * @example
   * const { tokens, perTool, source } = await ai.tools.measure(tools, { model, mode: "compact" });
   */
  measure: typeof measureTools;
}

/**
 * Attach the `tools` namespace and the `mcp` factory to the `ai` namespace
 * via module augmentation, per the `ai.`-namespace convention.
 * `@warlock.js/ai` now exposes a named `Ai` interface for exactly this, so
 * after a bare `import "@warlock.js/ai-tools"`, `ai.tools.webSearch(...)`,
 * `ai.tools.http(...)`, `ai.mcp(server)`, and `ai.mcp.serve(source)` are all
 * globally typed — no view/cast needed.
 */
declare module "@warlock.js/ai" {
  interface Ai {
    /**
     * Ready-made agent tools from `@warlock.js/ai-tools` — web search,
     * fetch/scrape, HTTP/REST, calculator, and date-time. Each returns a
     * `ToolContract` that slots into `ai.agent({ tools: [...] })`.
     */
    tools: AiToolsNamespace;
    /**
     * The Model Context Protocol surface — `ai.mcp(server)` connects to an
     * external MCP server and adapts its tools as agent tools (Direction A),
     * while `ai.mcp.serve(source, options)` exposes a local primitive AS an
     * MCP server other clients can consume (Direction B).
     */
    mcp: McpFactory;
  }
}

// Runtime registration: attach `tools` and `mcp` onto the shared `ai`
// object the moment this module is imported (the augmentation above types
// them). The `dateTime` factory's optional injectable-clock `deps` is a
// test/advanced seam, omitted from the agent-facing signature — call
// `dateTimeTool` directly to use it.
ai.tools = {
  webSearch: webSearchTool,
  fetchUrl: fetchUrlTool,
  http: httpRequestTool,
  calculator: calculatorTool,
  dateTime: (options?: DateTimeOptions) => dateTimeTool(options),
  measure: measureTools,
};

ai.mcp = mcp;
