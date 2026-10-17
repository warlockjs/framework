import type { ModelStreamChunk } from "@warlock.js/ai";
import { log } from "@warlock.js/logger";
import type { ChatRequest, ChatResponse, Ollama } from "ollama";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaModel } from "./model";

/** Recorded-style `/api/chat` stream with `think` on: thinking first, then content. */
const THINKING_STREAM: Array<Partial<ChatResponse>> = [
  { message: { role: "assistant", content: "", thinking: "Two plus " }, done: false },
  { message: { role: "assistant", content: "", thinking: "two." }, done: false },
  { message: { role: "assistant", content: "4" }, done: false },
  {
    message: { role: "assistant", content: "" },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 8,
    eval_count: 6,
  },
];

function makeModel(chunks: Array<Partial<ChatResponse>>) {
  const calls: ChatRequest[] = [];
  const chat = async (request: ChatRequest) => {
    calls.push(request);

    return {
      abort: () => undefined,
      async *[Symbol.asyncIterator]() {
        yield* chunks as ChatResponse[];
      },
    };
  };

  return { model: new OllamaModel({ chat } as unknown as Ollama, { name: "qwen3" }), calls };
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

describe("OllamaModel.stream() optional chunks", () => {
  it("emits no reasoning without opt-in", async () => {
    const { model } = makeModel(THINKING_STREAM);

    const chunks = await collect(model.stream([{ role: "user", content: "2+2" }]));

    expect(chunks.map((chunk) => chunk.type)).toEqual(["delta", "done"]);
  });

  it("maps message.thinking to reasoning chunks", async () => {
    const { model } = makeModel(THINKING_STREAM);

    const chunks = await collect(
      model.stream([{ role: "user", content: "2+2" }], { streamChunks: { reasoning: true } }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual(["reasoning", "reasoning", "delta", "done"]);
    expect(chunks[0]).toEqual({ type: "reasoning", delta: "Two plus " });
  });
});

describe("OllamaModel provider-defined tools", () => {
  it("skips another provider's tool with a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const { model, calls } = makeModel(THINKING_STREAM);

    await collect(
      model.stream([{ role: "user", content: "x" }], {
        providerTools: [{ provider: "openai", definition: { type: "web_search" } }],
      }),
    );

    expect(calls[0]?.tools).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "ai.ollama",
      "providerTool.skipped",
      expect.any(String),
      expect.objectContaining({ provider: "openai" }),
    );
  });
});
