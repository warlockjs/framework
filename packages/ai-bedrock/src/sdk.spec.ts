import { describe, expect, it } from "vitest";
import { BedrockEmbedder } from "./embedder";
import { BedrockModel } from "./model";
import { BedrockSDK } from "./sdk";

describe("BedrockSDK", () => {
  it("constructs with region only (ambient credential chain)", () => {
    expect(new BedrockSDK({ region: "us-east-1" })).toBeInstanceOf(BedrockSDK);
  });

  it("constructs with explicit static credentials", () => {
    const sdk = new BedrockSDK({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
    });

    expect(sdk).toBeInstanceOf(BedrockSDK);
  });

  it("model() returns a fresh BedrockModel each call with provider + name", () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });
    const a = sdk.model({ name: "anthropic.claude-sonnet-4-5-20250929-v1:0" });
    const b = sdk.model({ name: "anthropic.claude-sonnet-4-5-20250929-v1:0" });

    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(BedrockModel);
    expect(a.name).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(a.provider).toBe("bedrock");
  });

  it("model() honors a custom provider label", () => {
    const sdk = new BedrockSDK({ region: "us-east-1", provider: "bedrock-eu" });

    expect(sdk.model({ name: "amazon.nova-pro-v1:0" }).provider).toBe("bedrock-eu");
  });

  it("model() infers vision and honors explicit override", () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });

    expect(sdk.model({ name: "us.amazon.nova-pro-v1:0" }).capabilities?.vision).toBe(true);
    expect(sdk.model({ name: "amazon.titan-text-express-v1" }).capabilities?.vision).toBe(false);
    expect(
      sdk.model({ name: "amazon.titan-text-express-v1", vision: true }).capabilities?.vision,
    ).toBe(true);
  });

  it("model() defaults structuredOutput true, honors override", () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });

    expect(sdk.model({ name: "amazon.nova-pro-v1:0" }).capabilities?.structuredOutput).toBe(true);
    expect(
      sdk.model({ name: "amazon.nova-pro-v1:0", structuredOutput: false }).capabilities
        ?.structuredOutput,
    ).toBe(false);
  });

  it("model() resolves SDK-level pricing by id, per-model wins", () => {
    const sdk = new BedrockSDK({
      region: "us-east-1",
      pricing: { "amazon.nova-pro-v1:0": { input: 0.8, output: 3.2 } },
    });

    expect(sdk.model({ name: "amazon.nova-pro-v1:0" }).pricing).toEqual({ input: 0.8, output: 3.2 });
    expect(
      sdk.model({ name: "amazon.nova-pro-v1:0", pricing: { input: 1, output: 2 } }).pricing,
    ).toEqual({ input: 1, output: 2 });
    expect(sdk.model({ name: "amazon.nova-lite-v1:0" }).pricing).toBeUndefined();
  });

  it("count() uses the core heuristic (ceil of length / 4)", async () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });

    expect(await sdk.count("")).toBe(0);
    expect(await sdk.count("Hello, world!")).toBe(4);
    // 4 chars → exactly 1; 5 chars → ceil(1.25) = 2.
    expect(await sdk.count("abcd")).toBe(1);
    expect(await sdk.count("abcde")).toBe(2);
  });

  it("count() ignores the optional model argument", async () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });

    expect(await sdk.count("abcd", "amazon.nova-pro-v1:0")).toBe(1);
  });

  it("model() forwards the custom provider onto the produced model", () => {
    const sdk = new BedrockSDK({ region: "us-east-1", provider: "bedrock-staging" });

    expect(sdk.model({ name: "amazon.nova-pro-v1:0" }).provider).toBe("bedrock-staging");
  });

  it("embedder() returns a fresh BedrockEmbedder per call", () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });
    const a = sdk.embedder({ name: "amazon.titan-embed-text-v2:0" });
    const b = sdk.embedder({ name: "amazon.titan-embed-text-v2:0" });

    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(BedrockEmbedder);
    expect(a.name).toBe("amazon.titan-embed-text-v2:0");
    expect(a.dimensions).toBe(0);
    expect(sdk.embedder({ name: "amazon.titan-embed-text-v2:0", dimensions: 256 }).dimensions).toBe(
      256,
    );
  });

  it("embedder() forwards the custom provider label", () => {
    const sdk = new BedrockSDK({ region: "us-east-1", provider: "bedrock-eu" });

    expect(sdk.embedder({ name: "amazon.titan-embed-text-v2:0" }).provider).toBe("bedrock-eu");
  });

  it("embedder() defaults the provider label to 'bedrock'", () => {
    const sdk = new BedrockSDK({ region: "us-east-1" });

    expect(sdk.embedder({ name: "amazon.titan-embed-text-v2:0" }).provider).toBe("bedrock");
  });

  it("model() resolves pricing identically whether or not an SDK registry exists", () => {
    // With no SDK registry and no per-model pricing, pricing stays undefined.
    const bare = new BedrockSDK({ region: "us-east-1" });

    expect(bare.model({ name: "amazon.nova-pro-v1:0" }).pricing).toBeUndefined();
  });
});
