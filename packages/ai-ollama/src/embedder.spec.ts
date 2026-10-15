import { ProviderError } from "@warlock.js/ai";
import type { EmbedRequest, EmbedResponse, Ollama } from "ollama";
import { describe, expect, it } from "vitest";
import { OllamaEmbedder } from "./embedder";

function makeFakeClient(
  vectors: number[][] | undefined,
  options: { tokens?: number; throws?: unknown } = {},
) {
  const calls: EmbedRequest[] = [];

  const embed = async (request: EmbedRequest) => {
    calls.push(request);

    if (options.throws) {
      throw options.throws;
    }

    return {
      embeddings: vectors,
      prompt_eval_count: options.tokens,
    } as unknown as EmbedResponse;
  };

  const client = { embed } as unknown as Ollama;

  return { client, calls };
}

describe("OllamaEmbedder.embed()", () => {
  it("returns vector + lazily-resolved dimensions + usage", async () => {
    const { client } = makeFakeClient([[0.1, 0.2, 0.3]], { tokens: 7 });
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    expect(embedder.dimensions).toBe(0);

    const result = await embedder.embed("hello");

    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimensions).toBe(3);
    expect(result.usage).toEqual({ promptTokens: 7, totalTokens: 7 });
    expect(embedder.dimensions).toBe(3);
  });

  it("reports both token fields from Ollama's single prompt_eval_count", async () => {
    const { client } = makeFakeClient([[1]], { tokens: 42 });
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    expect((await embedder.embed("hi")).usage).toEqual({ promptTokens: 42, totalTokens: 42 });
  });

  it("defaults token usage to zero when prompt_eval_count is absent", async () => {
    const { client } = makeFakeClient([[1, 2]]);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    expect((await embedder.embed("hi")).usage).toEqual({ promptTokens: 0, totalTokens: 0 });
  });

  it("returns an empty vector and keeps dimensions 0 when no embeddings come back", async () => {
    const { client } = makeFakeClient([]);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    const result = await embedder.embed("hi");

    expect(result.vector).toEqual([]);
    expect(result.dimensions).toBe(0);
    expect(embedder.dimensions).toBe(0);
  });

  it("tolerates a response with no embeddings field at all", async () => {
    const { client } = makeFakeClient(undefined);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    const result = await embedder.embed("hi");

    expect(result.vector).toEqual([]);
    expect(result.dimensions).toBe(0);
  });

  it("resolves dimensions once and does not re-resolve on later calls", async () => {
    const { client } = makeFakeClient([[0.1, 0.2, 0.3]]);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    await embedder.embed("first");
    expect(embedder.dimensions).toBe(3);

    // A later, differently-sized response must NOT overwrite the cached value.
    const longer = makeFakeClient([[1, 2, 3, 4, 5]]);
    const sameEmbedder = embedder;
    (sameEmbedder as unknown as { client: Ollama }).client = longer.client;

    await sameEmbedder.embed("second");
    expect(sameEmbedder.dimensions).toBe(3);
  });

  it("keeps a configured dimensions value even when the vector length differs", async () => {
    const { client } = makeFakeClient([[0.1, 0.2, 0.3]]);
    const embedder = new OllamaEmbedder(client, {
      name: "nomic-embed-text",
      dimensions: 512,
    });

    const result = await embedder.embed("hi");

    // The lazy-resolve guard only fires when dimensions started at 0.
    expect(result.dimensions).toBe(512);
    expect(embedder.dimensions).toBe(512);
  });

  it("wraps a provider failure into a typed AIError", async () => {
    const { client } = makeFakeClient(undefined, {
      throws: { name: "ResponseError", status_code: 404, message: "model not found" },
    });
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    await expect(embedder.embed("hi")).rejects.toMatchObject({
      code: "PROVIDER_INVALID_REQUEST",
    });
  });

  it("wraps a daemon-down connection failure into ProviderError", async () => {
    const { client } = makeFakeClient(undefined, {
      throws: { name: "TypeError", message: "fetch failed", cause: { code: "ECONNREFUSED" } },
    });
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    await expect(embedder.embed("hi")).rejects.toBeInstanceOf(ProviderError);
  });

  it("does not forward the dimensions field when unset", async () => {
    const { client, calls } = makeFakeClient([[0, 0]]);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    await embedder.embed("hi");

    expect(calls[0]).toEqual({ model: "nomic-embed-text", input: ["hi"] });
    expect("dimensions" in calls[0]).toBe(false);
  });

  it("forwards configured dimensions truncation field", async () => {
    const { client, calls } = makeFakeClient([[0, 0]]);
    const embedder = new OllamaEmbedder(client, {
      name: "nomic-embed-text",
      dimensions: 512,
    });

    await embedder.embed("hi");

    expect(calls[0]).toEqual({
      model: "nomic-embed-text",
      input: ["hi"],
      dimensions: 512,
    });
  });
});

describe("OllamaEmbedder.embedMany()", () => {
  it("issues a single batched call and returns vectors in order", async () => {
    const { client, calls } = makeFakeClient([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    const result = await embedder.embedMany(["a", "b", "c"]);

    expect(result.vectors).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(result.dimensions).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual(["a", "b", "c"]);
  });

  it("reports usage from prompt_eval_count for the whole batch", async () => {
    const { client } = makeFakeClient([[1], [2]], { tokens: 11 });
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    expect((await embedder.embedMany(["a", "b"])).usage).toEqual({
      promptTokens: 11,
      totalTokens: 11,
    });
  });

  it("returns no vectors for an empty input batch", async () => {
    const { client, calls } = makeFakeClient([]);
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    const result = await embedder.embedMany([]);

    expect(result.vectors).toEqual([]);
    expect(result.dimensions).toBe(0);
    expect(calls[0].input).toEqual([]);
  });

  it("wraps a provider failure into a typed AIError", async () => {
    const { client } = makeFakeClient(undefined, {
      throws: { name: "ResponseError", status_code: 401, message: "denied" },
    });
    const embedder = new OllamaEmbedder(client, { name: "nomic-embed-text" });

    await expect(embedder.embedMany(["a"])).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });
});
