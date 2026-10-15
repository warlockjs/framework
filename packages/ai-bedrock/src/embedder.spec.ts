import { InvokeModelCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ProviderRateLimitError } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { BedrockEmbedder } from "./embedder";

function makeFakeClient(vectorsByCall: number[][], tokensPerCall = 3) {
  const bodies: Array<Record<string, unknown>> = [];
  const inputs: Array<Record<string, unknown>> = [];
  let call = 0;

  const send = async (command: InvokeModelCommand) => {
    const input = command.input as { body?: Uint8Array };

    inputs.push(command.input as unknown as Record<string, unknown>);
    bodies.push(JSON.parse(new TextDecoder().decode(input.body)) as Record<string, unknown>);

    const embedding = vectorsByCall[Math.min(call, vectorsByCall.length - 1)];
    call += 1;

    return {
      body: new TextEncoder().encode(
        JSON.stringify({ embedding, inputTextTokenCount: tokensPerCall }),
      ),
    };
  };

  const client = { send } as unknown as BedrockRuntimeClient;

  return { client, bodies, inputs };
}

/** Client whose `send` always rejects with the supplied raw error. */
function makeThrowingClient(thrown: unknown) {
  const send = async () => {
    throw thrown;
  };

  return { send } as unknown as BedrockRuntimeClient;
}

describe("BedrockEmbedder.embed()", () => {
  it("returns vector + lazily-resolved dimensions + usage", async () => {
    const { client } = makeFakeClient([[0.1, 0.2, 0.3]]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    expect(embedder.dimensions).toBe(0);

    const result = await embedder.embed("hello");

    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.dimensions).toBe(3);
    expect(result.usage).toEqual({ promptTokens: 3, totalTokens: 3 });
    expect(embedder.dimensions).toBe(3);
  });

  it("forwards the configured dimensions truncation hint in the request body", async () => {
    const { client, bodies } = makeFakeClient([[0, 0]]);
    const embedder = new BedrockEmbedder(client, {
      name: "amazon.titan-embed-text-v2:0",
      dimensions: 256,
    });

    await embedder.embed("hi");

    expect(bodies[0]).toEqual({ inputText: "hi", dimensions: 256 });
  });

  it("omits the dimensions key from the body when none is configured", async () => {
    const { client, bodies } = makeFakeClient([[0.1, 0.2]]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    await embedder.embed("hi");

    expect(bodies[0]).toEqual({ inputText: "hi" });
    expect(bodies[0]).not.toHaveProperty("dimensions");
  });

  it("sends a JSON InvokeModel command targeting the configured model", async () => {
    const { client, inputs } = makeFakeClient([[0.1]]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    await embedder.embed("hi");

    expect(inputs[0].modelId).toBe("amazon.titan-embed-text-v2:0");
    expect(inputs[0].contentType).toBe("application/json");
    expect(inputs[0].accept).toBe("application/json");
    expect(inputs[0].body).toBeInstanceOf(Uint8Array);
  });

  it("reports the configured dimensions on the result, even before any call resolves length", async () => {
    // dimensions is seeded from config and the response (length 5) does NOT
    // overwrite it because the lazy-resolution guard only fires when it's 0.
    const { client } = makeFakeClient([[1, 2, 3, 4, 5]]);
    const embedder = new BedrockEmbedder(client, {
      name: "amazon.titan-embed-text-v2:0",
      dimensions: 256,
    });

    const result = await embedder.embed("hi");

    expect(result.dimensions).toBe(256);
    expect(embedder.dimensions).toBe(256);
  });

  it("resolves dimensions lazily only on the first call, then keeps it stable", async () => {
    const { client } = makeFakeClient([
      [1, 2, 3],
      [9, 9, 9, 9],
    ]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    expect((await embedder.embed("first")).dimensions).toBe(3);
    // Second response is length 4 but dimensions stays the cached 3.
    expect((await embedder.embed("second")).dimensions).toBe(3);
    expect(embedder.dimensions).toBe(3);
  });

  it("honors a custom provider label", () => {
    const { client } = makeFakeClient([[0]]);
    const embedder = new BedrockEmbedder(
      client,
      { name: "amazon.titan-embed-text-v2:0" },
      "bedrock-eu",
    );

    expect(embedder.provider).toBe("bedrock-eu");
  });

  it("defaults the provider label to 'bedrock'", () => {
    const { client } = makeFakeClient([[0]]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    expect(embedder.provider).toBe("bedrock");
  });

  it("wraps a thrown provider error into the typed AIError hierarchy", async () => {
    const embedder = new BedrockEmbedder(
      makeThrowingClient({ name: "ThrottlingException", $metadata: { httpStatusCode: 429 } }),
      { name: "amazon.titan-embed-text-v2:0" },
    );

    await expect(embedder.embed("hi")).rejects.toBeInstanceOf(ProviderRateLimitError);
    await expect(embedder.embed("hi")).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });
  });
});

describe("BedrockEmbedder.embedMany()", () => {
  it("issues one request per input and aggregates token usage", async () => {
    const { client, bodies } = makeFakeClient([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    const result = await embedder.embedMany(["a", "b", "c"]);

    expect(result.vectors).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(result.dimensions).toBe(2);
    expect(result.usage).toEqual({ promptTokens: 9, totalTokens: 9 });
    expect(bodies.map((b) => b.inputText)).toEqual(["a", "b", "c"]);
  });

  it("returns empty vectors and zero usage for an empty input list", async () => {
    const { client, bodies } = makeFakeClient([[1]]);
    const embedder = new BedrockEmbedder(client, { name: "amazon.titan-embed-text-v2:0" });

    const result = await embedder.embedMany([]);

    expect(result.vectors).toEqual([]);
    expect(result.usage).toEqual({ promptTokens: 0, totalTokens: 0 });
    // dimensions never resolves because no call was made.
    expect(result.dimensions).toBe(0);
    expect(bodies).toHaveLength(0);
  });

  it("forwards the configured dimensions on every request in the batch", async () => {
    const { client, bodies } = makeFakeClient([
      [0, 0],
      [0, 0],
    ]);
    const embedder = new BedrockEmbedder(client, {
      name: "amazon.titan-embed-text-v2:0",
      dimensions: 512,
    });

    await embedder.embedMany(["x", "y"]);

    expect(bodies).toEqual([
      { inputText: "x", dimensions: 512 },
      { inputText: "y", dimensions: 512 },
    ]);
  });

  it("propagates a wrapped error if any request in the batch fails", async () => {
    const embedder = new BedrockEmbedder(
      makeThrowingClient({ name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }),
      { name: "amazon.titan-embed-text-v2:0" },
    );

    await expect(embedder.embedMany(["a", "b"])).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });
});
