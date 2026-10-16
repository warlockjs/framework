import { afterEach, describe, expect, it, vi } from "vitest";
import { webSearchTool } from "./web-search";

/** Build a JSON `Response` stub the way global `fetch` would resolve one. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    url: "https://api.tavily.com/search",
    async json() {
      return body;
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("webSearchTool", () => {
  it("returns normalized ranked results from the Tavily provider (happy path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { title: "Warlock", url: "https://warlock.js.org", content: "The framework", score: 0.9 },
          { title: "Docs", url: "https://warlock.js.org/docs", content: "Guides", score: 0.7 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = webSearchTool({ provider: "tavily", apiKey: "tvly-test" });
    const { data, error } = await tool.invoke({ query: "warlock.js" });

    expect(error).toBeUndefined();
    expect(data?.results).toEqual([
      { title: "Warlock", url: "https://warlock.js.org", snippet: "The framework", score: 0.9 },
      { title: "Docs", url: "https://warlock.js.org/docs", snippet: "Guides", score: 0.7 },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
  });

  it("clamps maxResults into [1, options.maxResults]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: Array.from({ length: 10 }, (_, i) => ({
          title: `t${i}`,
          url: `https://e/${i}`,
          content: "c",
        })),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = webSearchTool({ provider: "tavily", apiKey: "k", maxResults: 3 });
    const { data } = await tool.invoke({ query: "q", maxResults: 50 });

    // The model asked for 50, but the constructor cap is 3.
    expect(data?.results).toHaveLength(3);
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody.max_results).toBe(3);
  });

  it("falls back to the provider env var when no apiKey is passed", async () => {
    vi.stubEnv("TAVILY_API_KEY", "env-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = webSearchTool({ provider: "tavily" });
    const { error } = await tool.invoke({ query: "q" });

    expect(error).toBeUndefined();
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody.api_key).toBe("env-key");
  });

  it("surfaces a missing-key error as data when no key is available", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = webSearchTool({ provider: "tavily" });
    const { data, error } = await tool.invoke({ query: "q" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/requires an API key/);
    // Guardrail rejects before any network call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a non-OK provider status as a request-failed error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = webSearchTool({ provider: "tavily", apiKey: "k" });
    const { data, error } = await tool.invoke({ query: "q" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/HTTP 429/);
  });

  it("rejects non-object input via the schema", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = webSearchTool({ provider: "tavily", apiKey: "k" });
    const { error } = await tool.invoke({ query: 123 });

    expect(error?.message).toMatch(/must be a string/);
  });
});
