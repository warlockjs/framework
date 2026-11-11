import { describe, expect, it, vi } from "vitest";
import { agent } from "../agent/agent";
import type { StreamEvent } from "../contracts/stream/stream-event.type";
import { guardrail as checkGuardrail } from "../middleware/builtins/guardrail";
import { MockModel } from "../mock/mock-model";
import { tool } from "../tool/tool";
import type { GuardrailDetector, GuardrailVerdict } from "./contracts";
import { pii } from "./detectors";
import { guard } from "./guard";

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

function textDeltas(events: StreamEvent[]): string[] {
  return events.flatMap((event) => (event.type === "agent.trip.streaming" ? [event.delta] : []));
}

function phoneModel(): MockModel {
  return new MockModel("mock", [
    {
      content: "call 555-123-4567 today",
      deltas: ["call 555-", "123-4567", " today"],
      reasoning: ["the number is 555-123-4567"],
      finishReason: "stop",
    },
  ]);
}

const lookup = tool({
  name: "lookup",
  description: "Look something up",
  execute: async () => ({ found: true }),
});

describe("output guardrails on a streaming run", () => {
  it("never streams text the output detectors redact", async () => {
    const stream = agent({
      model: phoneModel(),
      middleware: [guard({ output: [pii({ detect: ["phone"], mask: "[phone]" })] })],
    }).stream("What is the number?");

    const events = await drain(stream);
    const deltas = textDeltas(events);

    expect(deltas.join("")).not.toContain("4567");
    expect(deltas).toEqual(["call [phone] today"]);
    expect(events.some((event) => event.type === "agent.trip.reasoning")).toBe(false);
    expect((await stream.result).text).toBe("call [phone] today");
  });

  it("streams no text when an output detector blocks the trip", async () => {
    const stream = agent({
      model: phoneModel(),
      middleware: [guard({ output: [pii({ detect: ["phone"], onMatch: "block" })] })],
    }).stream("What is the number?");

    const events = await drain(stream);

    expect(textDeltas(events)).toEqual([]);
    expect((await stream.result).error?.code).toBe("GUARDRAIL_VIOLATION");
  });

  it('streams raw deltas with stream: "unguarded"', async () => {
    const stream = agent({
      model: phoneModel(),
      middleware: [guard({ output: [pii({ detect: ["phone"] })], stream: "unguarded" })],
    }).stream("What is the number?");

    const deltas = textDeltas(await drain(stream));

    expect(deltas).toEqual(["call 555-", "123-4567", " today"]);
  });

  it("keeps streaming deltas as they arrive when no output detector is set", async () => {
    const stream = agent({
      model: phoneModel(),
      middleware: [guard({ input: [pii({ onMatch: "block" })] })],
    }).stream("hello");

    const events = await drain(stream);

    expect(textDeltas(events)).toEqual(["call 555-", "123-4567", " today"]);
    expect(events.some((event) => event.type === "agent.trip.reasoning")).toBe(true);
  });

  it("holds streamed text for the outputCheck of guardrail()", async () => {
    const stream = agent({
      model: phoneModel(),
      middleware: [
        checkGuardrail({
          outputCheck: (text) =>
            text.includes("555") ? { ok: false, reason: "phone" } : { ok: true },
        }),
      ],
    }).stream("What is the number?");

    expect(textDeltas(await drain(stream))).toEqual([]);
  });
});

describe("input guardrails across trips", () => {
  function toolTripModel(): MockModel {
    return new MockModel("mock", [
      {
        content: "",
        toolCalls: [{ id: "call_1", name: "lookup", input: {} }],
        finishReason: "tool_calls",
      },
      {
        content: "",
        toolCalls: [{ id: "call_2", name: "lookup", input: {} }],
        finishReason: "tool_calls",
      },
      { content: "done", finishReason: "stop" },
    ]);
  }

  it("runs input detectors once for the same user text", async () => {
    const check = vi.fn((): GuardrailVerdict => ({ type: "allow" }));
    const counting: GuardrailDetector = { name: "counting", check };

    const result = await agent({
      model: toolTripModel(),
      tools: [lookup],
      middleware: [guard({ input: [counting] })],
    }).execute("find it");

    expect(result.error).toBeUndefined();
    expect(result.report.trips).toHaveLength(3);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("re-runs input detectors on the next trip after a detector fault", async () => {
    let calls = 0;
    const flaky: GuardrailDetector = {
      name: "flaky",
      check(): GuardrailVerdict {
        calls += 1;

        if (calls === 1) {
          throw new Error("moderation outage");
        }

        return { type: "allow" };
      },
    };

    await agent({
      model: toolTripModel(),
      tools: [lookup],
      middleware: [guard({ input: [flaky] })],
    }).execute("find it");

    expect(calls).toBe(2);
  });

  it("runs the inputCheck of guardrail() once for the same user text", async () => {
    const inputCheck = vi.fn(() => ({ ok: true as const }));

    await agent({
      model: toolTripModel(),
      tools: [lookup],
      middleware: [checkGuardrail({ inputCheck })],
    }).execute("find it");

    expect(inputCheck).toHaveBeenCalledTimes(1);
  });
});
