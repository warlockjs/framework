import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import { MockModel } from "../mock/mock-model";
import type { MockModelResponse } from "../mock/mock-config.type";
import { tool } from "../tool/tool";
import { agent } from "./agent";
import type { AgentBackstop } from "./tool-use-contract";
import {
  defaultActHint,
  matchesIntent,
  refusalReason,
  requiredToolsCalled,
  resolveRefusalConfig,
} from "./tool-use-contract";
import { SchemaValidationError } from "../errors";
import type { ToolCall } from "../contracts/result/tool-call.type";

const stringSchema: StandardSchemaV1<string> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) =>
      typeof value === "string" ? { value } : { issues: [{ message: "expected string" }] },
  },
};

function updatePlan(execute: (input: string) => Promise<unknown> = async () => "updated") {
  return tool({
    name: "update_plan",
    description: "Change the plan.",
    input: stringSchema,
    execute,
  });
}

const call = (name: string, input: unknown, id = "c1") => ({ id, name, input });

function build(responses: MockModelResponse[]) {
  return new MockModel("contract-model", responses);
}

function userMessages(model: MockModel, callIndex: number): string[] {
  return (model.callHistory[callIndex]?.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => String(message.content));
}

describe("tool-use contract helpers", () => {
  it("matches intents by substring, regular expression or predicate", () => {
    expect(matchesIntent("Please SWAP my squat", ["swap"])).toBe(true);
    expect(matchesIntent("replace it", [/\b(swap|replace)\b/i])).toBe(true);
    expect(matchesIntent("anything", [(input) => input.length === 8])).toBe(true);
    expect(matchesIntent("hello", ["swap", /\bchange\b/])).toBe(false);
    expect(
      matchesIntent("x", [
        () => {
          throw new Error("boom");
        },
      ]),
    ).toBe(false);
  });

  it("does not leak lastIndex state between global regular expressions", () => {
    const intent = /swap/g;

    expect(matchesIntent("swap it", [intent])).toBe(true);
    expect(matchesIntent("swap it", [intent])).toBe(true);
  });

  it("checks required tools with any/all and ignores failed calls", () => {
    const calls = [
      { name: "a", status: "completed" },
      { name: "b", status: "failed" },
    ] as ToolCall[];

    expect(requiredToolsCalled(calls, ["a", "b"])).toBe(true);
    expect(requiredToolsCalled(calls, ["b"])).toBe(false);
    expect(requiredToolsCalled(calls, ["a", "b"], "all")).toBe(false);
    expect(requiredToolsCalled(calls, ["a"], "all")).toBe(true);
  });

  it("reads a refusal from a validation error or a refusing result", () => {
    const validation = new SchemaValidationError("Validation failed: bad id", {});

    expect(refusalReason({ error: validation } as ToolCall)).toBe("Validation failed: bad id");
    expect(refusalReason({ output: { ok: false, reason: "not in library" } } as ToolCall)).toBe(
      "not in library",
    );
    expect(refusalReason({ output: { refused: true, message: "nope" } } as ToolCall)).toBe("nope");
    expect(refusalReason({ output: { ok: true } } as ToolCall)).toBeUndefined();
    expect(refusalReason({ output: { ok: false } } as ToolCall)).toBeUndefined();
    expect(refusalReason({ output: "x" } as ToolCall, () => "custom")).toBe("custom");
    expect(refusalReason({ output: "x" } as ToolCall, () => false)).toBeUndefined();
  });

  it("normalizes onToolRefusal", () => {
    expect(resolveRefusalConfig(undefined)).toBeUndefined();
    expect(resolveRefusalConfig("off")).toBeUndefined();
    expect(resolveRefusalConfig("retry-once-with-hint")).toEqual({ retries: 1 });
    expect(resolveRefusalConfig({ retries: 0 })).toBeUndefined();
    expect(resolveRefusalConfig({ retries: 3 })?.retries).toBe(3);
    expect(resolveRefusalConfig({})?.retries).toBe(1);
  });
});

describe("agent({ actWhenAsked })", () => {
  const actWhenAsked = { intents: [/\b(swap|replace)\b/i], requiredTools: ["update_plan"] };

  it("re-prompts once when an action request is answered without the required tool", async () => {
    const execute = vi.fn(async () => "updated");
    const model = build([
      { content: "I can swap that for you if you like." },
      { content: "", toolCalls: [call("update_plan", "lunges")] },
      { content: "Swapped squats for lunges." },
    ]);

    const result = await agent({ model, tools: [updatePlan(execute)], actWhenAsked }).execute(
      "Swap squats for lunges",
    );

    expect(model.callCount).toBe(3);
    expect(execute).toHaveBeenCalledOnce();
    expect(result.text).toBe("Swapped squats for lunges.");
    expect(userMessages(model, 2).at(-1)).toBe(defaultActHint(["update_plan"]));
    expect(result.error).toBeUndefined();
  });

  it("keeps the offer in the history ahead of the hint", async () => {
    const model = build([{ content: "Want me to swap it?" }, { content: "Done." }]);

    await agent({ model, tools: [updatePlan()], actWhenAsked }).execute("swap squats");

    const messages = model.callHistory[1]!.messages;
    const offer = messages.findIndex(
      (m) => m.role === "assistant" && m.content === "Want me to swap it?",
    );
    const hint = messages.findIndex(
      (m) => m.role === "user" && m.content === defaultActHint(["update_plan"]),
    );

    expect(offer).toBeGreaterThan(-1);
    expect(hint).toBe(offer + 1);
  });

  it("does nothing for a turn that is not an action request", async () => {
    const model = build([{ content: "Squats work your legs." }]);

    await agent({ model, tools: [updatePlan()], actWhenAsked }).execute("what do squats train?");

    expect(model.callCount).toBe(1);
  });

  it("does nothing when the required tool was called", async () => {
    const model = build([
      { content: "", toolCalls: [call("update_plan", "lunges")] },
      { content: "Done." },
    ]);

    await agent({ model, tools: [updatePlan()], actWhenAsked }).execute("swap squats");

    expect(model.callCount).toBe(2);
  });

  it("re-prompts at most maxReprompts times", async () => {
    const model = build([{ content: "I could do that." }]);

    const result = await agent({
      model,
      tools: [updatePlan()],
      actWhenAsked: { ...actWhenAsked, maxReprompts: 2 },
    }).execute("swap squats");

    expect(model.callCount).toBe(3);
    expect(result.error).toBeUndefined();

    const single = build([{ content: "I could do that." }]);
    await agent({ model: single, tools: [updatePlan()], actWhenAsked }).execute("swap squats");
    expect(single.callCount).toBe(2);
  });

  it("uses a custom hint, string or builder", async () => {
    const stringHint = build([{ content: "Maybe." }, { content: "ok" }]);
    await agent({
      model: stringHint,
      tools: [updatePlan()],
      actWhenAsked: { ...actWhenAsked, hint: "Call update_plan now." },
    }).execute("swap squats");
    expect(userMessages(stringHint, 1).at(-1)).toBe("Call update_plan now.");

    const builderHint = build([{ content: "Maybe." }, { content: "ok" }]);
    await agent({
      model: builderHint,
      tools: [updatePlan()],
      actWhenAsked: {
        ...actWhenAsked,
        hint: ({ reply, requiredTools }) => `You said "${reply}"; call ${requiredTools[0]}.`,
      },
    }).execute("swap squats");
    expect(userMessages(builderHint, 1).at(-1)).toBe('You said "Maybe."; call update_plan.');
  });

  it("falls back to the default hint when the builder throws", async () => {
    const model = build([{ content: "Maybe." }, { content: "ok" }]);

    await agent({
      model,
      tools: [updatePlan()],
      actWhenAsked: {
        ...actWhenAsked,
        hint: () => {
          throw new Error("boom");
        },
      },
    }).execute("swap squats");

    expect(userMessages(model, 1).at(-1)).toBe(defaultActHint(["update_plan"]));
  });

  it("does not re-prompt when no trip is left", async () => {
    const model = build([{ content: "I could do that." }]);

    await agent({ model, tools: [updatePlan()], actWhenAsked, maxTrips: 1 }).execute("swap squats");

    expect(model.callCount).toBe(1);
  });

  it("changes nothing without the option", async () => {
    const model = build([{ content: "I could do that." }]);

    const result = await agent({ model, tools: [updatePlan()] }).execute("swap squats");

    expect(model.callCount).toBe(1);
    expect(result.text).toBe("I could do that.");
  });
});

describe("agent({ onToolRefusal })", () => {
  const refusal = { content: "", toolCalls: [call("update_plan", 42)] };
  const valid = { content: "", toolCalls: [call("update_plan", "lunges", "c2")] };

  it("retries once with the refusal reason when the model gives up", async () => {
    const execute = vi.fn(async () => "updated");
    const model = build([
      refusal,
      { content: "Sorry, I cannot do that." },
      valid,
      { content: "Done." },
    ]);

    const result = await agent({
      model,
      tools: [updatePlan(execute)],
      onToolRefusal: "retry-once-with-hint",
    }).execute("hello");

    expect(model.callCount).toBe(4);
    expect(execute).toHaveBeenCalledOnce();
    expect(result.text).toBe("Done.");

    const hint = userMessages(model, 2).at(-1) ?? "";

    expect(hint).toContain('"update_plan" refused');
    expect(hint).toContain("expected string");
  });

  it("does nothing by default: the model's give-up answer ends the run", async () => {
    const model = build([refusal, { content: "Sorry, I cannot do that." }]);

    const result = await agent({ model, tools: [updatePlan()] }).execute("hello");

    expect(model.callCount).toBe(2);
    expect(result.text).toBe("Sorry, I cannot do that.");
  });

  it("retries only once", async () => {
    const model = build([refusal, { content: "No." }]);

    await agent({ model, tools: [updatePlan()], onToolRefusal: "retry-once-with-hint" }).execute(
      "hello",
    );

    // refusal, give-up, one retry prompt answered by the same give-up.
    expect(model.callCount).toBe(3);
  });

  it("does not retry when the model already corrected itself", async () => {
    const model = build([refusal, valid, { content: "Done." }]);

    await agent({ model, tools: [updatePlan()], onToolRefusal: "retry-once-with-hint" }).execute(
      "hello",
    );

    expect(model.callCount).toBe(3);
  });

  it("treats a refusing result as a refusal and uses a custom hint", async () => {
    const refusing = tool({
      name: "update_plan",
      description: "Change the plan.",
      input: stringSchema,
      execute: async () => ({ ok: false, reason: "Exercise not in the library" }),
    });
    const model = build([
      { content: "", toolCalls: [call("update_plan", "zercher")] },
      { content: "That is not available." },
      { content: "Picked a library exercise." },
    ]);

    await agent({
      model,
      tools: [refusing],
      onToolRefusal: { hint: ({ tool: name, reason }) => `${name}: ${reason}. Pick another.` },
    }).execute("add zercher");

    expect(userMessages(model, 2).at(-1)).toBe(
      "update_plan: Exercise not in the library. Pick another.",
    );
  });

  it("supports a custom refusal rule and several retries", async () => {
    const model = build([
      { content: "", toolCalls: [call("update_plan", "x")] },
      { content: "No." },
    ]);

    await agent({
      model,
      tools: [updatePlan(async () => "locked")],
      onToolRefusal: {
        retries: 2,
        isRefusal: (c) => (c.output === "locked" ? "plan is locked" : false),
      },
    }).execute("hello");

    // call, give-up, retry 1, give-up (the refusal list was cleared by retry 1).
    expect(model.callCount).toBe(3);
    expect(userMessages(model, 2).at(-1)).toContain("plan is locked");
  });
});

describe("agent({ backstops })", () => {
  it("runs a before backstop once and adds its prompt ahead of the first call", async () => {
    const run = vi.fn(async () => ({ prompt: "Note: the user reported pain." }));
    const backstop: AgentBackstop = {
      name: "pain",
      phase: "before",
      detect: (turn) => /\bpain\b/i.test(turn.input),
      run,
    };
    const model = build([{ content: "Take it easy." }]);

    await agent({ model, backstops: [backstop] }).execute("my knee has pain");

    expect(run).toHaveBeenCalledOnce();
    expect(model.callCount).toBe(1);
    expect(userMessages(model, 0)).toContain("Note: the user reported pain.");
  });

  it("runs an after backstop on the final answer and re-prompts with its prompt", async () => {
    const run = vi.fn(async () => ({ prompt: "Mention the safety line." }));
    const detect = vi.fn((turn: { reply?: string }) => !(turn.reply ?? "").includes("safety"));
    const model = build([
      { content: "Do three sets." },
      { content: "Do three sets. Safety first." },
    ]);

    const result = await agent({
      model,
      backstops: [{ name: "safety", detect, run }],
    }).execute("plan my week");

    expect(model.callCount).toBe(2);
    expect(run).toHaveBeenCalledOnce();
    expect(userMessages(model, 1).at(-1)).toBe("Mention the safety line.");
    expect(result.text).toBe("Do three sets. Safety first.");
  });

  it("runs the side effect once per run even when the answer is asked again", async () => {
    const run = vi.fn(async () => ({ prompt: "Again." }));
    const model = build([{ content: "A" }]);

    await agent({ model, backstops: [{ detect: () => true, run }] }).execute("go");

    expect(run).toHaveBeenCalledOnce();
    expect(model.callCount).toBe(2);
  });

  it("passes the turn: input, reply, tool calls and shared state", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const model = build([
      { content: "", toolCalls: [call("update_plan", "x")] },
      { content: "Final." },
    ]);

    await agent({
      name: "coach",
      model,
      tools: [updatePlan()],
      backstops: [
        {
          detect: (turn) => turn.phase === "after",
          run: (context) => {
            context.state.seen = true;
            seen.push({
              agent: context.agent,
              input: context.input,
              reply: context.reply,
              tools: context.toolCalls.map((c) => c.name),
              state: context.state,
            });
          },
        },
      ],
    }).execute("go");

    expect(seen).toEqual([
      {
        agent: "coach",
        input: "go",
        reply: "Final.",
        tools: ["update_plan"],
        state: { seen: true },
      },
    ]);
    expect(model.callCount).toBe(2);
  });

  it("skips a backstop that throws and keeps the run going", async () => {
    const model = build([{ content: "Fine." }]);

    const result = await agent({
      model,
      backstops: [
        {
          detect: () => {
            throw new Error("detector broke");
          },
          run: () => undefined,
        },
        {
          detect: () => true,
          run: () => {
            throw new Error("runner broke");
          },
        },
      ],
    }).execute("go");

    expect(result.error).toBeUndefined();
    expect(result.text).toBe("Fine.");
    expect(model.callCount).toBe(1);
  });

  it("does nothing when no backstop fires", async () => {
    const model = build([{ content: "Fine." }]);

    await agent({ model, backstops: [{ detect: () => false, run: () => undefined }] }).execute(
      "go",
    );

    expect(model.callCount).toBe(1);
  });
});
