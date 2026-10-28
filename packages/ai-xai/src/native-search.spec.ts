import { ai } from "@warlock.js/ai";
import { expect, it, vi } from "vitest";
import { XaiSDK } from "./sdk";

const messages = [{ role: "user" as const, content: "search" }];
const responseBody = {
  id: "resp",
  object: "response",
  status: "completed",
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search" } },
    {
      type: "message",
      id: "m",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "found it", annotations: [] }],
    },
  ],
  usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
};
const chatBody = {
  id: "chat",
  object: "chat.completion",
  created: 0,
  model: "grok-4",
  choices: [{ index: 0, message: { role: "assistant", content: "answer" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function transport() {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });

    return new Response(
      JSON.stringify(String(input).endsWith("/responses") ? responseBody : chatBody),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  return { fetch, requests };
}

const searchTool = (type: string, provider = "xai") =>
  ai.providerTool({ provider, definition: { type } });

it.each(["web_search", "x_search"])(
  "routes a call carrying xAI %s to POST /v1/responses",
  async (type) => {
    const { fetch, requests } = transport();
    const model = new XaiSDK({ apiKey: "test-key", fetch, maxRetries: 0 }).model({
      name: "grok-4",
    });
    const response = await model.complete(messages, { tools: [searchTool(type)] });

    expect(response.content).toBe("found it");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.x.ai/v1/responses");
    expect(requests[0]?.body).toMatchObject({
      model: "grok-4",
      store: false,
      tools: [{ type }],
    });
    // OpenAI-only include fields are not sent to xAI.
    expect(requests[0]?.body.include).toBeUndefined();
  },
);

it("counts the hosted search and keeps the output under the provider's own metadata key", async () => {
  const { fetch } = transport();
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({ name: "grok-4" });
  const response = await model.complete(messages, { tools: [searchTool("web_search")] });

  expect(response.usage.serverToolUse).toEqual({ webSearchRequests: 1 });
  expect(Object.keys(response.providerMetadata ?? {})).toEqual(["xai"]);
});

it("also takes the tool through providerTools", async () => {
  const { fetch, requests } = transport();
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({ name: "grok-4" });
  await model.complete(messages, {
    providerTools: [{ provider: "xai", definition: { type: "web_search" } }],
  });

  expect(requests[0]?.url).toBe("https://api.x.ai/v1/responses");
});

it("keeps ordinary calls on Chat Completions and prices requests as configured", async () => {
  const { fetch, requests } = transport();
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({
    name: "grok-4",
    pricing: { input: 1, output: 2, serverTools: { webSearch: 0.1 } },
  });
  const result = await model.complete(messages);

  expect(result.content).toBe("answer");
  expect(requests[0]?.url).toBe("https://api.x.ai/v1/chat/completions");
  expect(model.pricing?.serverTools?.webSearch).toBe(0.1);
});

it("api: responses sends every call to Responses", async () => {
  const { fetch, requests } = transport();
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({
    name: "grok-4",
    api: "responses",
  });
  await model.complete(messages);

  expect(requests[0]?.url).toBe("https://api.x.ai/v1/responses");
});

it("api: chat pins Chat Completions and rejects a search tool before transport", async () => {
  const { fetch } = transport();
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({ name: "grok-4", api: "chat" });

  await expect(model.complete(messages, { tools: [searchTool("web_search")] })).rejects.toThrow(
    'pinned to api: "chat"',
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects an unknown api value", () => {
  expect(() =>
    new XaiSDK({ apiKey: "k" }).model({ name: "grok-4", api: "soap" as unknown as "chat" }),
  ).toThrow("Unknown xAI api");
});

it("does not guess Responses on a relabelled gateway unless api: responses is set", async () => {
  const { fetch, requests } = transport();
  const sdk = new XaiSDK({ apiKey: "test-key", provider: "gateway", fetch });

  await expect(
    sdk
      .model({ name: "grok-4" })
      .complete(messages, { tools: [searchTool("web_search", "gateway")] }),
  ).rejects.toThrow("only chosen automatically");
  expect(fetch).not.toHaveBeenCalled();

  await sdk
    .model({ name: "grok-4", api: "responses" })
    .complete(messages, { tools: [searchTool("web_search", "gateway")] });
  expect(requests[0]?.url).toMatch(/\/responses$/u);
});

it("streams a Responses search call", async () => {
  const completed = { ...responseBody };
  const events = [
    { type: "response.output_item.done", item: responseBody.output[0] },
    {
      type: "response.output_text.delta",
      delta: "found it",
      item_id: "m",
      output_index: 1,
      content_index: 0,
    },
    { type: "response.completed", response: completed },
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
  );
  const model = new XaiSDK({ apiKey: "test-key", fetch }).model({ name: "grok-4" });
  const chunks = [];
  for await (const chunk of model.stream(messages, { tools: [searchTool("web_search")] })) {
    chunks.push(chunk);
  }

  expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.x.ai/v1/responses");
  expect(chunks.find((chunk) => chunk.type === "done")).toMatchObject({
    usage: { serverToolUse: { webSearchRequests: 1 } },
  });
});

it("lists models from GET /v1/models", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "grok-4", created: 1_750_000_000, object: "model", owned_by: "xai" },
            { id: "grok-imagine-image", created: 1_750_000_001, object: "model", owned_by: "xai" },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const models = await new XaiSDK({ apiKey: "test-key", fetch }).models();

  expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.x.ai/v1/models");
  expect(models.map((model) => [model.id, model.provider, model.kind])).toEqual([
    ["grok-4", "xai", "chat"],
    ["grok-imagine-image", "xai", "image"],
  ]);
});
