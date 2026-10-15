import { ContentFilterError, ProviderError, ProviderRateLimitError } from "@warlock.js/ai";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateImagesParameters,
  GenerateImagesResponse,
  GoogleGenAI,
} from "@google/genai";
import { describe, expect, it } from "vitest";
import { GeminiImageModel } from "./gemini-image";
import { GoogleImageModel } from "./image";
import { GoogleSDK } from "./sdk";

type FakeClientOptions = {
  response?: Partial<GenerateContentResponse>;
  error?: unknown;
};

/**
 * Fake `GoogleGenAI` exposing BOTH image transports — `generateContent`
 * and `generateImages` — each recording its params. Having both on one
 * client is what lets a spec prove which endpoint an id actually
 * reached, not merely which class was constructed. Mirrors the
 * fake-client pattern in `image.spec.ts`; no network is touched.
 */
function makeFakeClient(options: FakeClientOptions = {}) {
  const generateContentCalls: GenerateContentParameters[] = [];
  const generateImagesCalls: GenerateImagesParameters[] = [];

  const generateContent = async (params: GenerateContentParameters) => {
    generateContentCalls.push(params);
    if (options.error) throw options.error;
    return (options.response ?? {}) as GenerateContentResponse;
  };

  const generateImages = async (params: GenerateImagesParameters) => {
    generateImagesCalls.push(params);
    return { generatedImages: [{ image: { imageBytes: "QUJD" } }] } as GenerateImagesResponse;
  };

  const client = { models: { generateContent, generateImages } } as unknown as GoogleGenAI;

  return { client, generateContentCalls, generateImagesCalls };
}

/**
 * Build an SDK whose private client is the fake one, so `sdk.image()`
 * routing can be followed all the way to the called endpoint.
 */
function sdkWithClient(client: GoogleGenAI, config: { apiKey: string } = { apiKey: "test" }) {
  const sdk = new GoogleSDK(config);

  (sdk as unknown as { ai: GoogleGenAI }).ai = client;

  return sdk;
}

/** A response carrying one inline image part. */
function imageResponse(
  overrides: Partial<GenerateContentResponse> = {},
): Partial<GenerateContentResponse> {
  return {
    candidates: [
      { content: { parts: [{ inlineData: { data: "QUJD", mimeType: "image/png" } }] } },
    ],
    ...overrides,
  } as Partial<GenerateContentResponse>;
}

describe("GoogleSDK.image() — transport routing", () => {
  it("sends a gemini-* id to generateContent and never to generateImages", async () => {
    const { client, generateContentCalls, generateImagesCalls } = makeFakeClient({
      response: imageResponse(),
    });
    const sdk = sdkWithClient(client);

    const model = sdk.image({ name: "gemini-3.1-flash-lite-image" });
    await model.generate("a red bicycle on a white background");

    expect(model).toBeInstanceOf(GeminiImageModel);
    expect(generateContentCalls).toHaveLength(1);
    expect(generateContentCalls[0].model).toBe("gemini-3.1-flash-lite-image");
    expect(generateImagesCalls).toHaveLength(0);
  });

  it("still sends an imagen-* id to generateImages", async () => {
    const { client, generateContentCalls, generateImagesCalls } = makeFakeClient();
    const sdk = sdkWithClient(client);

    const model = sdk.image({ name: "imagen-4.0-generate-001" });
    await model.generate("a watercolor lighthouse");

    expect(model).toBeInstanceOf(GoogleImageModel);
    expect(generateImagesCalls).toHaveLength(1);
    expect(generateImagesCalls[0].model).toBe("imagen-4.0-generate-001");
    expect(generateContentCalls).toHaveLength(0);
  });

  it("routes an unrecognized id to the Imagen transport instead of rejecting it", async () => {
    const { client, generateImagesCalls } = makeFakeClient();
    const sdk = sdkWithClient(client);

    const model = sdk.image({ name: "some-unlisted-image-model" });
    await model.generate("x");

    expect(model).toBeInstanceOf(GoogleImageModel);
    expect(generateImagesCalls[0].model).toBe("some-unlisted-image-model");
  });

  it("tolerates the models/ resource prefix on a gemini id", () => {
    const sdk = new GoogleSDK({ apiKey: "test" });

    expect(sdk.image({ name: "models/gemini-3.1-flash-lite-image" })).toBeInstanceOf(
      GeminiImageModel,
    );
  });

  it("forwards the SDK provider label and resolves SDK-level pricing", () => {
    const sdk = new GoogleSDK({
      apiKey: "k",
      provider: "vertex",
      pricing: { "gemini-3.1-flash-lite-image": { input: 0.3, output: 30 } },
    });

    const model = sdk.image({ name: "gemini-3.1-flash-lite-image" });

    expect(model.provider).toBe("vertex");
    expect(model.pricing).toEqual({ input: 0.3, output: 30 });
  });
});

describe("GeminiImageModel.generate() — request", () => {
  it("asks for the IMAGE response modality", async () => {
    const { client, generateContentCalls } = makeFakeClient({ response: imageResponse() });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await model.generate("a red bicycle");

    expect(generateContentCalls[0].config?.responseModalities).toContain("IMAGE");
  });

  it("passes the prompt as the request contents", async () => {
    const { client, generateContentCalls } = makeFakeClient({ response: imageResponse() });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await model.generate("a red bicycle");

    expect(generateContentCalls[0].contents).toBe("a red bicycle");
  });

  it("honors an explicit responseModalities override", async () => {
    const { client, generateContentCalls } = makeFakeClient({ response: imageResponse() });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await model.generate("x", { responseModalities: ["IMAGE"] });

    expect(generateContentCalls[0].config?.responseModalities).toEqual(["IMAGE"]);
  });

  it("maps aspectRatio and the image passthroughs onto imageConfig", async () => {
    const { client, generateContentCalls } = makeFakeClient({ response: imageResponse() });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });
    const controller = new AbortController();

    await model.generate("x", {
      aspectRatio: "16:9",
      imageSize: "2K",
      personGeneration: "ALLOW_ADULT",
      signal: controller.signal,
    });

    expect(generateContentCalls[0].config?.imageConfig).toEqual({
      aspectRatio: "16:9",
      imageSize: "2K",
      personGeneration: "ALLOW_ADULT",
    });
    expect(generateContentCalls[0].config?.abortSignal).toBe(controller.signal);
  });

  it("omits imageConfig entirely when no image option is given", async () => {
    const { client, generateContentCalls } = makeFakeClient({ response: imageResponse() });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await model.generate("x");

    expect(generateContentCalls[0].config).not.toHaveProperty("imageConfig");
  });
});

describe("GeminiImageModel.generate() — response", () => {
  it("maps inline image parts to the GeneratedImage shape", async () => {
    const { client } = makeFakeClient({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: "Here you go" },
                { inlineData: { data: "QUJD", mimeType: "image/png" } },
                { inlineData: { data: "REVG", mimeType: "image/jpeg" } },
              ],
            },
          },
        ],
      } as Partial<GenerateContentResponse>,
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    const { images } = await model.generate("x");

    expect(images).toEqual([
      { type: "base64", base64: "QUJD", mediaType: "image/png" },
      { type: "base64", base64: "REVG", mediaType: "image/jpeg" },
    ]);
  });

  it("falls back to image/png when the part declares no mime type", async () => {
    const { client } = makeFakeClient({
      response: {
        candidates: [{ content: { parts: [{ inlineData: { data: "QUJD" } }] } }],
      } as Partial<GenerateContentResponse>,
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    const { images } = await model.generate("x");

    expect(images[0]).toEqual({ type: "base64", base64: "QUJD", mediaType: "image/png" });
  });

  it("maps a reported usageMetadata into usage instead of Imagen's hard zero", async () => {
    const { client } = makeFakeClient({
      response: imageResponse({
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 1290,
          totalTokenCount: 1302,
          cachedContentTokenCount: 4,
          thoughtsTokenCount: 7,
        },
      } as Partial<GenerateContentResponse>),
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    const { usage } = await model.generate("x");

    expect(usage).toEqual({
      input: 12,
      output: 1290,
      total: 1302,
      cachedTokens: 4,
      reasoningTokens: 7,
    });
  });

  it("collapses usage to zeros when Google reports none", async () => {
    const { client } = makeFakeClient({ response: imageResponse() });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    const { usage } = await model.generate("x");

    expect(usage).toEqual({ input: 0, output: 0, total: 0 });
  });
});

describe("GeminiImageModel.generate() — no image came back", () => {
  it("throws a ProviderError quoting a text-only answer", async () => {
    const { client } = makeFakeClient({
      response: {
        candidates: [
          {
            content: { parts: [{ text: "I can't draw that, but here's a description." }] },
            finishReason: "STOP",
          },
        ],
      } as Partial<GenerateContentResponse>,
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await expect(model.generate("x")).rejects.toThrowError(
      /text only: "I can't draw that, but here's a description\."/,
    );
    await expect(model.generate("x")).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws a ProviderError naming the finish reason when nothing came back at all", async () => {
    const { client } = makeFakeClient({
      response: {
        candidates: [{ content: { parts: [] }, finishReason: "NO_IMAGE" }],
      } as Partial<GenerateContentResponse>,
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await expect(model.generate("x")).rejects.toThrowError(/NO_IMAGE/);
  });

  it("throws ContentFilterError on a safety finish reason", async () => {
    const { client } = makeFakeClient({
      response: {
        candidates: [{ content: { parts: [] }, finishReason: "IMAGE_SAFETY" }],
      } as Partial<GenerateContentResponse>,
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await expect(model.generate("x")).rejects.toBeInstanceOf(ContentFilterError);
  });

  it("throws ContentFilterError when the prompt itself was blocked", async () => {
    const { client } = makeFakeClient({
      response: {
        promptFeedback: { blockReason: "SAFETY" },
        candidates: [],
      } as unknown as Partial<GenerateContentResponse>,
    });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await expect(model.generate("x")).rejects.toBeInstanceOf(ContentFilterError);
  });
});

describe("GeminiImageModel.generate() — provider errors", () => {
  it("wraps a provider error into the typed AIError hierarchy", async () => {
    const { client } = makeFakeClient({ error: { status: 429, message: "resource_exhausted" } });
    const model = new GeminiImageModel(client, { name: "gemini-3.1-flash-lite-image" });

    await expect(model.generate("x")).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it("does not reject an unknown id locally — the call still reaches the provider", async () => {
    const { client, generateContentCalls } = makeFakeClient({
      error: { status: 404, message: "models/whatever is not found for API version v1beta" },
    });
    const model = new GeminiImageModel(client, { name: "gemini-not-a-real-model" });

    await expect(model.generate("x")).rejects.toThrowError(/is not found/);
    expect(generateContentCalls[0].model).toBe("gemini-not-a-real-model");
  });
});
