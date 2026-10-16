import type { ProviderContentBlock } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { fromProviderBlocks, toProviderBlocks } from "./provider-blocks";

const wrap = (data: Record<string, unknown>, type = String(data.type)): ProviderContentBlock => ({
  provider: "anthropic",
  type,
  data,
});

const thinking = wrap({ type: "thinking", thinking: "", signature: "sig_1" });
const text = wrap({ type: "text", text: "hi" });
const toolUse = wrap({ type: "tool_use", id: "tu_1", name: "lookup", input: {} });

describe("fromProviderBlocks", () => {
  it("replays a well-formed assistant turn verbatim", () => {
    expect(
      fromProviderBlocks([thinking, text, toolUse], [{ id: "tu_1", name: "lookup", input: {} }]),
    ).toEqual([thinking.data, text.data, toolUse.data]);
  });

  it("replays server-tool, compaction and redacted-thinking blocks", () => {
    const blocks = [
      wrap({ type: "redacted_thinking", data: "opaque" }),
      wrap({ type: "server_tool_use", id: "srv_1", name: "web_search", input: {} }),
      wrap({ type: "web_search_tool_result", tool_use_id: "srv_1", content: [] }),
      wrap({ type: "compaction", content: "summary" }),
    ];

    expect(fromProviderBlocks(blocks, undefined)).toEqual(blocks.map((block) => block.data));
  });

  it("falls back when a block's data.type differs from its declared type", () => {
    // The tool-id check reads the wrapper type; the request would send data as is.
    const disguised = wrap({ type: "tool_use", id: "tu_x", name: "delete_all", input: {} }, "text");

    expect(fromProviderBlocks([thinking, disguised], undefined)).toBeUndefined();
  });

  it("falls back on block types an assistant turn never carries", () => {
    for (const data of [
      { type: "tool_result", tool_use_id: "tu_1", content: "x" },
      { type: "image", source: { type: "url", url: "https://example.com/x.png" } },
      { type: "document", source: { type: "text", data: "x" } },
      { type: "made_up" },
    ]) {
      expect(fromProviderBlocks([thinking, wrap(data)], undefined), data.type).toBeUndefined();
    }
  });

  it("falls back when data is not an object", () => {
    const broken = {
      provider: "anthropic",
      type: "text",
      data: "text",
    } as unknown as ProviderContentBlock;

    expect(fromProviderBlocks([broken], undefined)).toBeUndefined();
  });

  it("falls back when the tool_use ids no longer match the turn's toolCalls", () => {
    expect(
      fromProviderBlocks([thinking, toolUse], [{ id: "tu_other", name: "lookup", input: {} }]),
    ).toBeUndefined();
  });

  it("falls back on another provider's blocks", () => {
    expect(fromProviderBlocks([{ ...thinking, provider: "openai" }], undefined)).toBeUndefined();
  });
});

describe("toProviderBlocks", () => {
  it("keeps only turns with something beyond plain text and tool_use", () => {
    expect(toProviderBlocks([{ type: "text" }, { type: "tool_use" }])).toBeUndefined();
    expect(toProviderBlocks([{ type: "thinking" }, { type: "text" }])).toHaveLength(2);
  });
});
