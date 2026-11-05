import type { Ollama } from "ollama";
import { describe, expect, it } from "vitest";
import { OllamaModel } from "./model";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeClient(show?: () => Promise<unknown>) {
  const calls = { chat: 0, show: 0 };

  const client = {
    chat: async () => {
      calls.chat += 1;

      return { message: { role: "assistant", content: "ok" }, done: true, done_reason: "stop" };
    },
    show: async () => {
      calls.show += 1;

      if (!show) {
        throw new Error("not found");
      }

      return show();
    },
  } as unknown as Ollama;

  return { client, calls };
}

describe("OllamaModel context window", () => {
  it("is unset until the first call has run, then filled from /api/show", async () => {
    const { client, calls } = fakeClient(async () => ({
      parameters: "stop <|eot|>",
      model_info: { "general.architecture": "llama", "llama.context_length": 131072 },
    }));
    const model = new OllamaModel(client, { name: "llama3.1" });

    expect(model.capabilities.contextWindow).toBeUndefined();

    await model.complete([{ role: "user", content: "hi" }]);
    await settle();
    await model.complete([{ role: "user", content: "again" }]);

    expect(model.capabilities.contextWindow).toBe(131072);
    expect(calls.show).toBe(1);
  });

  it("accepts model_info as a Map and prefers a num_ctx model parameter", async () => {
    const { client } = fakeClient(async () => ({
      parameters: "num_ctx                        8192\nstop <|eot|>",
      model_info: new Map([["qwen2.context_length", 32768]]),
    }));
    const model = new OllamaModel(client, { name: "qwen2.5" });

    await model.complete([{ role: "user", content: "hi" }]);
    await settle();

    expect(model.capabilities.contextWindow).toBe(8192);
  });

  it("lets the config value win and skips the lookup", async () => {
    const { client, calls } = fakeClient(async () => ({
      model_info: { "llama.context_length": 131072 },
    }));
    const model = new OllamaModel(client, { name: "llama3.1", contextWindow: 16000 });

    expect(model.capabilities.contextWindow).toBe(16000);

    await model.complete([{ role: "user", content: "hi" }]);

    expect(model.capabilities.contextWindow).toBe(16000);
    expect(calls.show).toBe(0);
  });

  it("ignores a failed lookup and still completes", async () => {
    const { client, calls } = fakeClient();
    const model = new OllamaModel(client, { name: "llama3.1" });

    const response = await model.complete([{ role: "user", content: "hi" }]);
    await settle();

    expect(response.content).toBe("ok");
    expect(model.capabilities).not.toHaveProperty("contextWindow");
    expect(calls.chat).toBe(1);
  });
});
