import {
  ConverseCommand,
  ConverseStreamCommand,
  type BedrockRuntimeClient,
  type Message as BedrockMessage,
} from "@aws-sdk/client-bedrock-runtime";
import { agent, tool, type Message } from "@warlock.js/ai";
import { describe, expect, it, vi } from "vitest";
import { BedrockModel } from "./model";

const history: Message[] = [
  { role: "user", content: "old request ".repeat(100) },
  { role: "assistant", content: "old response ".repeat(100) },
  { role: "user", content: "old followup ".repeat(100) },
  { role: "assistant", content: "old answer ".repeat(100) },
];

describe("Bedrock agent compaction", () => {
  it.each(["execute", "stream"] as const)(
    "keeps user-first alternating Converse turns through repeated %s compaction",
    async (mode) => {
      const requests: BedrockMessage[][] = [];
      const send = vi.fn(async (command: ConverseCommand | ConverseStreamCommand) => {
        const trip = requests.length;
        requests.push(structuredClone(command.input.messages ?? []));
        const calls = [0, 1].map((index) => ({
          toolUseId: `call-${trip}-${index}`,
          name: "lookup",
          input: {},
        }));
        if (command instanceof ConverseStreamCommand) {
          return {
            stream: (async function* () {
              if (trip < 3) {
                for (const [index, call] of calls.entries()) {
                  yield {
                    contentBlockStart: {
                      contentBlockIndex: index,
                      start: { toolUse: { toolUseId: call.toolUseId, name: call.name } },
                    },
                  };
                  yield {
                    contentBlockDelta: {
                      contentBlockIndex: index,
                      delta: { toolUse: { input: "{}" } },
                    },
                  };
                  yield { contentBlockStop: { contentBlockIndex: index } };
                }
              } else {
                yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "done" } } };
              }
              yield { messageStop: { stopReason: trip < 3 ? "tool_use" : "end_turn" } };
            })(),
          };
        }
        return {
          output: {
            message: {
              role: "assistant",
              content: trip < 3 ? calls.map((toolUse) => ({ toolUse })) : [{ text: "done" }],
            },
          },
          stopReason: trip < 3 ? "tool_use" : "end_turn",
        };
      });
      const model = new BedrockModel({ send } as unknown as BedrockRuntimeClient, { name: "mock" });
      const worker = agent({
        model,
        tools: [
          tool({
            name: "lookup",
            description: "Look up data",
            execute: async () => "result ".repeat(100),
          }),
        ],
        maxTrips: 5,
        captureMessages: true,
        compaction: {
          afterTokens: 200,
          keep: 2,
          countTokens: (messages) => JSON.stringify(messages).length,
          summarize: (messages) => ({
            summary: { role: "assistant", content: "memo" },
            replacesFromIndex: 0,
            replacesToIndex: messages.length - 1,
          }),
        },
      });
      const result =
        mode === "execute"
          ? await worker.execute("current request", { history })
          : await worker.stream("current request", { history }).result;
      expect(result.error).toBeUndefined();
      expect(requests).toHaveLength(4);
      expect(
        result.report.compactions?.filter((record) => record.type === "applied").length,
      ).toBeGreaterThanOrEqual(2);
      for (const messages of requests) {
        expect(messages[0]?.role).toBe("user");
        for (let index = 1; index < messages.length; index++) {
          expect(messages[index]?.role).not.toBe(messages[index - 1]?.role);
        }
        expect(
          messages.some((message) =>
            message.content?.some((block) => block.text === "current request"),
          ),
        ).toBe(true);
      }
      expect(requests[0]?.[0]?.content?.[0]?.text).toBe("Summary of earlier conversation:\nmemo");
      expect(
        requests[3]?.some(
          (message) =>
            message.role === "assistant" &&
            message.content?.some((block) => block.text === "memo") &&
            message.content?.some((block) => block.toolUse),
        ),
      ).toBe(true);
      expect(
        requests[3]?.some(
          (message) => message.content?.filter((block) => block.toolResult).length === 2,
        ),
      ).toBe(true);
      expect(result.report.messages).toContainEqual({ role: "user", content: "current request" });
    },
  );
});
