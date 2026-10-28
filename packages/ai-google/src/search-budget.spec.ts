import type { GoogleGenAI } from "@google/genai";
import { ai } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { GoogleModel } from "./model";
import { googleSearchBudget } from "./search-budget";

const messages = [{ role: "user" as const, content: "search" }];
const search = ai.providerTool({ provider: "google", definition: { googleSearch: {} } });
const code = ai.providerTool({ provider: "google", definition: { codeExecution: {} } });

function setup(queriesPerCall: string[]) {
  // Like the real API, report queries only when the search tool was sent.
  const respond = (request: { config?: { tools?: unknown[] } }) => ({
    text: "answer",
    candidates: [
      {
        index: 0,
        ...(JSON.stringify(request.config?.tools ?? []).includes("googleSearch")
          ? { groundingMetadata: { webSearchQueries: queriesPerCall } }
          : {}),
      },
    ],
    usageMetadata: { promptTokenCount: 1 },
  });
  const generateContent = vi.fn(async (request: { config?: { tools?: unknown[] } }) =>
    respond(request),
  );
  const generateContentStream = vi.fn(async (request: { config?: { tools?: unknown[] } }) =>
    (async function* () {
      yield respond(request);
    })(),
  );
  const client = { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI;

  return {
    model: new GoogleModel(client, { name: "gemini-3.5-flash" }),
    generateContent,
    generateContentStream,
  };
}

const sentTools = (call: { config?: { tools?: unknown[] } } | undefined) => call?.config?.tools;

describe("googleSearchBudget", () => {
  it("tracks used and remaining and never goes below zero", () => {
    const budget = googleSearchBudget(2);
    budget.record(1);
    expect([budget.max, budget.used, budget.remaining]).toEqual([2, 1, 1]);
    budget.record(5);
    expect([budget.used, budget.remaining]).toEqual([6, 0]);
  });

  it.each([-1, 1.5, Number.NaN])("rejects %s", (value) => {
    expect(() => googleSearchBudget(value)).toThrow("non-negative integer");
  });
});

describe("Google search budget on model calls", () => {
  it("records the unique queries Google reports and stops offering search once spent", async () => {
    const { model, generateContent } = setup(["a", "b", "b"]);
    const budget = googleSearchBudget(2);
    const options = { tools: [search], providerOptions: { google: { search: { budget } } } };

    await model.complete(messages, options);
    expect(sentTools(generateContent.mock.calls[0]?.[0])).toEqual([{ googleSearch: {} }]);
    expect(budget.used).toBe(2);

    await model.complete(messages, options);
    expect(generateContent.mock.calls[1]?.[0].config?.tools).toBeUndefined();
    expect(budget.used).toBe(2);
  });

  it("drops only the search entry and keeps other provider tools", async () => {
    const { model, generateContent } = setup(["a"]);
    const budget = googleSearchBudget(0);
    await model.complete(messages, {
      tools: [search, code],
      providerOptions: { google: { search: { budget } } },
    });

    expect(sentTools(generateContent.mock.calls[0]?.[0])).toEqual([{ codeExecution: {} }]);
  });

  it("counts streamed calls too", async () => {
    const { model, generateContentStream } = setup(["a", "b", "c"]);
    const budget = googleSearchBudget(5);
    const options = { tools: [search], providerOptions: { google: { search: { budget } } } };
    for await (const chunk of model.stream(messages, options)) void chunk;

    expect(budget.used).toBe(3);
    expect(sentTools(generateContentStream.mock.calls[0]?.[0])).toEqual([{ googleSearch: {} }]);
  });

  it("without a budget nothing changes", async () => {
    const { model, generateContent } = setup(["a"]);
    await model.complete(messages, { tools: [search] });
    await model.complete(messages, { tools: [search] });

    expect(generateContent.mock.calls.every((call) => sentTools(call[0])?.length === 1)).toBe(true);
  });

  it("rejects a budget that did not come from googleSearchBudget()", async () => {
    const { model, generateContent } = setup([]);
    await expect(
      model.complete(messages, {
        tools: [search],
        providerOptions: { google: { search: { budget: { max: 3 } } } },
      }),
    ).rejects.toThrow("googleSearchBudget");
    expect(generateContent).not.toHaveBeenCalled();
  });
});
