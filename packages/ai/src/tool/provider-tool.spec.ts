import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStreamChunks } from "../model/stream-chunks";
import { isProviderTool, providerTool, selectProviderTools } from "./provider-tool";
import { tool } from "./tool";

const functionTool = tool({
  name: "lookup",
  description: "Lookup",
  execute: async () => "found",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("providerTool()", () => {
  it("carries the verbatim definition and is told apart from function tools", () => {
    const definition = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
    const webSearch = providerTool({ provider: "anthropic", definition });

    expect(webSearch.type).toBe("provider-tool");
    expect(webSearch.provider).toBe("anthropic");
    expect(webSearch.definition).toBe(definition);
    expect(webSearch.name).toBe("web_search");
    expect(isProviderTool(webSearch)).toBe(true);
    expect(isProviderTool(functionTool)).toBe(false);
    expect(isProviderTool({ provider: "x", definition: {} })).toBe(false);
  });

  it("derives a name from name, type, or a single-key definition", () => {
    expect(providerTool({ provider: "openai", definition: { type: "web_search" } }).name).toBe(
      "web_search",
    );
    expect(providerTool({ provider: "google", definition: { googleSearch: {} } }).name).toBe(
      "googleSearch",
    );
    expect(
      providerTool({ provider: "bedrock", definition: { systemTool: { name: "nova_grounding" } } })
        .name,
    ).toBe("nova_grounding");
    expect(providerTool({ provider: "x", definition: { a: 1, b: 2 } }).name).toBe("x_tool");
    expect(
      providerTool({ provider: "anthropic", name: "editor", definition: { type: "t" } }).name,
    ).toBe("editor");
  });

  it("runs a client-run provider tool through its execute handler", async () => {
    const bash = providerTool({
      provider: "anthropic",
      definition: { type: "bash_20250124", name: "bash" },
      execute: async (input: { command?: string }) => `ran ${input.command}`,
    });

    const result = await bash.invoke({ command: "ls" });

    expect(result.data).toBe("ran ls");
    expect(result.error).toBeUndefined();
  });

  it("fails a local call to a server-run tool with a clear error instead of throwing", async () => {
    const webSearch = providerTool({
      provider: "anthropic",
      definition: { type: "web_search_20250305", name: "web_search" },
    });

    const result = await webSearch.invoke({ query: "x" });

    expect(result.error?.message).toMatch(/runs on the anthropic side/);
  });
});

describe("selectProviderTools()", () => {
  it("keeps accepted definitions and strips provider tools out of the function tools", () => {
    const fromTools = providerTool({
      provider: "anthropic",
      definition: { type: "bash_20250124", name: "bash" },
    });
    const fromOption = {
      provider: "anthropic",
      definition: { type: "web_fetch_20250910", name: "web_fetch" },
    };

    const selected = selectProviderTools(
      { tools: [functionTool, fromTools], providerTools: [fromOption] },
      { accepts: ["anthropic"], module: "ai.test", model: "m" },
    );

    expect(selected.tools).toEqual([functionTool]);
    expect(selected.definitions).toEqual([fromOption.definition, fromTools.definition]);
  });

  it("skips other providers' tools and warns once per definition and model", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => Promise.resolve() as never);
    const google = { provider: "google", definition: { googleSearch: {} } };
    const target = { accepts: ["anthropic"], module: "ai.test", model: "claude" };

    const first = selectProviderTools({ providerTools: [google] }, target);
    selectProviderTools({ providerTools: [google] }, target);
    selectProviderTools({ providerTools: [google] }, { ...target, model: "other" });

    expect(first.definitions).toEqual([]);
    expect(first.tools).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "ai.test",
      "providerTool.skipped",
      expect.stringContaining("google"),
      expect.objectContaining({ provider: "google", tool: "googleSearch", model: "claude" }),
    );
  });

  it("sends the same definition once even when it is listed twice", () => {
    const definition = { type: "web_search" };
    const selected = selectProviderTools(
      {
        tools: [providerTool({ provider: "openai", definition })],
        providerTools: [{ provider: "openai", definition }],
      },
      { accepts: ["openai"], module: "ai.test", model: "m" },
    );

    expect(selected.definitions).toEqual([definition]);
  });
});

describe("resolveStreamChunks()", () => {
  it("is all-off by default, all-on for true, and per kind for an object", () => {
    expect(resolveStreamChunks(undefined)).toEqual({
      reasoning: false,
      toolArgs: false,
      usage: false,
    });
    expect(resolveStreamChunks({ streamChunks: false })).toEqual({
      reasoning: false,
      toolArgs: false,
      usage: false,
    });
    expect(resolveStreamChunks({ streamChunks: true })).toEqual({
      reasoning: true,
      toolArgs: true,
      usage: true,
    });
    expect(resolveStreamChunks({ streamChunks: { toolArgs: true } })).toEqual({
      reasoning: false,
      toolArgs: true,
      usage: false,
    });
  });
});
