import {
  ContentFilterError,
  InvalidRequestError,
  ProviderError,
  ProviderRateLimitError,
} from "@warlock.js/ai";
import type {
  GenerateImagesParameters,
  GenerateImagesResponse,
  GoogleGenAI,
} from "@google/genai";
import { describe, expect, it } from "vitest";
import { GoogleImageModel } from "./image";
import { isGoogleImageModel } from "./known-image-models";
import { GoogleSDK } from "./sdk";

type GenerateCall = { params: GenerateImagesParameters };

/**
 * Fake `GoogleGenAI` whose `models.generateImages()` records its
 * params and returns a scripted response (or throws). Mirrors the
 * adapter spec pattern across the package.
 */
function makeFakeClient(options: { response?: Partial<GenerateImagesResponse>; error?: unknown }) {
  const calls: GenerateCall[] = [];

  const generateImages = async (params: GenerateImagesParameters) => {
    calls.push({ params });
    if (options.error) throw options.error;
    return options.response as GenerateImagesResponse;
  };

  const client = { models: { generateImages } } as unknown as GoogleGenAI;

  return { client, calls };
}

describe("isGoogleImageModel", () => {
  it("recognizes the imagen family, rejects gemini chat models", () => {
    expect(isGoogleImageModel("imagen-4.0-generate-001")).toBe(true);
    expect(isGoogleImageModel("imagen-3.0-fast-generate-001")).toBe(true);
    expect(isGoogleImageModel("gemini-2.5-flash")).toBe(false);
  });
});

describe("GoogleImageModel — construction guard", () => {
  it("throws InvalidRequestError for a non-Imagen model id", () => {
    const { client } = makeFakeClient({ response: { generatedImages: [] } });
    expect(() => new GoogleImageModel(client, { name: "gemini-2.5-flash" })).toThrow(
      InvalidRequestError,
    );
  });

  it("rejects a chat model through the SDK factory too", () => {
    const sdk = new GoogleSDK({ apiKey: "test" });
    expect(() => sdk.image({ name: "gemini-2.5-flash" })).toThrow(InvalidRequestError);
  });
});

describe("GoogleImageModel.generate()", () => {
  it("returns base64 images with zero token usage", async () => {
    const { client } = makeFakeClient({
      response: {
        generatedImages: [
          { image: { imageBytes: "QUJD", mimeType: "image/png" }, enhancedPrompt: "a calm lake" },
        ],
      },
    });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    const { images, usage } = await model.generate("a lake");

    expect(images).toEqual([
      { type: "base64", base64: "QUJD", mediaType: "image/png", revisedPrompt: "a calm lake" },
    ]);
    expect(usage).toEqual({ input: 0, output: 0, total: 0 });
  });

  it("maps neutral options onto the Imagen config", async () => {
    const { client, calls } = makeFakeClient({
      response: { generatedImages: [{ image: { imageBytes: "QUJD" } }] },
    });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });
    const controller = new AbortController();

    await model.generate("x", {
      count: 3,
      aspectRatio: "16:9",
      negativePrompt: "blurry",
      format: "jpeg",
      signal: controller.signal,
    });

    expect(calls[0].params.model).toBe("imagen-4.0-generate-001");
    expect(calls[0].params.config).toMatchObject({
      numberOfImages: 3,
      aspectRatio: "16:9",
      negativePrompt: "blurry",
      outputMimeType: "image/jpeg",
      abortSignal: controller.signal,
    });
  });

  it("forwards the Imagen-specific imageSize / personGeneration passthroughs", async () => {
    const { client, calls } = makeFakeClient({
      response: { generatedImages: [{ image: { imageBytes: "QUJD" } }] },
    });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    await model.generate("x", { imageSize: "2K", personGeneration: "allow_adult" });

    expect(calls[0].params.config).toMatchObject({
      imageSize: "2K",
      personGeneration: "allow_adult",
    });
  });

  it("ignores a non-string imageSize (typeof guard)", async () => {
    const { client, calls } = makeFakeClient({
      response: { generatedImages: [{ image: { imageBytes: "QUJD" } }] },
    });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    await model.generate("x", { imageSize: 1024 as unknown as string });

    expect(calls[0].params.config).not.toHaveProperty("imageSize");
  });

  it("falls back to image/png when no mimeType or format is given", async () => {
    const { client } = makeFakeClient({
      response: { generatedImages: [{ image: { imageBytes: "QUJD" } }] },
    });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    const { images } = await model.generate("x");

    expect(images[0]).toMatchObject({ type: "base64", mediaType: "image/png" });
  });

  it("throws ContentFilterError when every candidate is safety-filtered", async () => {
    const { client } = makeFakeClient({
      response: { generatedImages: [{ raiFilteredReason: "safety policy" }] },
    });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    await expect(model.generate("x")).rejects.toBeInstanceOf(ContentFilterError);
  });

  it("throws ProviderError when no images are returned", async () => {
    const { client } = makeFakeClient({ response: { generatedImages: [] } });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    await expect(model.generate("x")).rejects.toBeInstanceOf(ProviderError);
  });

  it("wraps provider errors into the typed AIError hierarchy", async () => {
    const { client } = makeFakeClient({ error: { status: 429, message: "resource_exhausted" } });
    const model = new GoogleImageModel(client, { name: "imagen-4.0-generate-001" });

    await expect(model.generate("x")).rejects.toBeInstanceOf(ProviderRateLimitError);
  });
});
