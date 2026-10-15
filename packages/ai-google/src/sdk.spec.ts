import { describe, expect, it } from "vitest";
import { GoogleEmbedder } from "./embedder";
import { GoogleModel } from "./model";
import { GoogleSDK } from "./sdk";

describe("GoogleSDK", () => {
  it("constructs with an apiKey", () => {
    expect(new GoogleSDK({ apiKey: "test-key" })).toBeInstanceOf(GoogleSDK);
  });

  it("model() returns a fresh GoogleModel each call with provider + name", () => {
    const sdk = new GoogleSDK({ apiKey: "test-key" });
    const a = sdk.model({ name: "gemini-2.5-flash" });
    const b = sdk.model({ name: "gemini-2.5-flash" });

    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(GoogleModel);
    expect(a.name).toBe("gemini-2.5-flash");
    expect(a.provider).toBe("google");
  });

  it("model() honors a custom provider label", () => {
    const sdk = new GoogleSDK({ apiKey: "k", provider: "vertex" });

    expect(sdk.model({ name: "gemini-2.5-pro" }).provider).toBe("vertex");
  });

  it("model() infers vision and honors explicit override", () => {
    const sdk = new GoogleSDK({ apiKey: "k" });

    expect(sdk.model({ name: "gemini-2.5-flash" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "gemini-1.0-pro" }).capabilities?.vision).toBe(false);
    expect(sdk.model({ name: "gemini-1.0-pro", vision: true }).capabilities?.vision).toBe(true);
  });

  it("model() defaults structuredOutput true, honors override", () => {
    const sdk = new GoogleSDK({ apiKey: "k" });

    expect(sdk.model({ name: "gemini-2.5-flash" }).capabilities?.structuredOutput).toBe(true);
    expect(
      sdk.model({ name: "gemini-2.5-flash", structuredOutput: false }).capabilities
        ?.structuredOutput,
    ).toBe(false);
  });

  it("model() resolves SDK-level pricing by name, per-model wins", () => {
    const sdk = new GoogleSDK({
      apiKey: "k",
      pricing: { "gemini-2.5-flash": { input: 0.3, output: 2.5 } },
    });

    expect(sdk.model({ name: "gemini-2.5-flash" }).pricing).toEqual({ input: 0.3, output: 2.5 });
    expect(
      sdk.model({ name: "gemini-2.5-flash", pricing: { input: 1, output: 2 } }).pricing,
    ).toEqual({ input: 1, output: 2 });
    expect(sdk.model({ name: "gemini-2.5-pro" }).pricing).toBeUndefined();
  });

  it("count() uses the core heuristic and ignores the optional model arg", async () => {
    const sdk = new GoogleSDK({ apiKey: "k" });

    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4);
    // ceil(20 / 4) = 5; the model argument is accepted but unused (offline estimate).
    expect(await sdk.count("12345678901234567890", "gemini-2.5-pro")).toBe(5);
  });

  it("embedder() forwards the SDK provider label to the embedder", () => {
    const sdk = new GoogleSDK({ apiKey: "k", provider: "vertex" });

    expect(sdk.embedder({ name: "gemini-embedding-001" }).provider).toBe("vertex");
  });

  it("model() leaves pricing undefined when neither per-model nor SDK registry has it", () => {
    const sdk = new GoogleSDK({ apiKey: "k" });

    expect(sdk.model({ name: "gemini-2.5-flash" }).pricing).toBeUndefined();
  });

  it("embedder() returns a fresh GoogleEmbedder per call", () => {
    const sdk = new GoogleSDK({ apiKey: "k" });
    const a = sdk.embedder({ name: "gemini-embedding-001" });

    expect(a).toBeInstanceOf(GoogleEmbedder);
    expect(a).not.toBe(sdk.embedder({ name: "gemini-embedding-001" }));
    expect(a.dimensions).toBe(0);
    expect(sdk.embedder({ name: "gemini-embedding-001", dimensions: 768 }).dimensions).toBe(768);
  });
});
