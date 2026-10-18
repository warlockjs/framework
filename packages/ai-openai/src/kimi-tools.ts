import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  AgentCancelledError,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  computeCost,
  tool,
  type ServerToolPricing,
  type ToolConfig,
  type ToolContext,
  type ToolContract,
  type Usage,
} from "@warlock.js/ai";
import OpenAI, { APIError, type ClientOptions } from "openai";
import { wrapOpenAIError } from "./utils/wrap-openai-error";

/** USD per billable REST request, verified 2026-10-18:
 * https://platform.kimi.ai/docs/pricing/websearch
 * HTTP 200 + nonempty search_results / nonblank markdown only. Taxes excluded.
 * Namespaced rates avoid charging the generic counters a second time. */
export const KIMI_SERVER_TOOL_PRICING: Readonly<ServerToolPricing> = Object.freeze({
  kimiSearchRequests: 0.002,
  kimiSearchProRequests: 0.003,
  kimiFetchRequests: 0.002,
});

export type KimiToolOptions = Pick<
  ClientOptions,
  "baseURL" | "fetch" | "timeout" | "defaultHeaders"
> & {
  apiKey: NonNullable<ClientOptions["apiKey"]>;
  /** Total snippet / page / chunk characters returned to the model. Default 12,000. */
  maxContentChars?: number;
  /** Per-request USD rates keyed like KIMI_SERVER_TOOL_PRICING. {} leaves calls unpriced. */
  pricing?: ServerToolPricing;
};

export type KimiSearchToolOptions = KimiToolOptions & {
  /** Default "basic". Pro returns ranked passages and supports site/date constraints. */
  mode?: "basic" | "pro";
  /** 1–20, default 5. */
  limit?: number;
  /** 1–60 seconds, default 30. */
  timeoutSeconds?: number;
  /** Basic only; default false. */
  includeContent?: boolean;
  /** Pro only; at most five sites, combined with OR. */
  sites?: string[];
  /** Pro only; dates accept YYYY, YYYY-MM or YYYY-MM-DD (validated by Kimi). */
  timeWindow?: { start?: string; end?: string };
};

export type KimiSearchResult = {
  title: string;
  url: string;
  snippet: string;
  siteName: string;
  date: string;
  authority: string;
  text?: string;
  chunks?: { text: string; score: number }[];
};
export type KimiSearchOutput = { results: KimiSearchResult[]; truncated: boolean };
export type KimiFetchOutput = { url: string; title: string; markdown: string; truncated: boolean };

type Counter = "kimiSearchRequests" | "kimiSearchProRequests" | "kimiFetchRequests";

/** Standalone first-party REST search, registered as an ordinary client function tool.
 * Wire contract: https://platform.kimi.ai/docs/api/tools-search and tools-search-pro.
 * Reuse the API key / baseURL configuration passed to OpenAISDK; the default URL
 * here is Moonshot, independent of the model used by the agent. */
export function kimiSearchTool(
  options: KimiSearchToolOptions,
): ToolContract<{ query: string }, KimiSearchOutput> {
  const mode = options.mode ?? "basic";
  if (mode !== "basic" && mode !== "pro")
    throw new InvalidRequestError("Invalid Kimi search mode.");
  const limit = integer(options.limit ?? 5, 1, 20, "limit");
  const timeout = integer(options.timeoutSeconds ?? 30, 1, 60, "timeoutSeconds");
  if (mode === "basic" && (options.sites !== undefined || options.timeWindow !== undefined)) {
    throw new InvalidRequestError("Kimi sites and timeWindow require mode: pro.");
  }
  if (mode === "pro" && options.includeContent !== undefined) {
    throw new InvalidRequestError("Kimi includeContent is available only in basic mode.");
  }
  if (
    options.sites &&
    (options.sites.length > 5 || options.sites.some((site) => !site || /[\s()]/u.test(site)))
  ) {
    throw new InvalidRequestError(
      "Kimi sites accepts at most five nonempty sites without whitespace or parentheses.",
    );
  }
  const maxChars = contentLimit(options);
  const client = createClient(options);
  const counter = mode === "pro" ? "kimiSearchProRequests" : "kimiSearchRequests";
  return meteredTool(
    {
      name: mode === "pro" ? "kimi_search_pro" : "kimi_search",
      description: "Search the web with Kimi and return cited sources and relevant text.",
      input: stringInput("query"),
      async execute({ query }, ctx, record) {
        const body = {
          text_query: query,
          limit,
          timeout_seconds: timeout,
          ...(mode === "basic"
            ? { include_content: options.includeContent ?? false }
            : {
                ...(options.sites !== undefined ? { sites: options.sites } : {}),
                ...(options.timeWindow !== undefined ? { time_window: options.timeWindow } : {}),
              }),
        };
        const raw = await request(
          client,
          mode === "pro" ? "/tools/search_pro" : "/tools/search",
          body,
          ctx,
        );
        if (!isObject(raw.data) || !Array.isArray(raw.data.search_results)) {
          throw new ProviderError("Kimi returned invalid search_results.");
        }
        record(raw.status === 200 && raw.data.search_results.length > 0);
        const budget = textBudget(maxChars);
        const results = raw.data.search_results.slice(0, limit).map((value): KimiSearchResult => {
          if (!isObject(value)) throw new ProviderError("Kimi returned an invalid search result.");
          const result: KimiSearchResult = {
            title: stringValue(value.title),
            url: stringValue(value.url),
            snippet: budget.take(stringValue(value.snippet)),
            siteName: stringValue(value.site_name),
            date: stringValue(value.date),
            authority: stringValue(value.authority),
          };
          if (mode === "basic" && options.includeContent)
            result.text = budget.take(stringValue(value.text));
          if (mode === "pro") {
            if (!Array.isArray(value.chunks))
              throw new ProviderError("Kimi returned invalid search chunks.");
            result.chunks = value.chunks
              .map((chunk) => {
                if (
                  !isObject(chunk) ||
                  typeof chunk.score !== "number" ||
                  !Number.isFinite(chunk.score)
                ) {
                  throw new ProviderError("Kimi returned an invalid search chunk.");
                }
                return { text: budget.take(stringValue(chunk.text)), score: chunk.score };
              })
              .filter((chunk) => chunk.text.length > 0);
          }
          return result;
        });
        return { results, truncated: budget.truncated || raw.data.search_results.length > limit };
      },
    },
    counter,
    options.pricing,
  );
}

/** First-party URL-to-Markdown REST tool.
 * https://platform.kimi.ai/docs/api/tools-fetch — only http/https inputs. */
export function kimiFetchTool(
  options: KimiToolOptions,
): ToolContract<{ url: string }, KimiFetchOutput> {
  const client = createClient(options);
  const maxChars = contentLimit(options);
  return meteredTool(
    {
      name: "kimi_fetch",
      description: "Read a web page with Kimi and return its title, URL and Markdown body.",
      input: stringInput("url"),
      async execute({ url }, ctx, record) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new InvalidRequestError("Kimi fetch requires an http/https URL.");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new InvalidRequestError("Kimi fetch requires an http/https URL.");
        }
        const raw = await request(client, "/tools/fetch", { url }, ctx);
        if (!isObject(raw.data) || typeof raw.data.markdown !== "string") {
          throw new ProviderError("Kimi returned invalid fetch content.");
        }
        record(raw.status === 200 && raw.data.markdown.trim().length > 0);
        return {
          url: stringValue(raw.data.url),
          title: stringValue(raw.data.title),
          markdown: raw.data.markdown.slice(0, maxChars),
          truncated: raw.data.markdown.length > maxChars,
        };
      },
    },
    "kimiFetchRequests",
    options.pricing,
  );
}

function createClient(options: KimiToolOptions): OpenAI {
  const { apiKey, baseURL, fetch, timeout, defaultHeaders } = options;
  if (!apiKey) throw new ProviderAuthError("Kimi tools require an explicitly configured API key.");
  return new OpenAI({
    apiKey,
    baseURL: baseURL ?? "https://api.moonshot.ai/v1",
    fetch,
    timeout,
    defaultHeaders,
    maxRetries: 0,
  });
}

async function request(client: OpenAI, path: string, body: object, ctx?: ToolContext) {
  try {
    ctx?.signal?.throwIfAborted();
    // No automatic retries: a lost response does not prove the vendor did not bill it.
    const response = await client.post<unknown>(path, { body, signal: ctx?.signal }).withResponse();
    return { data: response.data, status: response.response.status };
  } catch (thrown) {
    if (ctx?.signal?.aborted) {
      throw new AgentCancelledError("Kimi tool request cancelled.", { cause: thrown });
    }
    if (thrown instanceof APIError) {
      const context = {
        status: thrown.status,
        type: thrown.type,
        requestId: thrown.headers?.get("x-msh-track-id"),
      };
      if (thrown.status === 408 || thrown.status === 504)
        throw new ProviderTimeoutError(thrown.message, { cause: thrown, context });
      if (thrown.status === 429) {
        const retry = Number(thrown.headers?.get("retry-after") ?? Number.NaN);
        throw new ProviderRateLimitError(thrown.message, {
          cause: thrown,
          context,
          retryAfter: Number.isFinite(retry) && retry >= 0 ? retry * 1000 : undefined,
        });
      }
      if (thrown.status === 403 && !thrown.type)
        throw new ProviderAuthError(thrown.message, { cause: thrown, context });
    }
    throw wrapOpenAIError(thrown);
  }
}

/** Each invoke owns its ledger, including concurrent calls and post-response failures.
 * ToolContract.invoke is the existing accounting boundary used by agents/reports. */
function meteredTool<TInput, TOutput>(
  config: Omit<ToolConfig<TInput, TOutput>, "execute"> & {
    execute(
      input: TInput,
      ctx: ToolContext | undefined,
      record: (billable: boolean) => void,
    ): Promise<TOutput>;
  },
  counter: Counter,
  prices: ServerToolPricing = KIMI_SERVER_TOOL_PRICING,
): ToolContract<TInput, TOutput> {
  const rate = prices[counter];
  if (rate !== undefined && (!Number.isFinite(rate) || rate < 0))
    throw new InvalidRequestError("Kimi per-call pricing must be finite and nonnegative.");
  const base = tool({
    ...config,
    execute: (input: TInput, ctx?: ToolContext) => config.execute(input, ctx, () => {}),
  });
  return {
    ...base,
    async invoke(input, ctx) {
      let usage: Usage = { input: 0, output: 0, total: 0 };
      const invocation = tool({
        ...config,
        execute: (validated: TInput, context?: ToolContext) =>
          config.execute(validated, context, (billable) => {
            const count = billable ? 1 : 0;
            usage = {
              input: 0,
              output: 0,
              total: 0,
              serverToolUse: {
                [counter]: count,
                [counter === "kimiFetchRequests" ? "webFetchRequests" : "webSearchRequests"]: count,
              },
            };
            if (rate !== undefined)
              usage.cost = computeCost(usage, {
                input: 0,
                output: 0,
                serverTools: { [counter]: rate },
              });
          }),
      });
      const result = await invocation.invoke(input, ctx);
      return { ...result, usage, report: { ...result.report, usage } };
    },
  };
}

function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new InvalidRequestError(`Kimi ${name} must be an integer from ${min} to ${max}.`);
  return value;
}
function contentLimit(options: KimiToolOptions): number {
  return integer(options.maxContentChars ?? 12_000, 1, Number.MAX_SAFE_INTEGER, "maxContentChars");
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new ProviderError("Kimi returned an invalid text field.");
  return value;
}
function textBudget(max: number) {
  return {
    truncated: false,
    take(text: string) {
      const result = text.slice(0, max);
      if (text.length > max) this.truncated = true;
      max -= result.length;
      return result;
    },
  };
}
function stringInput<K extends string>(
  key: K,
): StandardSchemaV1<Record<K, string>> & { jsonSchema: Record<string, unknown> } {
  return {
    jsonSchema: {
      type: "object",
      properties: { [key]: { type: "string", minLength: 1 } },
      required: [key],
      additionalProperties: false,
    },
    "~standard": {
      version: 1,
      vendor: "kimi",
      validate(value) {
        if (!isObject(value) || typeof value[key] !== "string" || !value[key].trim()) {
          return { issues: [{ message: `${key} must be a nonempty string`, path: [key] }] };
        }
        return { value: { [key]: value[key] } as Record<K, string> };
      },
    },
  };
}
