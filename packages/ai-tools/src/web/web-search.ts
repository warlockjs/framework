import { tool, type ToolContract } from "@warlock.js/ai";
import type {
  SearchProvider,
  WebSearchInput,
  WebSearchOptions,
  WebSearchResult,
  WebSearchResultItem,
} from "../contracts";
import { WebToolError } from "../errors";
import { objectSchema, optionalNumberField, stringField } from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "web_search";

/** Default per-call result cap when the constructor does not set one. */
const DEFAULT_MAX_RESULTS = 5;

/**
 * Per-provider configuration — the environment variable consulted when no
 * `apiKey` is passed, plus the human-readable provider label used in
 * error messages.
 */
const PROVIDER_ENV: Record<SearchProvider, string> = {
  tavily: "TAVILY_API_KEY",
  brave: "BRAVE_API_KEY",
  serpapi: "SERPAPI_API_KEY",
};

/** Input schema: `{ query, maxResults? }`. */
const inputSchema = objectSchema<WebSearchInput>({
  query: stringField(),
  maxResults: optionalNumberField(),
});

/**
 * Resolve the API key from explicit options or the provider's environment
 * variable, throwing a typed {@link WebToolError} when neither is present.
 */
function resolveApiKey(provider: SearchProvider, apiKey?: string): string {
  const key = apiKey ?? process.env[PROVIDER_ENV[provider]];

  if (!key) {
    throw new WebToolError(
      `web_search requires an API key for the "${provider}" provider. ` +
        `Pass { apiKey } or set the ${PROVIDER_ENV[provider]} environment variable.`,
      { type: "missing-key" },
    );
  }

  return key;
}

/**
 * Clamp the model-requested result count into `[1, max]`. An omitted /
 * non-positive request falls back to the configured default.
 */
function clampResults(requested: number | undefined, max: number): number {
  if (requested === undefined || requested < 1) {
    return Math.min(DEFAULT_MAX_RESULTS, max);
  }

  return Math.min(Math.max(1, Math.floor(requested)), max);
}

/**
 * Shape of the relevant slice of a Tavily `/search` response. Tavily
 * returns LLM-ready `content` snippets and a relevance `score` per hit.
 */
interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
}

/** Shape of the relevant slice of a Brave web-search response. */
interface BraveResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

/** Shape of the relevant slice of a SerpAPI `search.json` response. */
interface SerpApiResponse {
  organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
}

/**
 * Issue the provider HTTP call and return its parsed JSON, mapping a
 * non-OK status or a network failure to a typed {@link WebToolError}.
 */
async function fetchJson(
  url: string,
  init: RequestInit,
  provider: SearchProvider,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    throw new WebToolError(
      `web_search request to the "${provider}" provider failed: ${message}`,
      { type: "request-failed", cause },
    );
  }

  if (!response.ok) {
    throw new WebToolError(
      `web_search "${provider}" provider returned HTTP ${response.status}.`,
      { type: "request-failed", context: { status: response.status } },
    );
  }

  return response.json();
}

/** Drive Tavily's `/search` HTTP API and normalize its hits. */
async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<WebSearchResultItem[]> {
  const json = (await fetchJson(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
    },
    "tavily",
  )) as TavilyResponse;

  return (json.results ?? []).slice(0, maxResults).map((hit) => ({
    title: hit.title ?? "",
    url: hit.url ?? "",
    snippet: hit.content ?? "",
    score: hit.score,
  }));
}

/** Drive Brave's web-search HTTP API and normalize its hits. */
async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<WebSearchResultItem[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const json = (await fetchJson(
    url.toString(),
    {
      method: "GET",
      headers: { accept: "application/json", "x-subscription-token": apiKey },
    },
    "brave",
  )) as BraveResponse;

  return (json.web?.results ?? []).slice(0, maxResults).map((hit) => ({
    title: hit.title ?? "",
    url: hit.url ?? "",
    snippet: hit.description ?? "",
  }));
}

/** Drive SerpAPI's `search.json` HTTP API and normalize its hits. */
async function searchSerpApi(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<WebSearchResultItem[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(maxResults));
  url.searchParams.set("api_key", apiKey);

  const json = (await fetchJson(url.toString(), { method: "GET" }, "serpapi")) as SerpApiResponse;

  return (json.organic_results ?? []).slice(0, maxResults).map((hit) => ({
    title: hit.title ?? "",
    url: hit.link ?? "",
    snippet: hit.snippet ?? "",
  }));
}

/**
 * Build the agent-facing `web_search` tool over a {@link SearchProvider}.
 *
 * The provider's HTTP API is called directly through the global `fetch`
 * (Node 18+) — Tavily via `POST /search` (LLM-ready snippets + relevance
 * scores), Brave and SerpAPI via their `GET` endpoints. The API key is
 * taken from `options.apiKey`, falling back to the provider's environment
 * variable (`TAVILY_API_KEY` / `BRAVE_API_KEY` / `SERPAPI_API_KEY`). No
 * provider SDK is required for the HTTP path; `@tavily/core` remains an
 * optional peer for callers who prefer it, but this factory never forces
 * it to be installed.
 *
 * The model passes `{ query, maxResults? }`; `maxResults` is clamped into
 * `[1, options.maxResults]` (default {@link DEFAULT_MAX_RESULTS}).
 *
 * **Errors flow as data.** A missing key, a non-OK provider status, or a
 * network failure throws a typed {@link WebToolError}; the `tool()`
 * wrapper catches it and surfaces it in the returned `{ error }` field —
 * `invoke()` never throws — so the agent can read the failure and
 * self-correct.
 *
 * @param options - Provider selection, API key, result cap, and an
 *   optional tool-name override.
 * @returns A `ToolContract<{ query; maxResults? }, WebSearchResult>`.
 *
 * @example
 * const search = webSearchTool({ provider: "tavily" });
 * const { data } = await search.invoke({ query: "warlock.js ai tools" });
 * for (const hit of data?.results ?? []) console.log(hit.title, hit.url);
 */
export function webSearchTool(
  options: WebSearchOptions,
): ToolContract<WebSearchInput, WebSearchResult> {
  const provider = options.provider;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  return tool<WebSearchInput, WebSearchResult>({
    name: options.name ?? DEFAULT_NAME,
    description:
      "Search the web for current information and return a ranked list of " +
      "results (title, URL, and a short snippet). Use for facts that may have " +
      "changed since training, or anything you are unsure about.",
    input: inputSchema,
    async execute(input) {
      const apiKey = resolveApiKey(provider, options.apiKey);
      const limit = clampResults(input.maxResults, maxResults);

      let results: WebSearchResultItem[];

      switch (provider) {
        case "tavily":
          results = await searchTavily(input.query, limit, apiKey);
          break;
        case "brave":
          results = await searchBrave(input.query, limit, apiKey);
          break;
        case "serpapi":
          results = await searchSerpApi(input.query, limit, apiKey);
          break;
      }

      return { results };
    },
  });
}
