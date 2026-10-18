import { ai } from "@warlock.js/ai";
import { expect, it, vi } from "vitest";
import { XaiSDK } from "./sdk";

it.each(["web_search", "x_search"])(
  "rejects xAI %s on Chat Completions before transport",
  async (type) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const model = new XaiSDK({ apiKey: "test-key", fetch }).model({ name: "grok-4" });
    const options = { providerTools: [ai.providerTool({ provider: "xai", definition: { type } })] };
    await expect(model.complete([{ role: "user", content: "search" }], options)).rejects.toThrow(
      "requires POST /v1/responses",
    );
    await expect(async () => {
      for await (const chunk of model.stream([{ role: "user", content: "search" }], options)) {
        void chunk;
      }
    }).rejects.toThrow("Responses API");
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("rejects native search on relabeled xAI gateways", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const model = new XaiSDK({ apiKey: "test-key", provider: "gateway", fetch }).model({
    name: "grok-4",
  });
  await expect(
    model.complete([{ role: "user", content: "search" }], {
      tools: [ai.providerTool({ provider: "gateway", definition: { type: "web_search" } })],
    }),
  ).rejects.toThrow("requires POST /v1/responses");
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves ordinary chat transport and configured request prices", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "chat",
        object: "chat.completion",
        created: 0,
        model: "grok-4",
        choices: [
          { index: 0, message: { role: "assistant", content: "answer" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({
    name: "grok-4",
    pricing: { input: 1, output: 2, serverTools: { webSearch: 0.1 } },
  });
  const result = await model.complete([{ role: "user", content: "hi" }]);
  expect(result.content).toBe("answer");
  expect(model.pricing?.serverTools?.webSearch).toBe(0.1);
  expect(fetch).toHaveBeenCalledOnce();
});
