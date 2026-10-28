import { expect, it, vi } from "vitest";
import { MistralSDK } from "./sdk";

it("models() lists the provider's /models through the shared OpenAI-compatible listing", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          {
            id: "chat-model",
            created: 1_700_000_000,
            context_window: 8192,
            max_context_length: 8192,
          },
          { id: "retired-model", active: false },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  const models = await new MistralSDK({ apiKey: "k", fetch }).models();

  expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/models$/u);
  expect(
    models.map((model) => [model.id, model.provider, model.kind, model.contextWindow]),
  ).toEqual([["chat-model", "mistral", "chat", 8192]]);
});
