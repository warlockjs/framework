import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../contracts/stream/stream-event.type";
import { MockModel } from "../mock/mock-model";
import { providerTool } from "../tool/provider-tool";
import { tool } from "../tool/tool";
import { agent } from "./agent";

const lookup = tool({
  name: "lookup",
  description: "Look something up",
  execute: async (input: unknown) => ({ found: input }),
});

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

function toolTripModel(): MockModel {
  return new MockModel("mock", [
    {
      content: "",
      reasoning: ["Need to ", "look it up."],
      toolCalls: [{ id: "call_1", name: "lookup", input: { q: "cairo" } }],
      finishReason: "tool_calls",
      usage: { input: 10, output: 4 },
    },
    { content: "Found it.", finishReason: "stop", usage: { input: 20, output: 3 } },
  ]);
}

describe("agent.stream() reasoning, tool-argument and usage events", () => {
  it("surfaces reasoning, tool-args and interim usage as stream events", async () => {
    const model = toolTripModel();
    const stream = agent({ model, tools: [lookup] }).stream("Where is Cairo?");

    const events = await drain(stream);
    const types = events.map((event) => event.type);

    expect(events.filter((event) => event.type === "agent.trip.reasoning")).toEqual([
      expect.objectContaining({ delta: "Need to ", tripIndex: 0 }),
      expect.objectContaining({ delta: "look it up.", tripIndex: 0 }),
    ]);
    expect(events.find((event) => event.type === "agent.tool.streaming")).toMatchObject({
      callId: "call_1",
      name: "lookup",
      delta: '{"q":"cairo"}',
      tripIndex: 0,
    });
    expect(events.filter((event) => event.type === "agent.trip.usage")).toEqual([
      expect.objectContaining({ usage: { input: 10, output: 4, total: 14 }, tripIndex: 0 }),
      expect.objectContaining({ usage: { input: 20, output: 3, total: 23 }, tripIndex: 1 }),
    ]);
    // Argument deltas arrive before the dispatch of the same call.
    expect(types.indexOf("agent.tool.streaming")).toBeLessThan(types.indexOf("agent.tool.calling"));
    // Reasoning never leaks into the answer.
    expect((await stream.result).text?.trim()).toBe("Found it.");
    expect(model.callHistory[0]?.options?.streamChunks).toBe(true);
  });

  it("delivers the new events to stream.on() handlers with run identity", async () => {
    const reasoning: string[] = [];
    const runIds: string[] = [];
    const stream = agent({ model: toolTripModel(), tools: [lookup] })
      .stream("Where is Cairo?")
      .on({
        "agent.trip.reasoning": (event) => {
          if (event.type === "agent.trip.reasoning") {
            reasoning.push(event.delta);
            runIds.push(event.runId);
          }
        },
      });

    await stream.result;

    expect(reasoning).toEqual(["Need to ", "look it up."]);
    expect(runIds.every((id) => typeof id === "string" && id !== "")).toBe(true);
  });

  it("lets modelOptions.streamChunks turn the extra chunks off", async () => {
    const model = toolTripModel();
    const events = await drain(
      agent({ model, tools: [lookup], modelOptions: { streamChunks: false } }).stream("Where?"),
    );

    expect(
      events.some((event) =>
        ["agent.trip.reasoning", "agent.tool.streaming", "agent.trip.usage"].includes(event.type),
      ),
    ).toBe(false);
    expect(model.callHistory[0]?.options?.streamChunks).toBe(false);
  });

  it("does not ask for stream chunks on execute()", async () => {
    const model = toolTripModel();

    await agent({ model, tools: [lookup] }).execute("Where?");

    expect(model.callHistory[0]?.options?.streamChunks).toBeUndefined();
  });

  it("ignores a chunk type it does not know instead of treating it as done", async () => {
    const model = {
      name: "future",
      provider: "mock",
      async complete() {
        throw new Error("not used");
      },
      async *stream() {
        yield { type: "delta" as const, content: "Hi" };
        yield { type: "something-new" } as unknown as { type: "delta"; content: string };
        yield {
          type: "done" as const,
          finishReason: "stop" as const,
          usage: { input: 1, output: 1, total: 2 },
        };
      },
    };

    const result = await agent({ model }).stream("x").result;

    expect(result.text).toBe("Hi");
    expect(result.usage.total).toBe(2);
  });
});

describe("agent with provider-defined tools", () => {
  it("sends provider tools as providerTools, never as function tools", async () => {
    const model = new MockModel("mock", [{ content: "ok", finishReason: "stop" }]);
    const webSearch = providerTool({
      provider: "anthropic",
      definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    });

    await agent({ model, tools: [lookup, webSearch] }).execute("news?");

    const options = model.callHistory[0]?.options;

    expect(options?.tools?.map((entry) => entry.name)).toEqual(["lookup"]);
    expect(options?.providerTools).toEqual([
      { provider: "anthropic", definition: webSearch.definition },
    ]);
  });

  it("omits providerTools when the agent has none", async () => {
    const model = new MockModel("mock", [{ content: "ok", finishReason: "stop" }]);

    await agent({ model, tools: [lookup] }).execute("hi");

    expect(Object.keys(model.callHistory[0]?.options ?? {})).not.toContain("providerTools");
  });

  it("dispatches a client-run provider tool call to its execute handler", async () => {
    const commands: string[] = [];
    const bash = providerTool({
      provider: "anthropic",
      definition: { type: "bash_20250124", name: "bash" },
      execute: async (input: { command: string }) => {
        commands.push(input.command);
        return "file.txt";
      },
    });
    const model = new MockModel("mock", [
      {
        content: "",
        toolCalls: [{ id: "toolu_1", name: "bash", input: { command: "ls" } }],
        finishReason: "tool_calls",
      },
      { content: "There is file.txt.", finishReason: "stop" },
    ]);

    const result = await agent({ model, tools: [bash] }).execute("list files");

    expect(commands).toEqual(["ls"]);
    expect(result.text).toBe("There is file.txt.");
    expect(model.callHistory[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "toolu_1",
      content: JSON.stringify("file.txt"),
    });
  });
});
