import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import type { BaseReport } from "../contracts/result/base-report.type";
import type { ToolCall } from "../contracts/result/tool-call.type";
import type { MockModelResponse } from "../mock/mock-config.type";
import { AgentIncompleteError } from "../errors";
import { MockModel } from "../mock/mock-model";
import { tool } from "../tool/tool";
import { agent } from "./agent";

function makeSchema<T>(
  validate: (value: unknown) => StandardSchemaV1.Result<T>,
): StandardSchemaV1<T> {
  return { "~standard": { version: 1, vendor: "test", validate } };
}

const fileSchema = makeSchema<{ path: string; body: string }>((value) => {
  const candidate = value as { path?: unknown; body?: unknown } | null;

  return typeof candidate?.path === "string" && typeof candidate.body === "string"
    ? { value: { path: candidate.path, body: candidate.body } }
    : { issues: [{ message: "expected { path, body }" }] };
});

const summarySchema = makeSchema<{ summary: string }>((value) => {
  const candidate = value as { summary?: unknown } | null;

  return typeof candidate?.summary === "string"
    ? { value: { summary: candidate.summary } }
    : { issues: [{ message: "missing summary" }] };
});

function makeWriteFileTool() {
  const execute = vi.fn(async (_input: { path: string; body: string }) => "written");

  return {
    execute,
    writeFile: tool({
      name: "write_file",
      description: "Write a file.",
      input: fileSchema,
      execute,
    }),
  };
}

function toolCalls(report: { children: BaseReport[] }): ToolCall[] {
  return report.children.filter((child): child is ToolCall => child.type === "tool");
}

function model(responses: MockModelResponse[]): MockModel {
  return new MockModel("mock-model", responses);
}

describe("agent — a response cut off by the model's limits", () => {
  it("ends incomplete when the final response is cut off mid-text", async () => {
    const mock = model([{ content: "The answer begins", finishReason: "length" }]);

    const result = await agent({ model: mock }).execute("explain");

    expect(result.error).toBeInstanceOf(AgentIncompleteError);
    expect(result.error?.code).toBe("AGENT_INCOMPLETE");
    expect(result.error?.category).toBe("incomplete");
    expect(result.report.status).toBe("incomplete");
    expect(result.report.error).toBe(result.error);
    expect(result.text).toBe("The answer begins");

    const error = result.error as AgentIncompleteError;

    expect(error.reason).toBe("output_limit");
    expect(error.tripIndex).toBe(0);
    expect(error.continuations).toBe(0);
  });

  it("never runs a tool call that was cut off mid-input", async () => {
    const { execute, writeFile } = makeWriteFileTool();
    const mock = model([
      {
        content: "",
        finishReason: "length",
        toolCalls: [{ id: "call_1", name: "write_file", input: { path: "a.ts" } }],
      },
      { content: "should not be reached", finishReason: "stop" },
    ]);

    const result = await agent({ model: mock, tools: [writeFile] }).execute("write a.ts");

    expect(execute).not.toHaveBeenCalled();
    expect(mock.callCount).toBe(1);
    expect(result.report.status).toBe("incomplete");
    expect(result.report.children).toHaveLength(0);
    expect(result.report.trips[0]?.toolCalls).toBeUndefined();
    expect(result.report.trips[0]?.truncatedToolCalls).toEqual([
      { id: "call_1", name: "write_file", input: { path: "a.ts" } },
    ]);
    expect(result.error?.context).toMatchObject({ truncatedToolCalls: ["write_file"] });
  });

  it("ends incomplete with reason context_window and never continues it", async () => {
    const mock = model([
      { content: "partial", finishReason: "context_exceeded" },
      { content: "should not be reached", finishReason: "stop" },
    ]);

    const result = await agent({ model: mock, continueOnOutputLimit: 3 }).execute("huge input");

    expect(mock.callCount).toBe(1);
    expect(result.report.status).toBe("incomplete");
    expect((result.error as AgentIncompleteError).reason).toBe("context_window");
  });

  it("emits agent.error with the incomplete error", async () => {
    const onError = vi.fn();
    const mock = model([{ content: "cut", finishReason: "length" }]);

    await agent({ model: mock, on: { "agent.error": onError } }).execute("go");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(AgentIncompleteError) }),
    );
  });
});

describe("agent — continueOnOutputLimit", () => {
  it("continues a response cut off mid-text and joins the text", async () => {
    const mock = model([
      { content: "First half, ", finishReason: "length" },
      { content: "second half.", finishReason: "stop" },
    ]);

    const result = await agent({ model: mock, continueOnOutputLimit: 1 }).execute("write");

    expect(result.error).toBeUndefined();
    expect(result.report.status).toBe("completed");
    expect(result.text).toBe("First half, second half.");
    expect(result.report.trips.map((trip) => trip.input)).toEqual(["write", "[continue]"]);

    const second = mock.callHistory[1]?.messages ?? [];

    expect(second.slice(1, 3)).toEqual([
      { role: "assistant", content: "First half, " },
      {
        role: "user",
        content: expect.stringContaining("Continue exactly where it stopped"),
      },
    ]);
  });

  it("discards a tool call cut off mid-input and lets the model issue it again", async () => {
    const { execute, writeFile } = makeWriteFileTool();
    const mock = model([
      {
        content: "Writing the file.",
        finishReason: "length",
        toolCalls: [{ id: "call_cut", name: "write_file", input: { path: "a.ts" } }],
      },
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call_ok", name: "write_file", input: { path: "a.ts", body: "x" } }],
      },
      { content: "Done.", finishReason: "stop" },
    ]);

    const result = await agent({
      model: mock,
      tools: [writeFile],
      continueOnOutputLimit: 1,
    }).execute("write a.ts");

    expect(result.report.status).toBe("completed");
    expect(result.text).toBe("Done.");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ path: "a.ts", body: "x" });
    expect(toolCalls(result.report).map((call) => call.callId)).toEqual(["call_ok"]);
    expect(result.report.trips[0]?.truncatedToolCalls?.[0]?.id).toBe("call_cut");

    // The model's recorded history is the live conversation array.
    const history = mock.callHistory[1]?.messages ?? [];
    const replayedAt = history.findIndex((message) => message.content === "Writing the file.");

    // The partial text is replayed without the discarded call.
    expect(history[replayedAt]).toEqual({ role: "assistant", content: "Writing the file." });
    expect(history[replayedAt + 1]?.content).toContain("was discarded and did not run");
  });

  it("does not replay an empty partial turn", async () => {
    const mock = model([
      {
        content: "",
        finishReason: "length",
        toolCalls: [{ id: "call_cut", name: "write_file", input: {} }],
      },
      { content: "Recovered.", finishReason: "stop" },
    ]);

    await agent({ model: mock, continueOnOutputLimit: 1 }).execute("go");

    const second = mock.callHistory[1]?.messages ?? [];

    expect(second.map((message) => message.role)).toEqual(["user", "user"]);
  });

  it("ends incomplete when the continuations run out", async () => {
    const mock = model([
      { content: "one ", finishReason: "length" },
      { content: "two ", finishReason: "length" },
      { content: "never", finishReason: "stop" },
    ]);

    const result = await agent({ model: mock, continueOnOutputLimit: 1 }).execute("write");

    expect(mock.callCount).toBe(2);
    expect(result.report.status).toBe("incomplete");
    expect(result.text).toBe("one two ");

    const error = result.error as AgentIncompleteError;

    expect(error.tripIndex).toBe(1);
    expect(error.continuations).toBe(1);
  });

  it("stops continuing at maxTrips", async () => {
    const mock = model([{ content: "again ", finishReason: "length" }]);

    const result = await agent({
      model: mock,
      maxTrips: 2,
      continueOnOutputLimit: 5,
    }).execute("write");

    expect(mock.callCount).toBe(2);
    expect(result.error).toBeInstanceOf(AgentIncompleteError);
  });

  it("uses the per-call value over the agent's", async () => {
    const mock = model([
      { content: "a", finishReason: "length" },
      { content: "b", finishReason: "stop" },
    ]);
    const writer = agent({ model: mock });

    const result = await writer.execute("write", { continueOnOutputLimit: 1 });

    expect(result.text).toBe("ab");
    expect(result.report.status).toBe("completed");
  });

  it("finishes a cut-off repair answer before parsing it", async () => {
    const mock = model([
      { content: "not json", finishReason: "stop" },
      { content: '{"summary":', finishReason: "length" },
      { content: '"ok"}', finishReason: "stop" },
    ]);

    const result = await agent({ model: mock, continueOnOutputLimit: 1 }).execute("sum", {
      output: summarySchema,
      repair: { maxAttempts: 1 },
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ summary: "ok" });
  });
});

describe("agent.stream — a response cut off by the model's limits", () => {
  it("ends the stream incomplete and never runs a cut-off tool call", async () => {
    const { execute, writeFile } = makeWriteFileTool();
    const mock = model([
      {
        content: "Writing",
        deltas: ["Writing"],
        finishReason: "length",
        toolCalls: [{ id: "call_cut", name: "write_file", input: {} }],
      },
    ]);

    const stream = agent({ model: mock, tools: [writeFile] }).stream("write");
    const types: string[] = [];

    for await (const event of stream) {
      types.push(event.type);
    }

    const result = await stream.result;

    expect(execute).not.toHaveBeenCalled();
    expect(types).not.toContain("agent.tool.calling");
    expect(types).toContain("agent.error");
    expect(result.report.status).toBe("incomplete");
    expect(result.text).toBe("Writing");
  });

  it("continues a cut-off stream and joins the text", async () => {
    const mock = model([
      { content: "Hello, ", deltas: ["Hello, "], finishReason: "length" },
      { content: "world.", deltas: ["world."], finishReason: "stop" },
    ]);

    const stream = agent({ model: mock, continueOnOutputLimit: 1 }).stream("greet");
    const deltas: string[] = [];

    for await (const event of stream) {
      if (event.type === "agent.trip.streaming") {
        deltas.push(event.delta);
      }
    }

    const result = await stream.result;

    expect(deltas.join("")).toBe("Hello, world.");
    expect(result.text).toBe("Hello, world.");
    expect(result.report.status).toBe("completed");
  });
});
