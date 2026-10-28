import { ProviderAuthError } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { AnthropicSDK } from "./sdk";

describe("AnthropicSDK", () => {
  it("constructs successfully with an apiKey", () => {
    expect(new AnthropicSDK({ apiKey: "test-key" })).toBeInstanceOf(AnthropicSDK);
  });

  it("constructs successfully with apiKey + baseURL (proxied endpoints)", () => {
    const sdk = new AnthropicSDK({
      apiKey: "test-key",
      baseURL: "https://gateway.internal/anthropic",
    });

    expect(sdk).toBeInstanceOf(AnthropicSDK);
  });

  it("forwards upstream ClientOptions (timeout, maxRetries) to the Anthropic client — C1 regression", () => {
    // Previously only apiKey + baseURL were forwarded, so every other
    // type-checked ClientOptions value was silently dropped.
    const sdk = new AnthropicSDK({ apiKey: "test-key", maxRetries: 7, timeout: 1234 });
    const client = (sdk as unknown as { client: { maxRetries: number; timeout: number } }).client;

    expect(client.maxRetries).toBe(7);
    expect(client.timeout).toBe(1234);
  });

  it("model() returns a fresh ModelContract bound to this SDK each call", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });
    const a = sdk.model({ name: "claude-haiku-4-5" });
    const b = sdk.model({ name: "claude-haiku-4-5" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("claude-haiku-4-5");
    expect(a.provider).toBe("anthropic");
  });

  it("model() honors a custom provider label", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key", provider: "bedrock-anthropic" });

    expect(sdk.model({ name: "claude-sonnet-4-6" }).provider).toBe("bedrock-anthropic");
  });

  it("model() forwards vision capability inference from the model name", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "claude-sonnet-4-6" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "claude-2.1" }).capabilities?.vision).toBe(false);
  });

  it("model() honors explicit vision override over inference", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "claude-2.1", vision: true }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "claude-sonnet-4-6", vision: false }).capabilities?.vision).toBe(
      false,
    );
  });

  it("model() defaults structuredOutput to true and honors the override", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "claude-sonnet-4-6" }).capabilities?.structuredOutput).toBe(true);
    expect(
      sdk.model({ name: "claude-sonnet-4-6", structuredOutput: false }).capabilities
        ?.structuredOutput,
    ).toBe(false);
  });

  it("model() resolves SDK-level pricing by model name, per-model wins", () => {
    const sdk = new AnthropicSDK({
      apiKey: "test-key",
      pricing: { "claude-sonnet-4-6": { input: 3, output: 15 } },
    });

    // Caller entries win over the built-in table; the Anthropic cache-write
    // multipliers (5m 1.25x, 1h 2x) fill the rates they leave out.
    expect(sdk.model({ name: "claude-sonnet-4-6" }).pricing).toEqual({
      input: 3,
      output: 15,
      cacheWrite: 3.75,
      cacheWrite1h: 6,
    });
    expect(
      sdk.model({ name: "claude-sonnet-4-6", pricing: { input: 1, output: 2 } }).pricing,
    ).toEqual({ input: 1, output: 2, cacheWrite: 1.25, cacheWrite1h: 2 });
    expect(sdk.model({ name: "claude-haiku-4-5" }).pricing).toEqual({
      input: 1,
      output: 5,
      cachedInput: 0.1,
      cacheWrite: 1.25,
      cacheWrite1h: 2,
    });
  });

  it("count() returns an approximate token count using the core heuristic", async () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4);
    expect(await sdk.count("a".repeat(400))).toBe(100);
  });

  it("count() ignores the optional model argument (offline heuristic only)", async () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(await sdk.count("Hello, world!", "claude-sonnet-4-6")).toBe(4);
    expect(await sdk.count("Hello, world!")).toBe(
      await sdk.count("Hello, world!", "any-other-model"),
    );
  });

  it("count() rounds partial tokens up (ceil of length / 4)", async () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    // 5 chars / 4 = 1.25 → ceils to 2.
    expect(await sdk.count("abcde")).toBe(2);
  });

  it("model() falls back to the built-in list price, and leaves unknown ids unpriced", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "claude-sonnet-4-6" }).pricing).toEqual({
      input: 3,
      output: 15,
      cachedInput: 0.3,
      cacheWrite: 3.75,
      cacheWrite1h: 6,
    });
    expect(sdk.model({ name: "claude-sonnet-4-5-20250929" }).pricing?.input).toBe(3);
    // Prompt-length-tiered and unknown models stay unpriced.
    expect(sdk.model({ name: "claude-haiku-5-5" }).pricing).toBeUndefined();
    expect(sdk.model({ name: "my-proxy-model" }).pricing).toBeUndefined();
  });

  it("model() defaults the provider label to 'anthropic'", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "claude-sonnet-4-6" }).provider).toBe("anthropic");
  });

  it("does not expose an embedder() method (Anthropic has no embeddings API)", () => {
    const sdk = new AnthropicSDK({ apiKey: "test-key" });

    expect((sdk as { embedder?: unknown }).embedder).toBeUndefined();
  });
});

describe("AnthropicSDK.models()", () => {
  const page = (data: unknown[], hasMore = false, lastId?: string) =>
    new Response(
      JSON.stringify({ data, has_more: hasMore, first_id: null, last_id: lastId ?? null }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );

  it("lists GET /v1/models, follows pagination and maps release date and limits", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        page(
          [
            {
              type: "model",
              id: "claude-sonnet-4-5-20250929",
              display_name: "Claude Sonnet 4.5",
              created_at: "2025-09-29T00:00:00Z",
              max_input_tokens: 200000,
              max_tokens: 64000,
            },
          ],
          true,
          "claude-sonnet-4-5-20250929",
        ),
      )
      .mockResolvedValueOnce(
        page([
          {
            type: "model",
            id: "claude-haiku-4-5",
            display_name: "Claude Haiku 4.5",
            created_at: "2025-10-01T00:00:00Z",
          },
        ]),
      );
    const models = await new AnthropicSDK({ apiKey: "k", fetch }).models();

    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/models");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("after_id=claude-sonnet-4-5-20250929");
    expect(models).toEqual([
      {
        id: "claude-sonnet-4-5-20250929",
        label: "Claude Sonnet 4.5",
        provider: "anthropic",
        kind: "chat",
        created: 1_759_104_000,
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        provider: "anthropic",
        kind: "chat",
        created: 1_759_276_800,
      },
    ]);
  });

  it("throws a provider error on an auth failure", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      new AnthropicSDK({ apiKey: "k", fetch, maxRetries: 0 }).models(),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });
});
