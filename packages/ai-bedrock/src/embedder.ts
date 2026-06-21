import {
  type EmbeddingBatchResult,
  type EmbeddingResult,
  type EmbeddingUsage,
  type EmbedderContract,
} from "@warlock.js/ai";
import { log, type Logger } from "@warlock.js/logger";
import { InvokeModelCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { BedrockEmbedderConfig } from "./config.type";
import { wrapBedrockError } from "./utils";

const LOG_MODULE = "ai.bedrock";

/** Shape of the Amazon Titan Text Embeddings response body. */
type TitanEmbeddingResponse = {
  embedding: number[];
  inputTextTokenCount: number;
};

/**
 * Bedrock-backed implementation of `EmbedderContract`, targeting the
 * Amazon Titan Text Embeddings family
 * (`amazon.titan-embed-text-v2:0` / v1) via `InvokeModel`.
 *
 * **Role.** Converts text into floating-point vectors. Standalone
 * primitive — unrelated to Converse / tools / the agent loop.
 *
 * **Single-input only upstream.** Titan's `InvokeModel` body accepts
 * one `inputText` per call — there is no batch endpoint. `embedMany`
 * therefore issues one request per input sequentially and aggregates
 * token usage. This is a deliberate, documented trade-off: a real
 * batch API does not exist for Titan on Bedrock, so the alternative
 * (failing `embedMany`) would be worse. Cohere embeddings on Bedrock
 * *do* batch but use an incompatible body shape — out of scope; use
 * the OpenAI adapter or a future Cohere adapter when batch throughput
 * matters.
 *
 * **Dimensions.** When no `dimensions` override is given,
 * `this.dimensions` starts at `0` and is populated from the first
 * response's vector length, then cached. Passing `dimensions` forwards
 * Titan v2's truncation hint (256 / 512 / 1024) and sets the initial
 * value immediately.
 *
 * @example
 * const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });
 * const { vector } = await embedder.embed("Hello world");
 * const { vectors } = await embedder.embedMany(["doc 1", "doc 2"]);
 */
export class BedrockEmbedder implements EmbedderContract {
  public readonly name: string;
  public readonly provider: string;
  public dimensions: number;

  private readonly client: BedrockRuntimeClient;
  private readonly configuredDimensions: number | undefined;
  private readonly logger: Logger = log;

  public constructor(
    client: BedrockRuntimeClient,
    config: BedrockEmbedderConfig,
    provider: string = "bedrock",
  ) {
    this.client = client;
    this.name = config.name;
    this.provider = provider;
    this.configuredDimensions = config.dimensions;
    this.dimensions = config.dimensions ?? 0;
  }

  public async embed(input: string): Promise<EmbeddingResult> {
    const { vector, tokens } = await this.invoke(input);

    return {
      vector,
      dimensions: this.dimensions,
      usage: { promptTokens: tokens, totalTokens: tokens },
    };
  }

  public async embedMany(inputs: string[]): Promise<EmbeddingBatchResult> {
    const vectors: number[][] = [];
    let tokens = 0;

    for (const input of inputs) {
      const result = await this.invoke(input);

      vectors.push(result.vector);
      tokens += result.tokens;
    }

    const usage: EmbeddingUsage = { promptTokens: tokens, totalTokens: tokens };

    return { vectors, dimensions: this.dimensions, usage };
  }

  /**
   * Issue a single Titan `InvokeModel` embedding request: encode the
   * JSON body, send, wrap provider errors, decode the response, and
   * cache `dimensions` on the first successful call.
   */
  private async invoke(input: string): Promise<{ vector: number[]; tokens: number }> {
    this.logger.debug(LOG_MODULE, "embedder.request", "InvokeModel embeddings", {
      model: this.name,
    });

    const body = JSON.stringify({
      inputText: input,
      ...(this.configuredDimensions !== undefined
        ? { dimensions: this.configuredDimensions }
        : {}),
    });

    let raw;

    try {
      raw = await this.client.send(
        new InvokeModelCommand({
          modelId: this.name,
          contentType: "application/json",
          accept: "application/json",
          body: new TextEncoder().encode(body),
        }),
      );
    } catch (thrown) {
      const wrapped = wrapBedrockError(thrown);

      this.logger.error(LOG_MODULE, "embedder.error", wrapped.message, {
        code: wrapped.code,
        context: wrapped.context,
      });

      throw wrapped;
    }

    const decoded = JSON.parse(new TextDecoder().decode(raw.body)) as TitanEmbeddingResponse;

    if (this.dimensions === 0) {
      this.dimensions = decoded.embedding.length;
    }

    this.logger.debug(LOG_MODULE, "embedder.response", "InvokeModel embeddings returned", {
      dimensions: decoded.embedding.length,
      tokens: decoded.inputTextTokenCount,
    });

    return { vector: decoded.embedding, tokens: decoded.inputTextTokenCount };
  }
}
