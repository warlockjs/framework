import { describe, expect, it } from "vitest";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { XaiSDK } from "./sdk";

/**
 * Reach into the wrapped OpenAI client to read the resolved `baseURL`
 * without making a network call. `XaiSDK` holds a private `openai`
 * (`OpenAISDK`), which holds a private `client` (the `OpenAI` instance).
 */
function wrappedClient(sdk: XaiSDK): { baseURL: string } {
  const openai = (sdk as unknown as { openai: OpenAISDK }).openai;

  return (openai as unknown as { client: { baseURL: string } }).client;
}

describe("XaiSDK construction", () => {
  it("constructs successfully with an apiKey", () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });
    expect(sdk).toBeInstanceOf(XaiSDK);
  });

  it("wraps an OpenAISDK internally (thin wrapper, not a reimplementation)", () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });
    const openai = (sdk as unknown as { openai: OpenAISDK }).openai;

    expect(openai).toBeInstanceOf(OpenAISDK);
  });

  it("defaults the wrapped client baseURL to the xAI OpenAI-compatible endpoint", () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });

    expect(wrappedClient(sdk).baseURL).toBe("https://api.x.ai/v1");
  });

  it("lets the caller override baseURL (proxy / gateway)", () => {
    const sdk = new XaiSDK({ apiKey: "test-key", baseURL: "https://gateway.internal/x.ai/v1" });

    expect(wrappedClient(sdk).baseURL).toBe("https://gateway.internal/x.ai/v1");
  });

  it("forwards upstream ClientOptions (maxRetries, timeout) through to the wrapped client", () => {
    const sdk = new XaiSDK({ apiKey: "test-key", maxRetries: 7, timeout: 1234 });
    const client = wrappedClient(sdk) as unknown as { maxRetries: number; timeout: number };

    expect(client.maxRetries).toBe(7);
    expect(client.timeout).toBe(1234);
  });
});

describe("XaiSDK.model() — provider label", () => {
  it("stamps produced models with provider 'xai' by default", () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "grok-4" }).provider).toBe("xai");
  });

  it("honors an explicit provider override", () => {
    const sdk = new XaiSDK({ apiKey: "test-key", provider: "xai-gateway" });

    expect(sdk.model({ name: "grok-4" }).provider).toBe("xai-gateway");
  });

  it("returns a fresh ModelContract per call carrying the model name", () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });
    const a = sdk.model({ name: "grok-4" });
    const b = sdk.model({ name: "grok-4" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("grok-4");
  });
});

describe("XaiSDK.model() — xAI capability inference", () => {
  const sdk = new XaiSDK({ apiKey: "test-key" });

  it("infers vision=true for grok-4 and grok-2-vision", () => {
    expect(sdk.model({ name: "grok-4" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "grok-2-vision" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "grok-2-vision-latest" }).capabilities?.vision).toBe(true);
  });

  it("infers vision=false for text-only Grok models", () => {
    expect(sdk.model({ name: "grok-3" }).capabilities?.vision).toBe(false);
    expect(sdk.model({ name: "grok-3-mini" }).capabilities?.vision).toBe(false);
    expect(sdk.model({ name: "grok-2" }).capabilities?.vision).toBe(false);
  });

  it("infers reasoning=true for grok-4 and grok-3-mini", () => {
    expect(sdk.model({ name: "grok-4" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "grok-3-mini" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "grok-3-mini-beta" }).capabilities?.reasoning).toBe(true);
  });

  it("infers reasoning=false for non-reasoning Grok models", () => {
    expect(sdk.model({ name: "grok-3" }).capabilities?.reasoning).toBe(false);
    expect(sdk.model({ name: "grok-2-vision" }).capabilities?.reasoning).toBe(false);
  });

  it("honors explicit capability overrides over xAI inference", () => {
    const visionForced = sdk.model({ name: "grok-3", vision: true });
    const visionDisabled = sdk.model({ name: "grok-4", vision: false });
    const reasoningForced = sdk.model({ name: "grok-3", reasoning: true });
    const reasoningDisabled = sdk.model({ name: "grok-4", reasoning: false });

    expect(visionForced.capabilities?.vision).toBe(true);
    expect(visionDisabled.capabilities?.vision).toBe(false);
    expect(reasoningForced.capabilities?.reasoning).toBe(true);
    expect(reasoningDisabled.capabilities?.reasoning).toBe(false);
  });
});

describe("XaiSDK delegation", () => {
  it("count() delegates to the heuristic token estimate", async () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });

    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4); // 13 chars / 4 → 4
  });

  it("embedder() returns a contract bound to the wrapped client", () => {
    const sdk = new XaiSDK({ apiKey: "test-key" });
    const embedder = sdk.embedder({ name: "text-embedding-3-small" });

    expect(embedder.name).toBe("text-embedding-3-small");
  });
});

describe("XaiSDK pricing resolution (delegated)", () => {
  const SDK_PRICING = { "grok-4": { input: 3, output: 15 } };

  it("resolves pricing from the SDK-level registry by model name", () => {
    const sdk = new XaiSDK({ apiKey: "k", pricing: SDK_PRICING });

    expect(sdk.model({ name: "grok-4" }).pricing).toEqual({ input: 3, output: 15 });
  });

  it("per-model pricing wins over the SDK-level registry", () => {
    const sdk = new XaiSDK({ apiKey: "k", pricing: SDK_PRICING });
    const override = { input: 99, output: 99 };

    expect(sdk.model({ name: "grok-4", pricing: override }).pricing).toBe(override);
  });

  it("leaves pricing undefined when neither covers the model", () => {
    const sdk = new XaiSDK({ apiKey: "k", pricing: SDK_PRICING });

    expect(sdk.model({ name: "grok-3" }).pricing).toBeUndefined();
  });
});
