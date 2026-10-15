import {
  type EmbeddingBatchResult,
  type EmbeddingResult,
  type EmbeddingUsage,
  type EmbedderContract,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import type { EmbedContentResponse, GoogleGenAI } from "@google/genai";
import type { GoogleEmbedderConfig } from "./config.type";
import { wrapGoogleError } from "./utils";

const LOG_MODULE = "ai.google";

/**
 * Token usage is not returned by Gemini's `embedContent`, so every
 * embedding result reports a zeroed `EmbeddingUsage` (honest absence,
 * not a fabricated estimate).
 */
const NO_USAGE: EmbeddingUsage = { promptTokens: 0, totalTokens: 0 };

/**
 * Google Gemini-backed implementation of `EmbedderContract`
 * (`gemini-embedding-001`, `text-embedding-004`, …) via
 * `models.embedContent`.
 *
 * **Role.** Converts text into floating-point vectors. Standalone
 * primitive — unrelated to generateContent / tools / the agent loop.
 *
 * **Batch is native.** Gemini's `embedContent` accepts an array of
 * inputs and returns embeddings in the same order, so `embedMany` is
 * a single request (unlike the Bedrock/Titan adapter, which has to
 * loop).
 *
 * **No usage.** Gemini's embed endpoint returns no token counts;
 * `usage` is always `{ promptTokens: 0, totalTokens: 0 }`.
 *
 * **Dimensions.** When no `dimensions` override is given,
 * `this.dimensions` starts at `0` and is populated from the first
 * response's vector length, then cached. Passing `dimensions`
 * forwards Gemini's `outputDimensionality` truncation hint and sets
 * the initial value immediately.
 *
 * @example
 * const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });
 * const { vector } = await embedder.embed("Hello world");
 * const { vectors } = await embedder.embedMany(["doc 1", "doc 2"]);
 */
export class GoogleEmbedder implements EmbedderContract {
  public readonly name: string;
  public readonly provider: string;
  public dimensions: number;

  private readonly ai: GoogleGenAI;
  private readonly configuredDimensions: number | undefined;
  private readonly logger: Logger = log;

  public constructor(
    ai: GoogleGenAI,
    config: GoogleEmbedderConfig,
    provider: string = "google",
  ) {
    this.ai = ai;
    this.name = config.name;
    this.provider = provider;
    this.configuredDimensions = config.dimensions;
    this.dimensions = config.dimensions ?? 0;
  }

  public async embed(input: string): Promise<EmbeddingResult> {
    const vectors = await this.request([input]);

    return { vector: vectors[0], dimensions: this.dimensions, usage: NO_USAGE };
  }

  public async embedMany(inputs: string[]): Promise<EmbeddingBatchResult> {
    const vectors = await this.request(inputs);

    return { vectors, dimensions: this.dimensions, usage: NO_USAGE };
  }

  /**
   * Shared transport: one `embedContent` call for the whole batch,
   * wrap provider errors, cache `dimensions` from the first vector,
   * and return the raw vectors in input order.
   */
  private async request(inputs: string[]): Promise<number[][]> {
    this.logger.debug(LOG_MODULE, "embedder.request", "embedContent", {
      model: this.name,
      count: inputs.length,
    });

    let response: EmbedContentResponse;

    try {
      response = await this.ai.models.embedContent({
        model: this.name,
        contents: inputs,
        ...(this.configuredDimensions !== undefined
          ? { config: { outputDimensionality: this.configuredDimensions } }
          : {}),
      });
    } catch (thrown) {
      const wrapped = wrapGoogleError(thrown);

      this.logger.error(LOG_MODULE, "embedder.error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const vectors = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);

    if (this.dimensions === 0 && vectors[0]) {
      this.dimensions = vectors[0].length;
    }

    this.logger.debug(LOG_MODULE, "embedder.response", "embedContent returned", {
      count: vectors.length,
      dimensions: this.dimensions,
    });

    return vectors;
  }
}
