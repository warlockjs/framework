import {
  AgentCancelledError,
  InvalidRequestError,
  MockModel,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  SchemaValidationError,
  ToolExecutionError,
  ai,
  createToolContext,
  extractJsonSchema,
  totalCost,
} from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { kimiFetchTool, kimiSearchTool, KIMI_SERVER_TOOL_PRICING } from "./index";
import { OpenAISDK } from "./sdk";

const apiKey = "test-key";
const page = {
  title: "Example",
  url: "https://example.com/page",
  snippet: "A useful snippet",
  site_name: "Example",
  authority: "S",
  date: "2026-10-18",
  icon: "unused",
  mime: "text/html",
  text: "Full page text",
  chunks: [{ text: "Relevant passage", score: 1.2 }],
};
function transport(data: unknown, status = 200, headers?: HeadersInit) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "content-type": "application/json",
          ...Object.fromEntries(new Headers(headers)),
        },
      }),
  );
  return { apiKey, fetch };
}
function requestBody(fetch: ReturnType<typeof transport>["fetch"]) {
  const init = fetch.mock.calls[0]?.[1];
  return { init, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
}

describe("Kimi standalone tools", () => {
  it("posts Basic search with Bearer auth and only documented fields", async () => {
    const config = transport({ search_results: [page] });
    const search = kimiSearchTool({
      ...config,
      includeContent: true,
      limit: 3,
      timeoutSeconds: 10,
    });
    const result = await search.invoke({
      query: "specific query",
      apiKey: "ignored",
      url: "ignored",
    });
    expect(result.error).toBeUndefined();
    expect(config.fetch.mock.calls[0]?.[0]).toBe("https://api.moonshot.ai/v1/tools/search");
    const { init, body } = requestBody(config.fetch);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(body).toEqual({
      text_query: "specific query",
      limit: 3,
      timeout_seconds: 10,
      include_content: true,
    });
    expect(result.data).toEqual({
      results: [
        {
          title: page.title,
          url: page.url,
          snippet: page.snippet,
          siteName: page.site_name,
          date: page.date,
          authority: page.authority,
          text: page.text,
        },
      ],
      truncated: false,
    });
    expect(result.usage.serverToolUse).toEqual({ webSearchRequests: 1, kimiSearchRequests: 1 });
    expect(result.usage.cost?.serverTools).toEqual({ kimiSearchRequests: 0.002 });
    expect(totalCost(result.usage.cost)).toBe(0.002);
    expect(result.report.usage).toBe(result.usage);
    expect(extractJsonSchema(search.input)).toMatchObject({
      required: ["query"],
      properties: { query: { type: "string" } },
    });
  });

  it("posts Pro filters and returns scored chunks with its own rate", async () => {
    const config = transport({ search_results: [page] });
    const result = await kimiSearchTool({
      ...config,
      mode: "pro",
      sites: ["example.com"],
      timeWindow: { start: "2026", end: "2026-10" },
      baseURL: "https://gateway.example/v1",
    }).invoke({ query: "query" });
    expect(config.fetch.mock.calls[0]?.[0]).toBe("https://gateway.example/v1/tools/search_pro");
    expect(requestBody(config.fetch).body).toEqual({
      text_query: "query",
      limit: 5,
      timeout_seconds: 30,
      sites: ["example.com"],
      time_window: { start: "2026", end: "2026-10" },
    });
    expect(result.data?.results[0]?.chunks).toEqual(page.chunks);
    expect(result.data?.results[0]?.text).toBeUndefined();
    expect(result.usage.serverToolUse).toEqual({ webSearchRequests: 1, kimiSearchProRequests: 1 });
    expect(result.usage.cost?.serverTools).toEqual({ kimiSearchProRequests: 0.003 });
    expect(totalCost(result.usage.cost)).toBe(0.003);
  });

  it("posts URL fetch, trims Markdown and keeps the source", async () => {
    const config = transport({ url: page.url, title: page.title, markdown: "# Long page" });
    const result = await kimiFetchTool({ ...config, maxContentChars: 6 }).invoke({ url: page.url });
    expect(config.fetch.mock.calls[0]?.[0]).toBe("https://api.moonshot.ai/v1/tools/fetch");
    expect(requestBody(config.fetch).body).toEqual({ url: page.url });
    expect(new Headers(requestBody(config.fetch).init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );
    expect(result.data).toEqual({
      url: page.url,
      title: page.title,
      markdown: "# Long",
      truncated: true,
    });
    expect(result.usage.serverToolUse).toEqual({ webFetchRequests: 1, kimiFetchRequests: 1 });
    expect(totalCost(result.usage.cost)).toBe(0.002);
  });

  it.each(["basic", "pro"] as const)(
    "bounds %s text across the entire result list",
    async (mode) => {
      const config = transport({ search_results: [page, page] });
      const result = await kimiSearchTool({ ...config, mode, maxContentChars: 5 }).invoke({
        query: "query",
      });
      expect(result.data?.truncated).toBe(true);
      expect(result.data?.results[0]?.snippet).toBe("A use");
      expect(result.data?.results[1]?.snippet).toBe("");
      expect(result.data?.results[0]?.url).toBe(page.url);
      expect(result.usage.serverToolUse?.webSearchRequests).toBe(1);
    },
  );

  it.each(["basic", "pro"] as const)(
    "records zero billable units for empty %s results",
    async (mode) => {
      const result = await kimiSearchTool({ ...transport({ search_results: [] }), mode }).invoke({
        query: "query",
      });
      expect(result.error).toBeUndefined();
      expect(result.usage.serverToolUse?.webSearchRequests).toBe(0);
      expect(totalCost(result.usage.cost)).toBe(0);
    },
  );

  it.each(["", " \n\t"])("does not bill blank fetched content", async (markdown) => {
    const result = await kimiFetchTool(transport({ url: page.url, title: "", markdown })).invoke({
      url: page.url,
    });
    expect(result.usage.serverToolUse).toEqual({ webFetchRequests: 0, kimiFetchRequests: 0 });
    expect(totalCost(result.usage.cost)).toBe(0);
  });

  it("requires HTTP 200 for billing even when another success status has data", async () => {
    const result = await kimiSearchTool(transport({ search_results: [page] }, 201)).invoke({
      query: "query",
    });
    expect(result.usage.serverToolUse?.kimiSearchRequests).toBe(0);
  });

  it("supports explicit prices and unpriced calls without double-counting generic rates", async () => {
    const config = transport({ search_results: [page] });
    const unpriced = await kimiSearchTool({ ...config, pricing: {} }).invoke({ query: "query" });
    expect(unpriced.usage.serverToolUse?.kimiSearchRequests).toBe(1);
    expect(unpriced.usage.cost).toBeUndefined();
    const custom = await kimiSearchTool({
      ...config,
      pricing: { kimiSearchRequests: 0.01, webSearch: 0.5 },
    }).invoke({ query: "query" });
    expect(totalCost(custom.usage.cost)).toBe(0.01);
    expect(KIMI_SERVER_TOOL_PRICING.kimiSearchProRequests).toBe(0.003);
  });

  it.each([
    [400, "invalid_request", InvalidRequestError],
    [401, undefined, ProviderAuthError],
    [403, undefined, ProviderAuthError],
    [403, "security_risk", InvalidRequestError],
    [404, "markdown_not_found", InvalidRequestError],
    [408, "client_canceled", ProviderTimeoutError],
    [429, "rate_limited", ProviderRateLimitError],
    [500, "internal_error", ProviderError],
    [502, "upstream_failed", ProviderError],
    [504, "timeout", ProviderTimeoutError],
  ] as const)("maps HTTP %s %s without retries or charges", async (status, type, errorClass) => {
    const config = transport(
      { error: { message: "request failed", ...(type ? { type } : {}) } },
      status,
      { "retry-after": "2" },
    );
    const result = await kimiFetchTool(config).invoke({ url: page.url });
    expect(result.error).toBeInstanceOf(ToolExecutionError);
    expect(result.error?.cause).toBeInstanceOf(errorClass);
    expect(result.usage.serverToolUse).toBeUndefined();
    expect(result.usage.cost).toBeUndefined();
    expect(config.fetch).toHaveBeenCalledOnce();
    if (result.error?.cause instanceof ProviderRateLimitError)
      expect(result.error.cause.retryAfter).toBe(2000);
  });

  it("maps a transport timeout to the existing timeout error", async () => {
    const config = transport({});
    config.fetch.mockRejectedValue(new DOMException("deadline", "TimeoutError"));
    const result = await kimiSearchTool(config).invoke({ query: "query" });
    expect(result.error?.cause).toBeInstanceOf(ProviderTimeoutError);
    expect(config.fetch).toHaveBeenCalledOnce();
  });

  it("requires an explicitly configured key", () => {
    expect(() => kimiSearchTool({ apiKey: "" })).toThrow(ProviderAuthError);
    expect(() => kimiFetchTool({ apiKey: "" })).toThrow(ProviderAuthError);
  });

  it("rejects invalid per-call prices", () => {
    const config = transport({});
    for (const rate of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => kimiSearchTool({ ...config, pricing: { kimiSearchRequests: rate } })).toThrow(
        InvalidRequestError,
      );
    }
  });

  it("validates model arguments before transport", async () => {
    const config = transport({});
    const search = kimiSearchTool(config);
    for (const input of [{}, { query: " " }, { query: 4 }, null]) {
      expect((await search.invoke(input)).error).toBeInstanceOf(SchemaValidationError);
    }
    expect(
      (await kimiFetchTool(config).invoke({ url: "file:///etc/hosts" })).error?.cause,
    ).toBeInstanceOf(InvalidRequestError);
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it("validates configured vendor limits", () => {
    const config = transport({});
    for (const limit of [0, 21, 1.5])
      expect(() => kimiSearchTool({ ...config, limit })).toThrow(InvalidRequestError);
    for (const timeoutSeconds of [0, 61])
      expect(() => kimiSearchTool({ ...config, timeoutSeconds })).toThrow(InvalidRequestError);
    expect(() => kimiSearchTool({ ...config, sites: ["example.com"] })).toThrow("pro");
    expect(() => kimiSearchTool({ ...config, mode: "pro", includeContent: true })).toThrow("basic");
    expect(() =>
      kimiSearchTool({
        ...config,
        mode: "pro",
        sites: Array.from({ length: 6 }, () => "example.com"),
      }),
    ).toThrow("five");
    expect(() => kimiSearchTool({ ...config, mode: "pro", sites: ["bad site"] })).toThrow(
      "whitespace",
    );
    expect(() => kimiFetchTool({ ...config, maxContentChars: 0 })).toThrow("maxContentChars");
  });

  it("rejects malformed responses and retains a known billable response if projection fails", async () => {
    const malformed = await kimiSearchTool(transport({ results: [] })).invoke({ query: "query" });
    expect(malformed.error?.cause).toBeInstanceOf(ProviderError);
    expect(malformed.usage.serverToolUse).toBeUndefined();
    const malformedPage = await kimiSearchTool(transport({ search_results: [{}] })).invoke({
      query: "query",
    });
    expect(malformedPage.error?.cause).toBeInstanceOf(ProviderError);
    expect(malformedPage.usage.serverToolUse?.kimiSearchRequests).toBe(1);
    expect(totalCost(malformedPage.usage.cost)).toBe(0.002);
    const malformedFetch = await kimiFetchTool(transport({ markdown: 5 })).invoke({
      url: page.url,
    });
    expect(malformedFetch.error?.cause).toBeInstanceOf(ProviderError);
  });

  it("isolates concurrent invocation ledgers", async () => {
    const config = transport({});
    config.fetch.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text_query: string };
      await Promise.resolve();
      return Response.json({ search_results: body.text_query === "empty" ? [] : [page] });
    });
    const search = kimiSearchTool(config);
    const [empty, full] = await Promise.all([
      search.invoke({ query: "empty" }),
      search.invoke({ query: "full" }),
    ]);
    expect(empty.usage.serverToolUse?.kimiSearchRequests).toBe(0);
    expect(full.usage.serverToolUse?.kimiSearchRequests).toBe(1);
    expect(totalCost(full.usage.cost)).toBe(0.002);
  });

  it.each(["search", "fetch"])("honours pre-aborted signals for %s", async (type) => {
    const config = transport({});
    const controller = new AbortController();
    controller.abort();
    const ctx = createToolContext({ signal: controller.signal });
    const result =
      type === "search"
        ? await kimiSearchTool(config).invoke({ query: "query" }, ctx)
        : await kimiFetchTool(config).invoke({ url: page.url }, ctx);
    expect(result.error?.cause).toBeInstanceOf(AgentCancelledError);
    expect(config.fetch).not.toHaveBeenCalled();
    expect(result.usage.cost).toBeUndefined();
  });

  it("forwards cancellation to an in-flight transport", async () => {
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let transportSignal: AbortSignal | null | undefined;
    const config = transport({});
    config.fetch.mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
          started?.();
        }),
    );
    const controller = new AbortController();
    const pending = kimiFetchTool(config).invoke(
      { url: page.url },
      createToolContext({ signal: controller.signal }),
    );
    await ready;
    controller.abort();
    const result = await pending;
    expect(transportSignal?.aborted).toBe(true);
    expect(result.error?.cause).toBeInstanceOf(AgentCancelledError);
    expect(result.usage.serverToolUse).toBeUndefined();
    expect(config.fetch).toHaveBeenCalledOnce();
  });

  it.each([false, true])("rolls tool fees into agent reports (streaming=%s)", async (streaming) => {
    const search = kimiSearchTool(transport({ search_results: [page] }));
    const fetch = kimiFetchTool(transport({ url: page.url, title: page.title, markdown: "Page" }));
    const model = new MockModel("test-model", [
      {
        content: "",
        toolCalls: [
          { id: "s", name: search.name, input: { query: "query" } },
          { id: "f", name: fetch.name, input: { url: page.url } },
        ],
      },
      { content: "answer" },
    ]);
    const assistant = ai.agent({ model, tools: [search, fetch] });
    const result = await (async () => {
      if (!streaming) return assistant.execute("research");
      const stream = assistant.stream("research");
      for await (const event of stream) void event;
      return stream.result;
    })();
    expect(result.error).toBeUndefined();
    expect(result.text?.trim()).toBe("answer");
    expect(result.usage.serverToolUse).toEqual({
      webSearchRequests: 1,
      kimiSearchRequests: 1,
      webFetchRequests: 1,
      kimiFetchRequests: 1,
    });
    expect(totalCost(result.usage.cost)).toBe(0.004);
    expect(result.report.usage).toBe(result.usage);
    expect(model.callHistory[1]?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", toolCallId: "s" })]),
    );
  });

  it.each(["moonshot", "kimi"])(
    "rejects retired builtin declarations before transport (%s)",
    async (provider) => {
      const config = transport({});
      const model = new OpenAISDK({ ...config, provider }).model({ name: "test-model" });
      const options = {
        providerTools: [
          { provider, definition: { type: "builtin_function", function: { name: "$web_search" } } },
        ],
      };
      const messages = [{ role: "user" as const, content: "query" }];
      await expect(model.complete(messages, options)).rejects.toThrow("20 October 2026");
      await expect(
        (async () => {
          for await (const chunk of model.stream(messages, options)) void chunk;
        })(),
      ).rejects.toThrow("kimiSearchTool");
      expect(config.fetch).not.toHaveBeenCalled();
    },
  );
});
