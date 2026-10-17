import { describe, expect, it } from "vitest";
import { GROQ_BASE_URL } from "./known-models";
import { GroqSDK } from "./sdk";

/**
 * Reach into the wrapper's private inner OpenAISDK and that adapter's
 * private `OpenAI` client to assert the baseURL Groq points at. No HTTP
 * — we only inspect constructed objects, mirroring the OpenAI adapter's
 * own `client.maxRetries` introspection test.
 */
function innerBaseURL(sdk: GroqSDK): string {
  const openai = (sdk as unknown as { openai: { client: { baseURL: string } } }).openai;

  return openai.client.baseURL;
}

describe("GroqSDK", () => {
  it("constructs successfully with an apiKey", () => {
    const sdk = new GroqSDK({ apiKey: "test-key" });
    expect(sdk).toBeInstanceOf(GroqSDK);
  });

  it("defaults the inner client's baseURL to Groq's OpenAI-compatible endpoint", () => {
    const sdk = new GroqSDK({ apiKey: "test-key" });
    expect(innerBaseURL(sdk)).toBe(GROQ_BASE_URL);
    expect(GROQ_BASE_URL).toBe("https://api.groq.com/openai/v1");
  });

  it("honors an explicit baseURL override (proxy / gateway)", () => {
    const sdk = new GroqSDK({ apiKey: "k", baseURL: "https://proxy.example/openai/v1" });
    expect(innerBaseURL(sdk)).toBe("https://proxy.example/openai/v1");
  });

  it("forwards upstream ClientOptions (timeout, maxRetries) through to the inner client", () => {
    const sdk = new GroqSDK({ apiKey: "test-key", maxRetries: 7, timeout: 1234 });
    const client = (
      sdk as unknown as { openai: { client: { maxRetries: number; timeout: number } } }
    ).openai.client;

    expect(client.maxRetries).toBe(7);
    expect(client.timeout).toBe(1234);
  });

  it("labels every produced model with the groq provider by default", () => {
    const sdk = new GroqSDK({ apiKey: "test-key" });
    expect(sdk.model({ name: "llama-3.3-70b-versatile" }).provider).toBe("groq");
  });

  it("honors a custom provider label", () => {
    const sdk = new GroqSDK({ apiKey: "k", provider: "groq-eu" });
    expect(sdk.model({ name: "llama-3.1-8b-instant" }).provider).toBe("groq-eu");
  });

  it("model() returns a fresh ModelContract each call", () => {
    const sdk = new GroqSDK({ apiKey: "test-key" });
    const a = sdk.model({ name: "llama-3.3-70b-versatile" });
    const b = sdk.model({ name: "llama-3.3-70b-versatile" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("llama-3.3-70b-versatile");
  });
});

describe("GroqSDK capability inference (Groq model names, not OpenAI's)", () => {
  const sdk = new GroqSDK({ apiKey: "test-key" });

  it("infers vision for multimodal families and not for text-only Llama", () => {
    expect(sdk.model({ name: "openai/gpt-oss-120b" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "meta-llama/llama-4-scout" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "llama-3.3-70b-versatile" }).capabilities?.vision).toBe(false);
    expect(sdk.model({ name: "llama-3.1-8b-instant" }).capabilities?.vision).toBe(false);
  });

  it("infers reasoning for gpt-oss / deepseek-r1 and not for plain Llama", () => {
    expect(sdk.model({ name: "openai/gpt-oss-20b" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "deepseek-r1-distill-llama-70b" }).capabilities?.reasoning).toBe(true);
    expect(sdk.model({ name: "llama-3.3-70b-versatile" }).capabilities?.reasoning).toBe(false);
  });

  it("declares structuredOutput=true by default", () => {
    expect(sdk.model({ name: "llama-3.3-70b-versatile" }).capabilities?.structuredOutput).toBe(
      true,
    );
  });

  it("lets an explicit capability override win over inference", () => {
    expect(sdk.model({ name: "llama-3.3-70b-versatile", vision: true }).capabilities?.vision).toBe(
      true,
    );
    expect(sdk.model({ name: "openai/gpt-oss-120b", vision: false }).capabilities?.vision).toBe(
      false,
    );
    expect(
      sdk.model({ name: "openai/gpt-oss-120b", reasoning: false }).capabilities?.reasoning,
    ).toBe(false);
  });
});

describe("GroqSDK pricing resolution", () => {
  it("falls back to the adapter's built-in default rate for a known model", () => {
    const sdk = new GroqSDK({ apiKey: "k" });
    expect(sdk.model({ name: "openai/gpt-oss-120b" }).pricing).toEqual({
      input: 0.15,
      output: 0.6,
      cachedInput: 0.075,
    });
  });

  it("leaves models without a published price unpriced", () => {
    const sdk = new GroqSDK({ apiKey: "k" });
    expect(sdk.model({ name: "llama-3.3-70b-versatile" }).pricing).toBeUndefined();
  });

  it("resolves pricing from the SDK-level registry over the built-in default", () => {
    const sdk = new GroqSDK({
      apiKey: "k",
      pricing: { "llama-3.3-70b-versatile": { input: 1, output: 2 } },
    });
    expect(sdk.model({ name: "llama-3.3-70b-versatile" }).pricing).toEqual({ input: 1, output: 2 });
  });

  it("per-model pricing wins over both registry and built-in default", () => {
    const sdk = new GroqSDK({
      apiKey: "k",
      pricing: { "llama-3.3-70b-versatile": { input: 1, output: 2 } },
    });
    const override = { input: 99, output: 99 };
    expect(sdk.model({ name: "llama-3.3-70b-versatile", pricing: override }).pricing).toBe(
      override,
    );
  });

  it("leaves pricing undefined for an unknown model with no registry entry", () => {
    const sdk = new GroqSDK({ apiKey: "k" });
    expect(sdk.model({ name: "some-unlisted-model" }).pricing).toBeUndefined();
  });
});

describe("GroqSDK.count()", () => {
  it("delegates to the core approximate heuristic", async () => {
    const sdk = new GroqSDK({ apiKey: "test-key" });
    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4); // 13 chars / 4 → 4
    expect(await sdk.count("a".repeat(400))).toBe(100);
  });
});

describe("GroqSDK.embedder()", () => {
  it("returns a fresh embedder per call (delegated to the inner OpenAISDK)", () => {
    const sdk = new GroqSDK({ apiKey: "test-key" });
    const a = sdk.embedder({ name: "any-embeddings-model" });
    const b = sdk.embedder({ name: "any-embeddings-model" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("any-embeddings-model");
  });
});
