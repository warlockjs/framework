import type { Ollama } from "ollama";
import { InvalidRequestError, type Message } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { OllamaModel } from "./model";

const messages: Message[] = [{ role: "user", content: "hi" }];

describe("Ollama provider options", () => {
  it("merges native body fields in completion and stream and leaves native counting absent", async () => {
    const chat = vi.fn(async (request: Record<string, unknown>) => {
      if (request.stream) return { abort() {}, async *[Symbol.asyncIterator]() {} };
      return { message: { content: "ok" }, done_reason: "stop" };
    });
    const model = new OllamaModel({ chat } as unknown as Ollama, {
      name: "llama3.1",
      reasoning: true,
    });
    const options = {
      temperature: 0.4,
      maxTokens: 1024,
      reasoning: { effort: "high" as const },
      providerOptions: {
        ollama: { body: { keep_alive: "10m", options: { top_k: 4, temperature: 0.7 } } },
        google: { body: { model: "other" } },
      },
    };
    await model.complete(messages, options);
    for await (const chunk of model.stream(messages, options)) void chunk;
    expect(chat.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({
        model: "llama3.1",
        keep_alive: "10m",
        options: { top_k: 4, temperature: 0.7, num_predict: 1024 },
        think: "high",
        stream: false,
      }),
      expect.objectContaining({
        model: "llama3.1",
        keep_alive: "10m",
        options: { top_k: 4, temperature: 0.7, num_predict: 1024 },
        think: "high",
        stream: true,
      }),
    ]);
    expect("countTokens" in model).toBe(false);
  });

  it("refuses protected fields before sending", async () => {
    const chat = vi.fn();
    const model = new OllamaModel({ chat } as unknown as Ollama, { name: "llama3.1" });
    for (const field of ["model", "messages", "tools", "stream"]) {
      await expect(
        model.complete(messages, { providerOptions: { ollama: { body: { [field]: [] } } } }),
      ).rejects.toThrow(InvalidRequestError);
    }
    expect(chat).not.toHaveBeenCalled();
  });
});
