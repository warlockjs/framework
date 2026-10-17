import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import type { AgentEventMap } from "../contracts/events/event-map.type";
import type { MiddlewareToolContext } from "../contracts/middleware/middleware-context.type";
import type { ToolCall } from "../contracts/result/tool-call.type";
import type { StreamEvent } from "../contracts/stream/stream-event.type";
import { MockModel } from "../mock/mock-model";
import { tool } from "../tool/tool";
import { agent } from "./agent";

const querySchema: StandardSchemaV1<{ q: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const candidate = value as { q?: unknown } | null;

      return typeof candidate?.q === "string"
        ? { value: { q: candidate.q } }
        : { issues: [{ message: "expected { q }" }] };
    },
  },
};

const search = tool({
  name: "search",
  description: "Search.",
  input: querySchema,
  execute: async ({ q }) => {
    if (q === "boom") {
      throw new Error("search failed");
    }

    return `results for ${q}`;
  },
});

/** One trip calling `search` twice (plus an unknown tool), then a final answer. */
function model(): MockModel {
  return new MockModel("mock-model", [
    {
      content: "",
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call_a", name: "search", input: { q: "cats" } },
        { id: "call_b", name: "search", input: { q: "boom" } },
        { id: "call_c", name: "missing", input: {} },
      ],
    },
    { content: "done", finishReason: "stop" },
  ]);
}

describe("agent — tool events carry the provider call id", () => {
  it("pairs calling / called / failed events of the same tool by callId", async () => {
    const calling = vi.fn<(payload: AgentEventMap["agent.tool.calling"]) => void>();
    const called = vi.fn<(payload: AgentEventMap["agent.tool.called"]) => void>();
    const failed = vi.fn<(payload: AgentEventMap["agent.tool.failed"]) => void>();

    const result = await agent({ model: model(), tools: [search] }).execute("find", {
      on: {
        "agent.tool.calling": calling,
        "agent.tool.called": called,
        "agent.tool.failed": failed,
      },
    });

    expect(calling.mock.calls.map(([payload]) => payload.callId).sort()).toEqual([
      "call_a",
      "call_b",
    ]);
    expect(called.mock.calls.map(([payload]) => payload.callId)).toEqual(["call_a"]);
    expect(called.mock.calls[0]?.[0].output).toBe("results for cats");
    expect(failed.mock.calls.map(([payload]) => payload.callId).sort()).toEqual([
      "call_b",
      "call_c",
    ]);

    // The report's tool records carry it too, in request order.
    const records = result.report.children.filter(
      (child): child is ToolCall => child.type === "tool",
    );

    expect(records.map((record) => record.callId)).toEqual(["call_a", "call_b", "call_c"]);
  });

  it("exposes callId on the tool middleware context", async () => {
    const seen: string[] = [];

    await agent({
      model: model(),
      tools: [search],
      toolDispatch: "sequential",
      middleware: [
        {
          name: "record-call-ids",
          tool: {
            before(ctx: MiddlewareToolContext) {
              seen.push(`${ctx.callId}:${ctx.request.id}`);
            },
          },
        },
      ],
    }).execute("find");

    expect(seen).toEqual(["call_a:call_a", "call_b:call_b"]);
  });

  it("carries callId on stream events", async () => {
    const stream = agent({ model: model(), tools: [search] }).stream("find");
    const toolEvents: StreamEvent[] = [];

    for await (const event of stream) {
      if (event.type.startsWith("agent.tool.")) {
        toolEvents.push(event);
      }
    }

    await stream.result;

    const ids = toolEvents.map((event) =>
      event.type === "agent.tool.calling" ||
      event.type === "agent.tool.called" ||
      event.type === "agent.tool.failed"
        ? `${event.type}:${event.callId}`
        : event.type,
    );

    expect(ids.sort()).toEqual([
      "agent.tool.called:call_a",
      "agent.tool.calling:call_a",
      "agent.tool.calling:call_b",
      "agent.tool.failed:call_b",
      "agent.tool.failed:call_c",
    ]);

    const calledEvent = toolEvents.find((event) => event.type === "agent.tool.called");

    expect(calledEvent?.type === "agent.tool.called" && calledEvent.toolCall.callId).toBe("call_a");
  });
});
