import type Anthropic from "@anthropic-ai/sdk";
import { ai } from "@warlock.js/ai";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicModel } from "./model";

type CreateParams = Record<string, unknown> & { tools?: Array<Record<string, unknown>> };

function makeModel(config: { promptCaching?: boolean } = {}) {
  const calls: CreateParams[] = [];
  const create = async (params: CreateParams) => {
    calls.push(params);

    return {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "ok", citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  };
  const model = new AnthropicModel({ messages: { create } } as unknown as Anthropic, {
    name: "claude-sonnet-4-6",
    ...config,
  });

  return { model, calls };
}

const weatherTool = ai.tool({
  name: "get_weather",
  description: "Weather for a city",
  execute: async () => ({ temp: 20 }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AnthropicModel provider-defined tools", () => {
  it("sends an anthropic definition verbatim before the function tools", async () => {
    const { model, calls } = makeModel();
    const definition = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

    await model.complete([{ role: "user", content: "news?" }], {
      tools: [weatherTool],
      providerTools: [{ provider: "anthropic", definition }],
    });

    const tools = calls[0]?.tools ?? [];

    expect(tools[0]).toEqual(definition);
    expect(tools[1]).toMatchObject({ name: "get_weather" });
    expect(tools).toHaveLength(2);
  });

  it("accepts ai.providerTool() entries left in tools", async () => {
    const { model, calls } = makeModel();
    const bash = ai.providerTool({
      provider: "anthropic",
      definition: { type: "bash_20250124", name: "bash" },
    });

    await model.complete([{ role: "user", content: "ls" }], { tools: [bash, weatherTool] });

    expect(calls[0]?.tools).toEqual([
      { type: "bash_20250124", name: "bash" },
      expect.objectContaining({ name: "get_weather", input_schema: { type: "object" } }),
    ]);
  });

  it("keeps the cache breakpoint on the last function tool, not on a provider definition", async () => {
    const { model, calls } = makeModel({ promptCaching: true });
    const definition = { type: "web_fetch_20250910", name: "web_fetch" };

    await model.complete([{ role: "user", content: "x" }], {
      tools: [weatherTool],
      providerTools: [{ provider: "anthropic", definition }],
    });

    const tools = calls[0]?.tools ?? [];

    expect(tools[0]).toEqual(definition);
    expect(tools[1]).toMatchObject({ name: "get_weather", cache_control: { type: "ephemeral" } });
  });

  it("skips another provider's tool with one warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const { model, calls } = makeModel();
    const googleSearch = { provider: "google", definition: { googleSearch: {} } };

    await model.complete([{ role: "user", content: "x" }], { providerTools: [googleSearch] });
    await model.complete([{ role: "user", content: "x" }], { providerTools: [googleSearch] });

    expect(Object.keys(calls[0] ?? {})).not.toContain("tools");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toBe("providerTool.skipped");
  });

  it("still refuses tools inside providerOptions.anthropic.body", async () => {
    const { model } = makeModel();

    await expect(
      model.complete([{ role: "user", content: "x" }], {
        providerOptions: { anthropic: { body: { tools: [] } } },
      }),
    ).rejects.toThrow(/cannot set "tools"/);
  });
});
