import { describe, expect, it } from "vitest";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { DeepSeekSDK } from "./sdk";

/**
 * Reach into the wrapped OpenAISDK's underlying `openai` client to read
 * the baseURL the adapter pinned, without any network call.
 */
function wrappedBaseURL(sdk: DeepSeekSDK): string {
  const openai = (sdk as unknown as { openai: OpenAISDK }).openai;
  const client = (openai as unknown as { client: { baseURL: string } }).client;

  return client.baseURL;
}

describe("DeepSeekSDK", () => {
  it("constructs successfully with just an apiKey", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });
    expect(sdk).toBeInstanceOf(DeepSeekSDK);
  });

  it("wraps an OpenAISDK pinned to the DeepSeek base URL by default", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });
    const openai = (sdk as unknown as { openai: OpenAISDK }).openai;

    expect(openai).toBeInstanceOf(OpenAISDK);
    // OpenAI normalizes baseURL without a trailing slash.
    expect(wrappedBaseURL(sdk)).toBe("https://api.deepseek.com");
  });

  it("honors an explicit baseURL override (proxy / gateway)", () => {
    const sdk = new DeepSeekSDK({
      apiKey: "test-key",
      baseURL: "https://my-gateway.example.com/deepseek",
    });
    expect(wrappedBaseURL(sdk)).toBe("https://my-gateway.example.com/deepseek");
  });

  it("forwards upstream ClientOptions (timeout, maxRetries) through to the wrapped client", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key", maxRetries: 7, timeout: 1234 });
    const openai = (sdk as unknown as { openai: OpenAISDK }).openai;
    const client = (openai as unknown as { client: { maxRetries: number; timeout: number } })
      .client;

    expect(client.maxRetries).toBe(7);
    expect(client.timeout).toBe(1234);
  });

  it("labels produced models with the deepseek provider by default", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });
    expect(sdk.model({ name: "deepseek-chat" }).provider).toBe("deepseek");
  });

  it("honors an explicit provider label override", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key", provider: "deepseek-proxy" });
    expect(sdk.model({ name: "deepseek-chat" }).provider).toBe("deepseek-proxy");
  });

  it("model() returns a fresh ModelContract per call", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });
    const a = sdk.model({ name: "deepseek-chat" });
    const b = sdk.model({ name: "deepseek-chat" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("deepseek-chat");
  });

  it("injects DeepSeek reasoning inference even though names aren't OpenAI names", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "deepseek-reasoner" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "deepseek-v4-pro" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "deepseek-chat" }).capabilities?.reasoning).toBe(false);
    expect(sdk.model({ name: "deepseek-v4-flash" }).capabilities?.reasoning).toBe(false);
  });

  it("infers vision=false for every DeepSeek model (no documented vision support)", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "deepseek-chat" }).capabilities?.vision).toBe(false);
    expect(sdk.model({ name: "deepseek-reasoner" }).capabilities?.vision).toBe(false);
  });

  it("honors explicit vision / reasoning overrides over the injected inference", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "deepseek-chat", vision: true }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "deepseek-reasoner", reasoning: false }).capabilities?.reasoning).toBe(
      false,
    );
  });

  it("structuredOutput stays inherited from the wrapped OpenAI model (true by default)", () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });
    expect(sdk.model({ name: "deepseek-chat" }).capabilities?.structuredOutput).toBe(true);
  });

  it("count() delegates to the wrapped OpenAISDK heuristic", async () => {
    const sdk = new DeepSeekSDK({ apiKey: "test-key" });
    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4); // 13 chars / 4 → 4
    expect(await sdk.count("a".repeat(400))).toBe(100);
  });
});

describe("DeepSeekSDK pricing resolution", () => {
  it("applies the built-in DeepSeek pricing defaults by model name", () => {
    const sdk = new DeepSeekSDK({ apiKey: "k" });
    expect(sdk.model({ name: "deepseek-chat" }).pricing).toEqual({
      input: 0.14,
      output: 0.28,
      cachedInput: 0.0028,
    });
    expect(sdk.model({ name: "deepseek-v4-pro" }).pricing).toEqual({
      input: 0.435,
      output: 0.87,
      cachedInput: 0.003625,
    });
  });

  it("a caller SDK registry overrides the built-in default for that model", () => {
    const sdk = new DeepSeekSDK({
      apiKey: "k",
      pricing: { "deepseek-chat": { input: 1, output: 2 } },
    });
    expect(sdk.model({ name: "deepseek-chat" }).pricing).toEqual({ input: 1, output: 2 });
    // untouched model keeps the built-in default
    expect(sdk.model({ name: "deepseek-reasoner" }).pricing).toEqual({
      input: 0.14,
      output: 0.28,
      cachedInput: 0.0028,
    });
  });

  it("per-model pricing wins over both the registry and the built-in default", () => {
    const sdk = new DeepSeekSDK({ apiKey: "k" });
    const override = { input: 99, output: 99 };
    expect(sdk.model({ name: "deepseek-chat", pricing: override }).pricing).toBe(override);
  });

  it("leaves pricing undefined for an unlisted model", () => {
    const sdk = new DeepSeekSDK({ apiKey: "k" });
    expect(sdk.model({ name: "some-unlisted-model" }).pricing).toBeUndefined();
  });
});
