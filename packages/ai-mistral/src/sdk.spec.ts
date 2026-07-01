import { describe, expect, it } from "vitest";
import { OpenAISDK } from "@warlock.js/ai-openai";
import { MISTRAL_DEFAULT_PRICING } from "./known-models";
import { MistralSDK } from "./sdk";

/**
 * Reach through the wrapper to the inner OpenAI client to assert wiring
 * without any network call: `MistralSDK` → private `openai: OpenAISDK` →
 * private `client: OpenAI` (which exposes `baseURL`).
 */
function innerClient(sdk: MistralSDK): { baseURL: string; maxRetries: number; timeout: number } {
  const openai = (sdk as unknown as { openai: OpenAISDK }).openai;

  return (openai as unknown as { client: { baseURL: string; maxRetries: number; timeout: number } })
    .client;
}

describe("MistralSDK", () => {
  it("wraps an OpenAISDK pointed at the Mistral OpenAI-compatible baseURL", () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });
    const openai = (sdk as unknown as { openai: OpenAISDK }).openai;

    expect(openai).toBeInstanceOf(OpenAISDK);
    expect(innerClient(sdk).baseURL).toBe("https://api.mistral.ai/v1");
  });

  it("defaults the provider label to \"mistral\" on produced models", () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });
    expect(sdk.model({ name: "mistral-large-latest" }).provider).toBe("mistral");
  });

  it("honors an explicit baseURL / provider override (Mistral-compatible gateway)", () => {
    const sdk = new MistralSDK({
      apiKey: "test-key",
      baseURL: "https://gateway.example/v1",
      provider: "mistral-proxy",
    });

    expect(innerClient(sdk).baseURL).toBe("https://gateway.example/v1");
    expect(sdk.model({ name: "mistral-large-latest" }).provider).toBe("mistral-proxy");
  });

  it("forwards upstream ClientOptions (timeout, maxRetries) through to the OpenAI client", () => {
    const sdk = new MistralSDK({ apiKey: "test-key", maxRetries: 7, timeout: 1234 });
    const client = innerClient(sdk);

    expect(client.maxRetries).toBe(7);
    expect(client.timeout).toBe(1234);
  });

  it("model() returns a fresh ModelContract each call", () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });
    const a = sdk.model({ name: "mistral-large-latest" });
    const b = sdk.model({ name: "mistral-large-latest" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("mistral-large-latest");
  });
});

describe("MistralSDK capability inference", () => {
  const sdk = new MistralSDK({ apiKey: "test-key" });

  it("infers vision=true for the pixtral family and recent multimodal generations", () => {
    expect(sdk.model({ name: "pixtral-large-latest" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "pixtral-12b" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "mistral-large-latest" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "ministral-3-8b-25-12" }).capabilities?.vision).toBe(true);
  });

  it("infers vision=false for text-only / reasoning models", () => {
    expect(sdk.model({ name: "magistral-medium-latest" }).capabilities?.vision).toBe(false);
  });

  it("infers reasoning=true for the magistral family and the hybrid small generation", () => {
    expect(sdk.model({ name: "magistral-medium-latest" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "magistral-small-latest" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "mistral-small-2603" }).capabilities?.reasoning).toBe(true);
  });

  it("infers reasoning=false for non-reasoning chat / vision models", () => {
    expect(sdk.model({ name: "mistral-large-latest" }).capabilities?.reasoning).toBe(false);
    expect(sdk.model({ name: "pixtral-12b" }).capabilities?.reasoning).toBe(false);
  });

  it("honors explicit vision / reasoning overrides over inference", () => {
    const forcedVision = sdk.model({ name: "magistral-medium-latest", vision: true });
    const disabledVision = sdk.model({ name: "pixtral-large-latest", vision: false });
    const forcedReasoning = sdk.model({ name: "mistral-large-latest", reasoning: true });

    expect(forcedVision.capabilities?.vision).toBe(true);
    expect(disabledVision.capabilities?.vision).toBe(false);
    expect(forcedReasoning.capabilities?.reasoning).toBe(true);
  });
});

describe("MistralSDK pricing", () => {
  it("surfaces the default Mistral pricing registry onto produced models", () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });
    const model = sdk.model({ name: "mistral-large-latest" });

    expect(model.pricing).toEqual(MISTRAL_DEFAULT_PRICING["mistral-large-latest"]);
  });

  it("lets caller SDK-level pricing win over the defaults per model id", () => {
    const override = { input: 99, output: 99 };
    const sdk = new MistralSDK({
      apiKey: "test-key",
      pricing: { "mistral-large-latest": override },
    });

    expect(sdk.model({ name: "mistral-large-latest" }).pricing).toEqual(override);
  });

  it("lets per-model pricing win over both SDK and default registries", () => {
    const override = { input: 1, output: 2 };
    const sdk = new MistralSDK({ apiKey: "test-key" });

    expect(sdk.model({ name: "mistral-large-latest", pricing: override }).pricing).toBe(override);
  });

  it("leaves pricing undefined for a model id absent from every registry", () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });
    expect(sdk.model({ name: "unlisted-model" }).pricing).toBeUndefined();
  });
});

describe("MistralSDK.embedder()", () => {
  it("delegates to the wrapped OpenAI embedder (mistral-embed)", () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });
    const embedder = sdk.embedder({ name: "mistral-embed" });

    expect(embedder.name).toBe("mistral-embed");
  });
});

describe("MistralSDK.count()", () => {
  it("delegates to the shared offline heuristic", async () => {
    const sdk = new MistralSDK({ apiKey: "test-key" });

    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4); // 13 chars / 4 → 4
  });
});
