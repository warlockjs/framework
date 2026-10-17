import { ai as warlockAi, type ModelStreamChunk } from "@warlock.js/ai";
import { log } from "@warlock.js/logger";
import { GenerateContentResponse, type GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleModel } from "./model";

/** Wrap a raw chunk in the SDK class so its real `text` getter runs. */
function sdkChunk(raw: Partial<GenerateContentResponse>): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), raw);
}

/**
 * Recorded-style `streamGenerateContent` chunks with `includeThoughts` on:
 * thought-summary parts (`thought: true`) arrive before the answer, and
 * every chunk carries the usage so far.
 */
const THOUGHT_STREAM = [
  sdkChunk({
    candidates: [
      { content: { role: "model", parts: [{ text: "Comparing the options.", thought: true }] } },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0, thoughtsTokenCount: 40 },
  }),
  sdkChunk({
    candidates: [{ content: { role: "model", parts: [{ text: "Use the second." }] } }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 40 },
  }),
  sdkChunk({
    candidates: [
      { content: { role: "model", parts: [{ text: " Done." }] }, finishReason: "STOP" as never },
    ],
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 6,
      thoughtsTokenCount: 40,
      totalTokenCount: 58,
    },
  }),
];

function makeModel(chunks: GenerateContentResponse[]) {
  const calls: Array<Record<string, unknown>> = [];
  const generateContentStream = async (params: Record<string, unknown>) => {
    calls.push(params);

    return (async function* () {
      yield* chunks;
    })();
  };
  const genai = { models: { generateContentStream } } as unknown as GoogleGenAI;

  return { model: new GoogleModel(genai, { name: "gemini-2.5-flash" }), calls };
}

async function collect(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GoogleModel.stream() optional chunks", () => {
  it("keeps thought text out of the answer and emits nothing extra without opt-in", async () => {
    const { model } = makeModel(THOUGHT_STREAM);

    const chunks = await collect(model.stream([{ role: "user", content: "which?" }]));

    expect(chunks.map((chunk) => chunk.type)).toEqual(["delta", "delta", "done"]);
  });

  it("maps thought parts to reasoning and usageMetadata to usage snapshots", async () => {
    const { model } = makeModel(THOUGHT_STREAM);

    const chunks = await collect(
      model.stream([{ role: "user", content: "which?" }], { streamChunks: true }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "reasoning",
      "usage",
      "delta",
      "usage",
      "delta",
      "usage",
      "done",
    ]);
    expect(chunks[0]).toEqual({ type: "reasoning", delta: "Comparing the options." });
    expect(chunks[2]).toEqual({ type: "delta", content: "Use the second." });
    expect(chunks[1]).toMatchObject({ type: "usage", usage: { input: 12 } });
  });
});

describe("GoogleModel provider-defined tools", () => {
  it("sends google definitions verbatim after the function declarations", async () => {
    const { model, calls } = makeModel(THOUGHT_STREAM);
    const lookup = warlockAi.tool({
      name: "lookup",
      description: "Lookup",
      execute: async () => ({}),
    });
    const search = warlockAi.providerTool({ provider: "google", definition: { googleSearch: {} } });

    await collect(model.stream([{ role: "user", content: "x" }], { tools: [lookup, search] }));

    const config = calls[0]?.config as { tools?: unknown[] };

    expect(config.tools).toEqual([
      { functionDeclarations: [expect.objectContaining({ name: "lookup" })] },
      { googleSearch: {} },
    ]);
    expect(search.name).toBe("googleSearch");
  });

  it("skips an anthropic definition with a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const { model, calls } = makeModel(THOUGHT_STREAM);

    await collect(
      model.stream([{ role: "user", content: "x" }], {
        providerTools: [
          {
            provider: "anthropic",
            definition: { type: "web_search_20250305", name: "web_search" },
          },
        ],
      }),
    );

    const config = calls[0]?.config as { tools?: unknown } | undefined;

    expect(config?.tools).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "ai.google",
      "providerTool.skipped",
      expect.any(String),
      expect.objectContaining({ tool: "web_search" }),
    );
  });
});
