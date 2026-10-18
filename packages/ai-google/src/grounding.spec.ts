import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { GoogleModel } from "./model";
import { GOOGLE_SERVER_TOOL_PRICING } from "./known-pricing";

const metadata = {
  webSearchQueries: ["news", "news", "", "weather"],
  groundingChunks: [{ web: { uri: "https://example.com", title: "News" } }],
  groundingSupports: [{ groundingChunkIndices: [0] }],
};
function model() {
  const response = {
    text: "answer",
    candidates: [{ index: 0, groundingMetadata: metadata }],
    usageMetadata: { promptTokenCount: 2 },
  };
  const client = {
    models: {
      generateContent: async () => response,
      generateContentStream: async function* () {
        yield response;
        yield response;
        yield { text: "" };
      },
    },
  } as unknown as GoogleGenAI;
  return new GoogleModel(client, {
    name: "gemini-3.5-flash-lite",
    pricing: { input: 0, output: 0, serverTools: GOOGLE_SERVER_TOOL_PRICING },
  });
}

describe("Google grounding usage", () => {
  it("preserves all raw metadata and separates billable queries from array length", async () => {
    const response = await model().complete([{ role: "user", content: "search" }]);
    expect(response.usage.serverToolUse).toEqual({
      webSearchRequests: 2,
      googleWebSearchQueries: 4,
    });
    expect(response.usage.cost?.serverTools?.webSearch).toBe(0.028);
    expect(response.providerMetadata).toEqual({
      google: { groundingMetadata: [{ index: 0, ...metadata }] },
    });
    expect(response.toolCalls).toBeUndefined();
  });

  it("does not count repeated stream snapshots twice or lose grounding on the final usage chunk", async () => {
    const chunks = [];
    for await (const chunk of model().stream([{ role: "user", content: "search" }]))
      chunks.push(chunk);
    const done = chunks.find((chunk) => chunk.type === "done");
    expect(done?.usage.serverToolUse?.webSearchRequests).toBe(2);
    expect(done?.providerMetadata).toEqual({
      google: { groundingMetadata: [{ index: 0, ...metadata }] },
    });
    expect(chunks.some((chunk) => chunk.type === "tool-call")).toBe(false);
  });
});
