import {
  ContentFilterError,
  ProviderError,
  type AIError,
  type GeneratedImage,
  type ImageGenerationOptions,
  type ImageGenerationResponse,
  type ImageModelContract,
  type ImageModelPricing,
  type Usage,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import type {
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  ImageConfig,
  Part,
} from "@google/genai";
import type { GoogleImageConfig } from "./config.type";
import { applyGoogleUsage, wrapGoogleError } from "./utils";

const LOG_MODULE = "ai.google";

/**
 * Response modalities requested when the caller names none.
 *
 * `IMAGE` is the modality this adapter extracts; `TEXT` rides along so
 * a model that narrates what it drew is not answering outside the set
 * it was granted (the narration is then dropped — only inline image
 * parts become `GeneratedImage`s).
 *
 * *Unverified:* which pairing any individual Gemini image model
 * requires is not established here — no spec or run in this package
 * touches the live API. `options.responseModalities` replaces this list
 * verbatim for a model that wants something else.
 */
const DEFAULT_RESPONSE_MODALITIES = ["TEXT", "IMAGE"];

/**
 * Gemini `finishReason` values that mean generation was stopped by a
 * safety / policy rule rather than by the model simply not drawing.
 * Taken from the `FinishReason` enum in `@google/genai`'s own type
 * declarations, whose doc comments describe each of these as content
 * or image generation being "stopped" for safety, prohibited content,
 * recitation, blocklist, or SPII.
 */
const FILTERED_FINISH_REASONS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "RECITATION",
  "IMAGE_RECITATION",
  "BLOCKLIST",
  "SPII",
]);

/** How much of a text-only answer to quote back inside the error message. */
const TEXT_EXCERPT_LIMIT = 200;

/**
 * Gemini-native implementation of `ImageModelContract`, via
 * `ai.models.generateContent` with `config.responseModalities`
 * including `"IMAGE"`.
 *
 * **Why a second image adapter.** `GoogleImageModel` calls
 * `ai.models.generateImages`, which the `@google/genai` bundle routes
 * to `{model}:predict` (`generateImages` → `generateImagesInternal` →
 * `formatMap('{model}:predict', …)`). A Gemini image model is not
 * served there: asking for one returns Google's
 * `404 … is not found for API version v1beta, or is not supported for
 * predict`. `generateContent` is the SDK's own named replacement — its
 * runtime deprecation notice for `generateImages` reads "Please use the
 * generateContent method with image models instead" — so that is the
 * transport this class speaks, hence a separate class rather than a
 * branch inside `image.ts`.
 *
 * **Same envelope.** Inline image parts are mapped to the identical
 * `GeneratedImage[]` shape `GoogleImageModel` produces, so `ai.image()`
 * callers see no difference between the two paths.
 *
 * **Token usage is passed through, not zeroed.** The Imagen path
 * returns a hard `{ 0, 0, 0 }` because Imagen reports no tokens at all;
 * here, whatever `usageMetadata` Google attaches is mapped by the same
 * {@link applyGoogleUsage} the chat model uses, and only an absent
 * block collapses to zeros. Price accordingly.
 *
 * **No model-id validation.** `config.name` is forwarded to
 * `generateContent` exactly as given; nothing here inspects it. An id
 * Google does not serve fails at Google, wrapped into the typed
 * `AIError` hierarchy — never with a local throw.
 *
 * **Evidence, in two tiers.** No spec in this package calls Google.
 * *Measured here:* a `gemini-*` image id, which 404s on the `predict`
 * transport, reached the model on this one and came back with a quota
 * error (HTTP 429) — the endpoint accepts the id. *Reported by the
 * maintainer:* once billing was enabled on the project, an image came
 * back end-to-end from an application running a locally linked build.
 * *Still unestablished:* whether these models report token usage — no
 * `usageMetadata` from a successful image call has been observed, so
 * the pass-through above is untested against a real response.
 *
 * @example
 * const model = new GeminiImageModel(ai, { name: "gemini-3.1-flash-lite-image" });
 * const { images, usage } = await model.generate("a red bicycle on a white background");
 */
export class GeminiImageModel implements ImageModelContract {
  public readonly name: string;
  public readonly provider: string;
  public readonly pricing?: ImageModelPricing;

  private readonly ai: GoogleGenAI;
  private readonly logger: Logger = log;

  public constructor(ai: GoogleGenAI, config: GoogleImageConfig, provider: string = "google") {
    this.ai = ai;
    this.name = config.name;
    this.provider = provider;
    this.pricing = config.pricing;
  }

  public async generate(
    prompt: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse> {
    const config = this.buildConfig(options);

    this.logger.debug(LOG_MODULE, "image.request", "models.generateContent", {
      model: this.name,
      responseModalities: config.responseModalities,
    });

    let response: GenerateContentResponse;

    try {
      // `contents` takes a bare string: the SDK's own `generateContent`
      // example passes one (`contents: 'Why is the sky blue?'`).
      response = await this.ai.models.generateContent({
        model: this.name,
        contents: prompt,
        config,
      });
    } catch (thrown) {
      const wrapped = wrapGoogleError(thrown);

      this.logger.error(LOG_MODULE, "image.error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const parts = collectParts(response);
    const images = toGeneratedImages(parts);

    if (images.length === 0) {
      throw this.noImageError(response, parts);
    }

    const usage: Usage = { input: 0, output: 0, total: 0 };

    if (response.usageMetadata) {
      applyGoogleUsage(usage, response.usageMetadata);
    }

    this.logger.debug(LOG_MODULE, "image.response", "models.generateContent succeeded", {
      images: images.length,
      usage,
    });

    return { images, usage };
  }

  /**
   * Assemble the `GenerateContentConfig` for an image turn: the
   * requested modalities, the image-specific knobs Gemini exposes under
   * `imageConfig`, and the cancellation handle.
   *
   * Three neutral options are deliberately NOT forwarded, because
   * `GenerateContentConfig` / `ImageConfig` in `@google/genai` expose
   * no equivalent for them on this path: `count` (no per-request image
   * count — every inline image part the model does return is mapped),
   * `negativePrompt` (an Imagen-only field), and `format`
   * (`ImageConfig.outputMimeType` is documented "not supported in
   * Gemini API"). Fold those intentions into the prompt instead.
   */
  private buildConfig(options: ImageGenerationOptions | undefined): GenerateContentConfig {
    const imageConfig: ImageConfig = {};

    if (options?.aspectRatio !== undefined) {
      imageConfig.aspectRatio = options.aspectRatio;
    }

    // Provider passthroughs off the neutral options' index signature —
    // forwarded verbatim, never re-spelled, so the value the caller
    // wrote is the value Google rules on. `ImageConfig` documents
    // `imageSize` as `1K`/`2K`/`4K` and `personGeneration` as
    // `ALLOW_ALL`/`ALLOW_ADULT`/`ALLOW_NONE`.
    if (typeof options?.imageSize === "string") {
      imageConfig.imageSize = options.imageSize;
    }

    if (typeof options?.personGeneration === "string") {
      imageConfig.personGeneration = options.personGeneration;
    }

    const requested = options?.responseModalities;
    const responseModalities = Array.isArray(requested)
      ? (requested as string[])
      : DEFAULT_RESPONSE_MODALITIES;

    return {
      responseModalities,
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      ...(options?.signal ? { abortSignal: options.signal } : {}),
    };
  }

  /**
   * Build the typed error for a response that carried no inline image
   * part. Never a silent empty success: the caller asked for an image
   * and got something else, so the error names what actually came back.
   *
   * - A blocked prompt (`promptFeedback.blockReason`) or a
   *   safety/policy `finishReason` → `ContentFilterError` carrying the
   *   reason, matching how the Imagen path reports `raiFilteredReason`.
   * - A text-only answer → `ProviderError` quoting the text, so the
   *   log says what the model replied instead of guessing.
   * - Anything else → `ProviderError` naming the finish reason and how
   *   many parts arrived.
   */
  private noImageError(response: GenerateContentResponse, parts: Part[]): AIError {
    const blockReason = response.promptFeedback?.blockReason;

    if (blockReason) {
      return new ContentFilterError(
        `Gemini blocked the prompt for ${this.name}: ${blockReason}`,
        { reason: blockReason },
      );
    }

    const finishReason = response.candidates?.[0]?.finishReason;

    if (finishReason && FILTERED_FINISH_REASONS.has(finishReason)) {
      return new ContentFilterError(
        `Gemini filtered the image for ${this.name}: ${finishReason}`,
        { reason: finishReason },
      );
    }

    const text = collectText(parts);

    if (text) {
      return new ProviderError(
        `Gemini returned no image for ${this.name} — the response was text only: "${excerpt(text)}"`,
        { context: { model: this.name, ...(finishReason ? { finishReason } : {}) } },
      );
    }

    return new ProviderError(
      `Gemini returned no image part for ${this.name} (parts: ${parts.length}${
        finishReason ? `, finishReason: ${finishReason}` : ""
      }).`,
      { context: { model: this.name, parts: parts.length } },
    );
  }
}

/**
 * Flatten every candidate's content parts into one list. Read off
 * `candidates[].content.parts` rather than the response's convenience
 * getters: `response.text` covers only the first candidate's text and
 * there is no getter for inline image data at all.
 */
function collectParts(response: GenerateContentResponse): Part[] {
  const parts: Part[] = [];

  for (const candidate of response.candidates ?? []) {
    parts.push(...(candidate.content?.parts ?? []));
  }

  return parts;
}

/**
 * Map the inline image parts to the neutral `GeneratedImage[]` — the
 * same `{ type: "base64", base64, mediaType }` shape the Imagen path
 * emits, including its `image/png` fallback for a part that arrives
 * without a declared mime type.
 */
function toGeneratedImages(parts: Part[]): GeneratedImage[] {
  const images: GeneratedImage[] = [];

  for (const part of parts) {
    const data = part.inlineData?.data;

    if (!data) {
      continue;
    }

    images.push({
      type: "base64",
      base64: data,
      mediaType: part.inlineData?.mimeType ?? "image/png",
    });
  }

  return images;
}

/** Join the text parts of a response — what the model said instead of drawing. */
function collectText(parts: Part[]): string {
  return parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join(" ")
    .trim();
}

/** Trim a quoted model answer so an error message stays readable. */
function excerpt(text: string): string {
  return text.length > TEXT_EXCERPT_LIMIT ? `${text.slice(0, TEXT_EXCERPT_LIMIT)}…` : text;
}
