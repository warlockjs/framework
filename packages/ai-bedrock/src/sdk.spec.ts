import { Readable } from "node:stream";
import { InvalidRequestError } from "@warlock.js/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    expect(sdk.model({ name: "amazon.nova-pro-v1:0" }).pricing).toEqual({
      input: 0.8,
      output: 3.2,
    });
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

/**
 * A request handler that records the signed request and answers with a
 * minimal Converse response, so the real client middleware stack (auth
 * scheme selection, signing) runs without a network call.
 */
function recordingHandler() {
  const requests: Array<{ headers: Record<string, string>; path: string }> = [];
  const handler = {
    async handle(request: { headers: Record<string, string>; path: string }) {
      requests.push({ headers: { ...request.headers }, path: request.path });

      return {
        response: {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: Readable.from([
            Buffer.from(
              JSON.stringify({
                output: { message: { role: "assistant", content: [{ text: "hello" }] } },
                stopReason: "end_turn",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              }),
            ),
          ]),
        },
      };
    },
  };

  return { handler, requests };
}

describe("BedrockSDK apiKey (Amazon Bedrock API keys)", () => {
  const envKey = "AWS_BEARER_TOKEN_BEDROCK";
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[envKey];
    delete process.env[envKey];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = savedEnv;
  });

  it("sends the key as a bearer token instead of a SigV4 signature", async () => {
    const { handler, requests } = recordingHandler();
    const sdk = new BedrockSDK({
      apiKey: "bedrock-api-key-123",
      region: "us-east-1",
      requestHandler: handler,
    });

    const response = await sdk
      .model({ name: "amazon.nova-pro-v1:0" })
      .complete([{ role: "user", content: "hi" }]);

    expect(response.content).toBe("hello");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.authorization ?? requests[0]?.headers.Authorization).toBe(
      "Bearer bedrock-api-key-123",
    );
    expect(JSON.stringify(requests[0]?.headers)).not.toContain("AWS4-HMAC-SHA256");
    expect(requests[0]?.path).toContain("/converse");
  });

  it("keeps SigV4 signing when credentials are passed instead", async () => {
    const { handler, requests } = recordingHandler();
    const sdk = new BedrockSDK({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
      requestHandler: handler,
    });

    await sdk.model({ name: "amazon.nova-pro-v1:0" }).complete([{ role: "user", content: "hi" }]);

    expect(requests[0]?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("rejects an empty key", () => {
    expect(() => new BedrockSDK({ apiKey: "  ", region: "us-east-1" })).toThrow(
      InvalidRequestError,
    );
  });

  it("rejects a key combined with credentials or a token", () => {
    expect(
      () =>
        new BedrockSDK({
          apiKey: "k",
          region: "us-east-1",
          credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
        }),
    ).toThrow(/either `apiKey` or `credentials`/);
    expect(
      () => new BedrockSDK({ apiKey: "k", region: "us-east-1", token: { token: "other" } }),
    ).toThrow(InvalidRequestError);
  });
});
