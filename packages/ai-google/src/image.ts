import {
  ContentFilterError,
  InvalidRequestError,
  ProviderError,
  type GeneratedImage,
  type ImageGenerationOptions,
  type ImageGenerationResponse,
  type ImageModelContract,
  type ImageModelPricing,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import type { GenerateImagesConfig, GoogleGenAI } from "@google/genai";
import type { GoogleImageConfig } from "./config.type";
import { isGoogleImageModel } from "./known-image-models";
import { wrapGoogleError } from "./utils";

const LOG_MODULE = "ai.google";

/** Map a neutral output container hint to an IANA media type. */
function mediaTypeFor(format: string | undefined): string | undefined {
  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return undefined;
  }
}

/**
 * Google Imagen-backed implementation of `ImageModelContract`, via
 * `ai.models.generateImages`. Imagen is per-image-metered and returns
 * base64 image bytes (no hosted URL, no token usage).
 *
 * **Capability guard.** The constructor rejects a non-Imagen model id
 * up front — `google.image({ name: "gemini-2.5-flash" })` throws a
 * typed `InvalidRequestError` instead of a downstream 400 (Gemini's
 * native image output is a different API and not routed here).
 *
 * **Safety filtering.** When Imagen filters every candidate for safety
 * (`raiFilteredReason`), this surfaces a typed `ContentFilterError`
 * carrying the reason, rather than returning an empty success.
 *
 * @example
 * const model = new GoogleImageModel(ai, { name: "imagen-4.0-generate-001" }, "google");
 * const { images } = await model.generate("a watercolor lighthouse at dawn");
 */
export class GoogleImageModel implements ImageModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly pricing?: ImageModelPricing;

  private readonly ai: GoogleGenAI;
  private readonly logger: Logger = log;

  public constructor(ai: GoogleGenAI, config: GoogleImageConfig, provider: string = "google") {
    if (!isGoogleImageModel(config.name)) {
      throw new InvalidRequestError(
        `"${config.name}" is not a known Google Imagen model. ` +
          "Use an `imagen-*` model with google.image({ name }).",
      );
    }

    this.ai = ai;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
  }

  public async generate(
    prompt: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse> {
    const config: GenerateImagesConfig = {};

    if (options?.count !== undefined) config.numberOfImages = options.count;
    if (options?.aspectRatio !== undefined) config.aspectRatio = options.aspectRatio;
    if (options?.negativePrompt !== undefined) config.negativePrompt = options.negativePrompt;
    if (options?.signal !== undefined) config.abortSignal = options.signal;

    const outputMimeType = mediaTypeFor(options?.format);
    if (outputMimeType !== undefined) config.outputMimeType = outputMimeType;

    // Imagen sizing is `imageSize` ("1K"/"2K") — a distinct concept from
    // OpenAI's WxH `size`, so we honor only an explicit passthrough.
    if (typeof options?.imageSize === "string") config.imageSize = options.imageSize;
    if (typeof options?.personGeneration === "string") {
      config.personGeneration = options.personGeneration as GenerateImagesConfig["personGeneration"];
    }

    this.logger.debug(LOG_MODULE, "image.request", "models.generateImages", {
      model: this.name,
      count: options?.count ?? 1,
    });

    let response: Awaited<ReturnType<GoogleGenAI["models"]["generateImages"]>>;

    try {
      response = await this.ai.models.generateImages({ model: this.name, prompt, config });
    } catch (thrown) {
      const wrapped = wrapGoogleError(thrown);

      this.logger.error(LOG_MODULE, "image.error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const generated = response.generatedImages ?? [];
    const images: GeneratedImage[] = [];

    for (const candidate of generated) {
      const bytes = candidate.image?.imageBytes;
      if (!bytes) continue;

      images.push({
        type: "base64",
        base64: bytes,
        mediaType: candidate.image?.mimeType ?? outputMimeType ?? "image/png",
        ...(candidate.enhancedPrompt ? { revisedPrompt: candidate.enhancedPrompt } : {}),
      });
    }

    if (images.length === 0) {
      const filtered = generated.find((candidate) => candidate.raiFilteredReason);

      if (filtered?.raiFilteredReason) {
        throw new ContentFilterError(
          `Imagen filtered all candidates: ${filtered.raiFilteredReason}`,
          { reason: filtered.raiFilteredReason },
        );
      }

      throw new ProviderError("Imagen returned no images.");
    }

    this.logger.debug(LOG_MODULE, "image.response", "models.generateImages succeeded", {
      images: images.length,
    });

    // Imagen returns no token usage — honest zero (priced per image).
    return { images, usage: { input: 0, output: 0, total: 0 } };
  }
}
