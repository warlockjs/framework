import {
  type EmbeddingBatchResult,
  type EmbeddingResult,
  type EmbeddingUsage,
  type EmbedderContract,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import type { EmbedResponse, Ollama } from "ollama";
import type { OllamaEmbedderConfig } from "./config.type";
import { wrapOllamaError } from "./utils";

const LOG_MODULE = "ai.ollama";

/**
 * Ollama-backed implementation of `EmbedderContract`
 * (`nomic-embed-text`, `mxbai-embed-large`, …) via `client.embed`.
 *
 * **Role.** Converts text into floating-point vectors. Standalone
 * primitive — unrelated to chat / tools / the agent loop.
 *
 * **Batch is native.** Ollama's `embed` accepts a string array and
 * returns `embeddings` in input order, so `embedMany` is a single
 * request (like the Gemini adapter, unlike Bedrock/Titan).
 *
 * **Usage.** Ollama returns only `prompt_eval_count` (no separate
 * total); it is reported as both `promptTokens` and `totalTokens`.
 *
 * **Dimensions.** When no `dimensions` override is given,
 * `this.dimensions` starts at `0` and is populated from the first
 * response's vector length, then cached. Passing `dimensions`
 * forwards Ollama's truncation field and sets the initial value.
 *
 * @example
 * const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });
 * const { vector } = await embedder.embed("Hello world");
 * const { vectors } = await embedder.embedMany(["doc 1", "doc 2"]);
 */
export class OllamaEmbedder implements EmbedderContract {
  public readonly name: string;
  public readonly provider: string;
  public dimensions: number;

  private readonly client: Ollama;
  private readonly configuredDimensions: number | undefined;
  private readonly logger: Logger = log;

  public constructor(
    client: Ollama,
    config: OllamaEmbedderConfig,
    provider: string = "ollama",
  ) {
    this.client = client;
    this.name = config.name;
    this.provider = provider;
    this.configuredDimensions = config.dimensions;
    this.dimensions = config.dimensions ?? 0;
  }

  public async embed(input: string): Promise<EmbeddingResult> {
    const { embeddings, usage } = await this.request([input]);

    return { vector: embeddings[0] ?? [], dimensions: this.dimensions, usage };
  }

  public async embedMany(inputs: string[]): Promise<EmbeddingBatchResult> {
    const { embeddings, usage } = await this.request(inputs);

    return { vectors: embeddings, dimensions: this.dimensions, usage };
  }

  /**
   * Shared transport: one `embed` call for the whole batch, wrap
   * provider errors, cache `dimensions` from the first vector, and
   * return vectors in input order plus a neutral usage object.
   */
  private async request(
    inputs: string[],
  ): Promise<{ embeddings: number[][]; usage: EmbeddingUsage }> {
    this.logger.debug(LOG_MODULE, "embedder.request", "embed", {
      model: this.name,
      count: inputs.length,
    });

    let response: EmbedResponse;

    try {
      response = await this.client.embed({
        model: this.name,
        input: inputs,
        ...(this.configuredDimensions !== undefined
          ? { dimensions: this.configuredDimensions }
          : {}),
      });
    } catch (thrown) {
      const wrapped = wrapOllamaError(thrown);

      this.logger.error(LOG_MODULE, "embedder.error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const embeddings = response.embeddings ?? [];

    if (this.dimensions === 0 && embeddings[0]) {
      this.dimensions = embeddings[0].length;
    }

    const tokens = response.prompt_eval_count ?? 0;
    const usage: EmbeddingUsage = { promptTokens: tokens, totalTokens: tokens };

    this.logger.debug(LOG_MODULE, "embedder.response", "embed returned", {
      count: embeddings.length,
      dimensions: this.dimensions,
    });

    return { embeddings, usage };
  }
}
