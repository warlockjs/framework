import {
  countInputTokens,
  InvalidRequestError,
  ProviderAuthError,
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  type Message,
} from "@warlock.js/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleSDK } from "./sdk";

const messages: Message[] = [
  { role: "system", content: "test" },
  { role: "user", content: "hello" },
];
const tools = [{ name: "lookup", description: "Look up data", execute: async () => "ok" }];

function setup(name = "gemini-3.5-flash-lite", vertexai = false) {
  const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    Response.json({ totalTokens: 37 }),
  );
  vi.stubGlobal("fetch", fetch);
  const model = new GoogleSDK({
    apiKey: "dummy-key",
    vertexai,
    httpOptions: {
      baseUrl: "https://proxy.example.test/gemini",
      apiVersion: "v1beta",
      headers: { "x-proxy-test": "enabled" },
      retryOptions: { attempts: 1 },
    },
  }).model({ name, temperature: 0.2, maxTokens: 100 });
  return { model, fetch };
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini Developer API full-request counting", () => {
  it.each(["gemini-3.5-flash-lite", "models/gemini-3.5-flash-lite"])(
    "counts system instructions and tools using the SDK transport for %s",
    async (name) => {
      const { model, fetch } = setup(name);
      const signal = new AbortController().signal;
      const result = await countInputTokens(model, messages, {
        tools,
        signal,
        reasoning: { maxTokens: 64 },
        responseSchema: { type: "object", properties: { answer: { type: "string" } } },
        providerOptions: {
          google: { body: { toolConfig: { functionCallingConfig: { mode: "AUTO" } }, topP: 0.8 } },
        },
      });
      expect(result).toEqual({ tokens: 37, source: "native" });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(String(url)).toBe(
        "https://proxy.example.test/gemini/v1beta/models/gemini-3.5-flash-lite:countTokens",
      );
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-api-key")).toBe("dummy-key");
      expect(headers.get("x-proxy-test")).toBe("enabled");
      expect(init?.signal?.aborted).toBe(false);
      expect(JSON.parse(String(init?.body))).toEqual({
        generateContentRequest: {
          model: "models/gemini-3.5-flash-lite",
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
          systemInstruction: { parts: [{ text: "test" }] },
          tools: [
            {
              functionDeclarations: [
                {
                  name: "lookup",
                  description: "Look up data",
                  parametersJsonSchema: { type: "object" },
                },
              ],
            },
          ],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 100,
            topP: 0.8,
            thinkingConfig: { thinkingBudget: 64 },
            responseMimeType: "application/json",
            responseJsonSchema: { type: "object", properties: { answer: { type: "string" } } },
          },
        },
      });
    },
  );

  it("keeps Vertex on the installed SDK's top-level system and tools path", async () => {
    const { model, fetch } = setup("gemini-2.5-flash", true);
    expect(await countInputTokens(model, messages, { tools })).toEqual({
      tokens: 37,
      source: "native",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty("generateContentRequest");
    expect(body).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: "test" }] },
      tools: [{ functionDeclarations: [{ name: "lookup" }] }],
    });
  });

  it("counts requests without system instructions or tools", async () => {
    const { model, fetch } = setup();
    expect(await model.countTokens?.([{ role: "user", content: "hello" }])).toBe(37);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty("contents");
    expect(body.generateContentRequest).not.toHaveProperty("systemInstruction");
    expect(body.generateContentRequest).not.toHaveProperty("tools");
  });

  it.each([
    [400, "Malformed request", InvalidRequestError],
    [403, "PERMISSION_DENIED", ProviderAuthError],
    [429, "RESOURCE_EXHAUSTED", ProviderRateLimitError],
  ])("maps HTTP %s through the Google error wrapper", async (status, message, errorClass) => {
    const { model, fetch } = setup();
    fetch.mockResolvedValue(Response.json({ error: { code: status, message } }, { status }));
    await expect(countInputTokens(model, messages, { tools })).rejects.toBeInstanceOf(errorClass);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing native total instead of estimating", async () => {
    const { model, fetch } = setup();
    fetch.mockResolvedValue(Response.json({}));
    await expect(countInputTokens(model, messages, { tools })).rejects.toMatchObject({
      name: "InvalidRequestError",
      message: "Google countTokens returned no totalTokens.",
      reason: undefined,
    });
  });

  it("estimates a cached request explicitly unsupported by the adapter without fetching", async () => {
    const { model, fetch } = setup();
    const result = await countInputTokens(model, messages, {
      tools,
      providerOptions: { google: { body: { cachedContent: "cachedContents/one" } } },
    });
    expect(result.source).toBe("estimate");
    expect(result.tokens).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates transport errors instead of estimating", async () => {
    const { model, fetch } = setup();
    fetch.mockRejectedValue(new TypeError("connection failed"));
    await expect(countInputTokens(model, messages, { tools })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("rejects an already aborted signal without fetching", async () => {
    const { model, fetch } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.countTokens?.(messages, { tools, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels an in-flight count through the SDK fetch signal", async () => {
    const { model, fetch } = setup();
    const controller = new AbortController();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let requestSignal: AbortSignal | null | undefined;
    fetch.mockImplementation(async (_input, init) => {
      requestSignal = init?.signal;
      notifyStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const result = model.countTokens?.(messages, { tools, signal: controller.signal });
    const rejected = expect(result).rejects.toBeInstanceOf(ProviderTimeoutError);
    await started;
    controller.abort();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
  });
});
