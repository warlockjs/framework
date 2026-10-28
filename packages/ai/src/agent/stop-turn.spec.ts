import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import { MockSDK } from "../mock/mock-sdk";
import { tool } from "../tool/tool";
import { agent } from "./agent";

const anyInput: StandardSchemaV1<Record<string, unknown>> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: (value ?? {}) as Record<string, unknown> }),
  },
};

function script() {
  return MockSDK({
    responses: [
      {
        content: "Posting now.",
        toolCalls: [{ id: "c1", name: "post_message", input: { text: "hi" } }],
        usage: { input: 10, output: 4 },
      },
      { content: "should not be requested", finishReason: "stop" },
    ],
  });
}

function postMessage(extra: Record<string, unknown> = {}, fail = false) {
  return tool<Record<string, unknown>, { posted: boolean }>({
    name: "post_message",
    description: "Posts a message.",
    input: anyInput,
    execute: async () => {
      if (fail) throw new Error("boom");

      return { posted: true };
    },
    ...extra,
  });
}

describe("agent — ending a turn from a tool", () => {
  it("stopAfterTools ends the run without another model call", async () => {
    const sdk = script();
    const model = sdk.model({ name: "m" });

    const result = await agent({
      model,
      tools: [postMessage()],
      stopAfterTools: ["post_message"],
    }).execute("go");

    expect(model.callCount).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.text).toBe("Posting now.");
    expect(result.report.trips).toHaveLength(1);
    expect(result.report.trips[0]?.finishReason).toBe("tool_stop");
    expect(result.report.children).toHaveLength(1);
    expect(result.usage.total).toBe(14);
  });

  it("a tool's endsTurn: true stops the run", async () => {
    const model = script().model({ name: "m" });

    const result = await agent({ model, tools: [postMessage({ endsTurn: true })] }).execute("go");

    expect(model.callCount).toBe(1);
    expect(result.report.trips[0]?.finishReason).toBe("tool_stop");
  });

  it("endsTurn as a function decides from input and output", async () => {
    const stopOnPosted = vi.fn(({ output }: { output: { posted: boolean } }) => output.posted);
    const model = script().model({ name: "m" });

    await agent({ model, tools: [postMessage({ endsTurn: stopOnPosted })] }).execute("go");

    expect(stopOnPosted).toHaveBeenCalledWith({ input: { text: "hi" }, output: { posted: true } });
    expect(model.callCount).toBe(1);

    const continuing = script().model({ name: "m" });

    await agent({ model: continuing, tools: [postMessage({ endsTurn: () => false })] }).execute(
      "go",
    );

    expect(continuing.callCount).toBe(2);
  });

  it("stopWhen sees this trip's tool calls and can end the run", async () => {
    const seen: string[][] = [];
    const model = script().model({ name: "m" });

    const result = await agent({
      model,
      tools: [postMessage()],
      stopWhen: async ({ toolCalls, tripIndex }) => {
        seen.push(toolCalls.map((call) => `${tripIndex}:${call.name}`));

        return toolCalls.some((call) => call.name === "post_message");
      },
    }).execute("go");

    expect(seen).toEqual([["0:post_message"]]);
    expect(model.callCount).toBe(1);
    expect(result.report.trips[0]?.finishReason).toBe("tool_stop");
  });

  it("a failed tool call never stops the run through stopAfterTools or endsTurn", async () => {
    const model = script().model({ name: "m" });

    const result = await agent({
      model,
      tools: [postMessage({ endsTurn: true }, true)],
      stopAfterTools: ["post_message"],
    }).execute("go");

    expect(model.callCount).toBe(2);
    expect(result.report.trips.at(-1)?.finishReason).toBe("stop");
  });

  it("a throwing stopWhen is ignored and the run continues", async () => {
    const model = script().model({ name: "m" });

    const result = await agent({
      model,
      tools: [postMessage()],
      stopWhen: () => {
        throw new Error("bad rule");
      },
    }).execute("go");

    expect(model.callCount).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it("does not report max-trips when the stop lands on the last allowed trip", async () => {
    const model = script().model({ name: "m" });

    const result = await agent({
      model,
      maxTrips: 1,
      tools: [postMessage()],
      stopAfterTools: ["post_message"],
    }).execute("go");

    expect(result.error).toBeUndefined();
  });

  it("agents without stop options keep looping as before", async () => {
    const model = script().model({ name: "m" });

    const result = await agent({ model, tools: [postMessage()] }).execute("go");

    expect(model.callCount).toBe(2);
    expect(result.text).toBe("should not be requested");
  });
});
