import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { MockSDK } from "../mock/mock-sdk";
import { tool } from "../tool/tool";
import type { ToolDispatchMode } from "../contracts/agent/agent-options.type";
import { spawnSubAgent } from "./spawn-sub-agent";

describe("spawnSubAgent", () => {
  it("runs a fresh agent on the subtask and returns its result", async () => {
    const model = MockSDK({
      responses: [{ content: "subtask done", finishReason: "stop" }],
    }).model({ name: "sub" });

    const result = await spawnSubAgent({
      name: "extractor",
      model,
      task: "Extract entities from the text",
    });

    expect(result.type).toBe("agent");
    expect(result.error).toBeUndefined();
    expect(result.text).toBe("subtask done");
    expect(result.report.name).toBe("extractor");
    expect(result.report.status).toBe("completed");
  });

  it.each([
    { toolDispatch: "sequential" as ToolDispatchMode, maxConcurrentTools: 3, expected: 1 },
    { toolDispatch: "concurrent" as ToolDispatchMode, maxConcurrentTools: 2, expected: 2 },
    { toolDispatch: undefined, maxConcurrentTools: undefined, expected: 4 },
  ])(
    "forwards dispatch $toolDispatch and cap $maxConcurrentTools",
    async ({ toolDispatch, maxConcurrentTools, expected }) => {
      let active = 0;
      let peak = 0;
      const completed: number[] = [];
      const work = tool({
        name: "work",
        description: "Run bounded work",
        input: {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: (value: unknown) => ({ value: value as number }),
          },
        } satisfies StandardSchemaV1<number>,
        execute: async (value: number) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active--;
          completed.push(value);
          return value;
        },
      });
      const model = MockSDK({
        responses: [
          {
            content: "",
            finishReason: "tool_calls",
            toolCalls: Array.from({ length: 6 }, (_, i) => ({
              id: `call-${i}`,
              name: "work",
              input: i,
            })),
          },
          { content: "done", finishReason: "stop" },
        ],
      }).model({ name: "sub" });
      const result = await spawnSubAgent({
        name: "bounded",
        model,
        task: "Work",
        tools: [work],
        toolDispatch,
        maxConcurrentTools,
      });
      expect(result.error).toBeUndefined();
      expect(peak).toBe(expected);
      expect(completed).toEqual([0, 1, 2, 3, 4, 5]);
    },
  );

  it("validates structured output against the provided schema", async () => {
    const model = MockSDK({
      responses: [{ content: '{"companies":["Acme"]}', finishReason: "stop" }],
    }).model({ name: "sub" });

    const schema: StandardSchemaV1<{ companies: string[] }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate(value: unknown) {
          const record = value as { companies?: unknown };
          if (Array.isArray(record?.companies)) {
            return { value: { companies: record.companies as string[] } };
          }
          return { issues: [{ message: "companies required" }] };
        },
      },
    };

    const result = await spawnSubAgent({
      name: "extractor",
      model,
      task: "List the companies",
      output: schema,
    });

    expect(result.data).toEqual({ companies: ["Acme"] });
  });

  it("enforces an isolated per-spawn token budget", async () => {
    const model = MockSDK({
      responses: [
        {
          content: "way too long",
          finishReason: "stop",
          usage: { input: 500, output: 500, total: 1000 },
        },
      ],
    }).model({ name: "sub" });

    const result = await spawnSubAgent({
      name: "capped",
      model,
      task: "Do a big thing",
      budget: { maxTokens: 10 },
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");
  });

  it("propagates sessionId onto the spawned report tree", async () => {
    const model = MockSDK({
      responses: [{ content: "ok", finishReason: "stop" }],
    }).model({ name: "sub" });

    const result = await spawnSubAgent({
      name: "tagged",
      model,
      task: "anything",
      sessionId: "session-42",
    });

    expect(result.report.sessionId).toBe("session-42");
  });
});
