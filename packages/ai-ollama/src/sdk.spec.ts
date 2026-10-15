import { describe, expect, it } from "vitest";
import { OllamaEmbedder } from "./embedder";
import { OllamaModel } from "./model";
import { OllamaSDK } from "./sdk";

describe("OllamaSDK", () => {
  it("constructs with no config (local default host)", () => {
    expect(new OllamaSDK()).toBeInstanceOf(OllamaSDK);
  });

  it("constructs with a custom host + headers", () => {
    const sdk = new OllamaSDK({
      host: "http://gpu-box:11434",
      headers: { Authorization: "Bearer x" },
    });

    expect(sdk).toBeInstanceOf(OllamaSDK);
  });

  it("model() returns a fresh OllamaModel each call with provider + name", () => {
    const sdk = new OllamaSDK();
    const a = sdk.model({ name: "llama3.1" });
    const b = sdk.model({ name: "llama3.1" });

    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(OllamaModel);
    expect(a.name).toBe("llama3.1");
    expect(a.provider).toBe("ollama");
  });

  it("model() honors a custom provider label", () => {
    const sdk = new OllamaSDK({ provider: "ollama-gpu" });

    expect(sdk.model({ name: "llama3.1" }).provider).toBe("ollama-gpu");
  });

  it("model() infers vision and honors explicit override", () => {
    const sdk = new OllamaSDK();

    expect(sdk.model({ name: "llama3.2-vision" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "llama3.1" }).capabilities?.vision).toBe(false);
    expect(sdk.model({ name: "llama3.1", vision: true }).capabilities?.vision).toBe(true);
  });

  it("model() defaults structuredOutput true, honors override", () => {
    const sdk = new OllamaSDK();

    expect(sdk.model({ name: "llama3.1" }).capabilities?.structuredOutput).toBe(true);
    expect(
      sdk.model({ name: "llama3.1", structuredOutput: false }).capabilities?.structuredOutput,
    ).toBe(false);
  });

  it("model() resolves SDK-level pricing by name, per-model wins", () => {
    const sdk = new OllamaSDK({ pricing: { "llama3.1": { input: 0, output: 0 } } });

    expect(sdk.model({ name: "llama3.1" }).pricing).toEqual({ input: 0, output: 0 });
    expect(
      sdk.model({ name: "llama3.1", pricing: { input: 1, output: 2 } }).pricing,
    ).toEqual({ input: 1, output: 2 });
    expect(sdk.model({ name: "mistral" }).pricing).toBeUndefined();
  });

  it("count() uses the core heuristic and ignores the model hint", async () => {
    const sdk = new OllamaSDK();

    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4);
    // 4-chars-per-token, rounded up: 5 chars -> 2 tokens.
    expect(await sdk.count("abcde")).toBe(2);
    // The optional model id is currently ignored; same input -> same count.
    expect(await sdk.count("Hello, world!", "llama3.1")).toBe(4);
  });

  it("model() carries an explicit per-model pricing even with no SDK registry", () => {
    const sdk = new OllamaSDK();

    expect(sdk.model({ name: "llama3.1", pricing: { input: 3, output: 5 } }).pricing).toEqual({
      input: 3,
      output: 5,
    });
  });

  it("model() produces distinct instances over one shared client", () => {
    const sdk = new OllamaSDK({ host: "http://gpu-box:11434" });
    const a = sdk.model({ name: "llama3.1" });
    const b = sdk.model({ name: "mistral" });

    expect(a).not.toBe(b);
    expect(a.name).toBe("llama3.1");
    expect(b.name).toBe("mistral");
  });

  it("embedder() returns a fresh OllamaEmbedder per call", () => {
    const sdk = new OllamaSDK();
    const a = sdk.embedder({ name: "nomic-embed-text" });

    expect(a).toBeInstanceOf(OllamaEmbedder);
    expect(a).not.toBe(sdk.embedder({ name: "nomic-embed-text" }));
    expect(a.dimensions).toBe(0);
    expect(sdk.embedder({ name: "nomic-embed-text", dimensions: 512 }).dimensions).toBe(512);
  });
});
