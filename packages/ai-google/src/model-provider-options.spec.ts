import { GoogleGenAI } from "@google/genai";
import { InvalidRequestError, type Message, type ModelCallOptions } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { GoogleModel } from "./model";

const messages: Message[] = [
  { role: "system", content: "rules" },
  { role: "user", content: "hi" },
];
const tools = [{ name: "lookup", description: "Look up data", execute: async () => "ok" }];

function setup(vertexai = false) {
  const generateContent = vi.fn(async (_request: unknown) => ({ text: "ok", candidates: [] }));
  const countTokens = vi.fn(async (_request: unknown) => ({ totalTokens: 123 }));
  const generateContentStream = vi.fn(async (_request: unknown) => (async function* () {})());
  const ai = {
    vertexai,
    models: { generateContent, countTokens, generateContentStream },
  } as unknown as GoogleGenAI;
  return {
    model: new GoogleModel(ai, { name: "gemini-2.5-flash" }),
    generateContent,
    countTokens,
    generateContentStream,
  };
}

describe("Google provider options and native counts", () => {
  it("counts the same Vertex content, system and tools sent on completion, with cancellation", async () => {
    const { model, generateContent, countTokens } = setup(true);
    const signal = new AbortController().signal;
    const options: ModelCallOptions = {
      tools,
      signal,
      providerOptions: { google: { body: { topP: 0.8 } }, openai: { body: { messages: [] } } },
    };
    await model.complete(messages, options);
    expect(await model.countTokens(messages, options)).toBe(123);
    const generated = generateContent.mock.calls[0]?.[0] as unknown as {
      contents: unknown;
      config: Record<string, unknown>;
    };
    expect(countTokens).toHaveBeenCalledWith({
      model: model.name,
      contents: generated.contents,
      config: {
        systemInstruction: generated.config.systemInstruction,
        tools: generated.config.tools,
        abortSignal: signal,
      },
    });
    expect(generated.config.topP).toBe(0.8);
  });

  it("supports Developer API contents counting and explicitly rejects system/tools or cached references", async () => {
    const { model, countTokens } = setup();
    expect(await model.countTokens([{ role: "user", content: "hi" }])).toBe(123);
    await expect(model.countTokens(messages)).rejects.toThrow(/Developer API mode/);
    await expect(model.countTokens([{ role: "user", content: "hi" }], { tools })).rejects.toThrow(
      /Developer API mode/,
    );
    await expect(
      model.countTokens([{ role: "user", content: "hi" }], {
        providerOptions: { google: { body: { cachedContent: "cachedContents/one" } } },
      }),
    ).rejects.toThrow(/cachedContent/);
    expect(countTokens).toHaveBeenCalledTimes(1);
  });

  it("checks the installed SDK Developer API restriction before any network request", async () => {
    const sdk = new GoogleGenAI({ apiKey: "test" });
    const count = vi.spyOn(sdk.models, "countTokens");
    const model = new GoogleModel(sdk, { name: "gemini-2.5-flash" });
    await expect(model.countTokens(messages, { tools })).rejects.toThrow(InvalidRequestError);
    expect(count).not.toHaveBeenCalled();
    count.mockRestore();
    await expect(
      sdk.models.countTokens({
        model: "gemini-2.5-flash",
        contents: "hi",
        config: { systemInstruction: "rules" },
      }),
    ).rejects.toThrow(/systemInstruction parameter is only supported/);
  });

  it("applies provider config to streams and refuses protected fields before sending", async () => {
    const { model, generateContentStream, generateContent } = setup();
    for await (const chunk of model.stream(messages, {
      providerOptions: { google: { body: { topK: 4 } } },
    }))
      void chunk;
    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ topK: 4 }) }),
    );
    for (const field of ["systemInstruction", "tools", "abortSignal", "httpOptions"]) {
      await expect(
        model.complete(messages, { providerOptions: { google: { body: { [field]: [] } } } }),
      ).rejects.toThrow(InvalidRequestError);
    }
    expect(generateContent).not.toHaveBeenCalled();
  });
});
