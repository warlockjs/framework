/**
 * Type contracts for the web tools — `ai.tools.webSearch` and
 * `ai.tools.fetchUrl`. Pure declarations only; the factories live
 * outside `contracts/`.
 */

/**
 * Which optional search backend `ai.tools.webSearch` drives. The chosen
 * provider's SDK / HTTP key is a lazily-imported optional peer, so an
 * agent that never searches the web pulls in none of them.
 *
 * Uses `type` as the discriminator everywhere downstream — never `kind`.
 */
export type SearchProvider = "tavily" | "brave" | "serpapi";

/**
 * Construction options for {@link SearchProvider}-backed web search.
 */
export interface WebSearchOptions {
  /** Which optional search backend to use. Its SDK/HTTP key is a lazy peer. */
  provider: SearchProvider;
  /**
   * API key for the provider. Falls back to a provider-specific
   * environment variable (e.g. `TAVILY_API_KEY`) when omitted.
   */
  apiKey?: string;
  /**
   * Default maximum results per call. The model may request fewer (or
   * more, clamped into `[1, maxResults]`) via the tool input.
   *
   * @default 5
   */
  maxResults?: number;
  /**
   * Override the tool name exposed to the LLM.
   *
   * @default "web_search"
   */
  name?: string;
}

/**
 * The validated input shape the model passes to the web-search tool.
 */
export interface WebSearchInput {
  /** The search query. */
  query: string;
  /** Per-call cap on results, clamped into `[1, options.maxResults]`. */
  maxResults?: number;
}

/**
 * A single web-search hit. `score` is provider-supplied relevance when
 * the backend returns one (Tavily does; some others do not).
 */
export interface WebSearchResultItem {
  /** Page / document title. */
  title: string;
  /** Canonical URL of the result. */
  url: string;
  /** Short LLM-ready extract / snippet. */
  snippet: string;
  /** Provider relevance score, when available. */
  score?: number;
}

/**
 * The web-search tool's output — the ranked list of hits.
 */
export interface WebSearchResult {
  /** Ranked results, best-first. */
  results: WebSearchResultItem[];
}

/**
 * How `fetch_url` should render the fetched document into the `content`
 * string handed back to the model.
 *
 * - `"text"` — readability-extracted main text (the default; needs the
 *   `@mozilla/readability` + `jsdom` optional peers).
 * - `"html"` — the raw response body, untouched.
 * - `"markdown"` — readability extraction converted to Markdown.
 */
export type FetchUrlExtract = "text" | "html" | "markdown";

/**
 * Construction options for `ai.tools.fetchUrl`.
 */
export interface FetchUrlOptions {
  /**
   * Override the tool name exposed to the LLM.
   *
   * @default "fetch_url"
   */
  name?: string;
  /**
   * Hard cap on the number of response bytes read before truncation.
   *
   * @default 1_000_000
   */
  maxBytes?: number;
  /**
   * Per-request timeout in milliseconds.
   *
   * @default 15_000
   */
  timeoutMs?: number;
  /**
   * How to render the fetched document.
   *
   * @default "text"
   */
  extract?: FetchUrlExtract;
  /**
   * Host allowlist. When set, any request to a host not in this list is
   * rejected before the network call (an SSRF guardrail).
   */
  allowHosts?: string[];
}

/**
 * The validated input shape the model passes to `fetch_url`.
 */
export interface FetchUrlInput {
  /** The absolute URL to fetch. */
  url: string;
}

/**
 * The `fetch_url` tool's output.
 */
export interface FetchUrlResult {
  /** The URL that was fetched (after any redirects the platform followed). */
  url: string;
  /** HTTP status code of the final response. */
  status: number;
  /** The rendered content per the configured `extract` mode. */
  content: string;
  /** True when `content` was cut off at `maxBytes`. */
  truncated: boolean;
}
