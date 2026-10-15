import type { EmbedContentResponse, GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { GoogleEmbedder } from "./embedder";

function makeFakeAI(vectors: number[][], throws?: unknown) {
  const calls: Array<Record<string, unknown>> = [];

  const embedContent = async (params: Record<string, unknown>) => {
    calls.push(params);

    if (throws) {
      throw throws;
    }

    return {
      embeddings: vectors.map((values) => ({ values })),
    } as EmbedContentResponse;
  };

  const ai = { models: { embedContent } } as unknown as GoogleGenAI;

  return { ai, calls };
}

describe("GoogleEmbedder.embed()", () => {
  it("returns vector + lazily-resolved dimensions + zeroed usage", async () => {
    const { ai } = makeFakeAI([[0.1, 0.2, 0.3]]);
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    expect(embedder.dimensions).toBe(0);

    const result = await embedder.embed("hello");

    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimensions).toBe(3);
    expect(result.usage).toEqual({ promptTokens: 0, totalTokens: 0 });
    expect(embedder.dimensions).toBe(3);
  });

  it("forwards configured dimensions as outputDimensionality", async () => {
    const { ai, calls } = makeFakeAI([[0, 0]]);
    const embedder = new GoogleEmbedder(ai, {
      name: "gemini-embedding-001",
      dimensions: 768,
    });

    await embedder.embed("hi");

    expect(calls[0]).toMatchObject({
      model: "gemini-embedding-001",
      contents: ["hi"],
      config: { outputDimensionality: 768 },
    });
  });

  it("does not forward outputDimensionality when dimensions are unset", async () => {
    const { ai, calls } = makeFakeAI([[0.1]]);
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    await embedder.embed("hi");

    expect("config" in calls[0]).toBe(false);
  });

  it("keeps the configured dimensions even when the returned vector differs in length", async () => {
    // Vector length is 4, but dimensions were explicitly configured to 768.
    const { ai } = makeFakeAI([[0, 0, 0, 0]]);
    const embedder = new GoogleEmbedder(ai, {
      name: "gemini-embedding-001",
      dimensions: 768,
    });

    const result = await embedder.embed("hi");

    expect(result.dimensions).toBe(768);
    expect(embedder.dimensions).toBe(768);
  });

  it("honors a custom provider label", () => {
    const { ai } = makeFakeAI([[1]]);
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" }, "vertex");

    expect(embedder.provider).toBe("vertex");
  });

  it("returns an undefined vector and leaves dimensions at 0 when the response has no embeddings", async () => {
    const ai = {
      models: { embedContent: async () => ({}) as EmbedContentResponse },
    } as unknown as GoogleGenAI;
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    const result = await embedder.embed("hi");

    // known quirk: embed() reads vectors[0] with no guard, so a zero-embedding
    // response yields `vector: undefined` (not []). embedMany() returns [] instead.
    // Reported as a behavior-change candidate — pinned here to current behavior.
    expect(result.vector).toBeUndefined();
    expect(result.dimensions).toBe(0);
    expect(embedder.dimensions).toBe(0);
  });

  it("returns an empty vectors array from embedMany when the response has no embeddings", async () => {
    const ai = {
      models: { embedContent: async () => ({}) as EmbedContentResponse },
    } as unknown as GoogleGenAI;
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    const result = await embedder.embedMany(["a"]);

    expect(result.vectors).toEqual([]);
    expect(result.dimensions).toBe(0);
  });

  it("treats an embedding with missing values as an empty vector", async () => {
    const ai = {
      models: {
        embedContent: async () =>
          ({ embeddings: [{}] }) as unknown as EmbedContentResponse,
      },
    } as unknown as GoogleGenAI;
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    expect((await embedder.embed("hi")).vector).toEqual([]);
  });

  it("wraps provider errors into the typed AIError hierarchy", async () => {
    const { ai } = makeFakeAI([], { name: "ApiError", status: 429, message: "slow" });
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    await expect(embedder.embed("hi")).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });
  });
});

describe("GoogleEmbedder.embedMany()", () => {
  it("issues a single batched call and returns vectors in order", async () => {
    const { ai, calls } = makeFakeAI([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    const result = await embedder.embedMany(["a", "b", "c"]);

    expect(result.vectors).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(result.dimensions).toBe(2);
    expect(result.usage).toEqual({ promptTokens: 0, totalTokens: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].contents).toEqual(["a", "b", "c"]);
  });

  it("resolves dimensions from the first vector across a batch", async () => {
    const { ai } = makeFakeAI([
      [0.1, 0.2, 0.3, 0.4],
      [0.5, 0.6, 0.7, 0.8],
    ]);
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    const result = await embedder.embedMany(["a", "b"]);

    expect(result.dimensions).toBe(4);
    expect(embedder.dimensions).toBe(4);
  });

  it("wraps provider errors from a batch call", async () => {
    const { ai } = makeFakeAI([], { name: "ApiError", status: 503, message: "down" });
    const embedder = new GoogleEmbedder(ai, { name: "gemini-embedding-001" });

    await expect(embedder.embedMany(["a", "b"])).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
