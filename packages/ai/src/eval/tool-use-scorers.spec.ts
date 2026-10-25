import { describe, expect, it } from "vitest";
import type { EvalScorerContext } from "../contracts/agent/eval.type";
import { changeClaimedWithoutToolCall, requiredToolCalled } from "./tool-use-scorers";
import { evalScorers } from "./index";

function context(
  input: string,
  text: string,
  calls: Array<{ name: string; status?: string }> = [],
): EvalScorerContext {
  return {
    case: { name: "case", input },
    text,
    result: {
      report: {
        children: calls.map((call) => ({ status: "completed", ...call })),
      },
    },
  } as unknown as EvalScorerContext;
}

describe("requiredToolCalled()", () => {
  const scorer = requiredToolCalled({ tools: ["update_plan"] });

  it("fails when the required tool was not called", async () => {
    const score = await scorer(context("swap squats", "Want me to swap?"));

    expect(score).toMatchObject({ score: 0, passed: false });
    expect(score.reason).toContain("required tool not called");
    expect(score.reason).toContain("update_plan");
  });

  it("passes when a required tool was called", async () => {
    expect(await scorer(context("swap squats", "Done.", [{ name: "update_plan" }]))).toMatchObject({
      score: 1,
      passed: true,
    });
  });

  it("does not count a failed call", async () => {
    const score = await scorer(
      context("swap squats", "Done.", [{ name: "update_plan", status: "failed" }]),
    );

    expect(score.passed).toBe(false);
  });

  it("skips cases that are not action requests when intents are given", async () => {
    const withIntents = requiredToolCalled({ tools: ["update_plan"], intents: [/\bswap\b/i] });

    expect(await withIntents(context("what is a squat?", "A leg exercise."))).toMatchObject({
      passed: true,
      reason: expect.stringContaining("not an action request"),
    });
    expect((await withIntents(context("swap squats", "Sure."))).passed).toBe(false);
  });

  it("supports require: all", async () => {
    const both = requiredToolCalled({ tools: ["a", "b"], require: "all" });

    expect((await both(context("x", "", [{ name: "a" }]))).passed).toBe(false);
    expect((await both(context("x", "", [{ name: "a" }, { name: "b" }]))).passed).toBe(true);
  });
});

describe("changeClaimedWithoutToolCall()", () => {
  const scorer = changeClaimedWithoutToolCall({ tools: ["update_plan"] });

  it("fails when the reply claims a change and no tool made it", async () => {
    const score = await scorer(context("swap squats", "I've swapped squats for lunges."));

    expect(score).toMatchObject({ score: 0, passed: false });
    expect(score.reason).toBe("change claimed without a tool call");
  });

  it("passes when the claim is backed by a completed change tool", async () => {
    const score = await scorer(
      context("swap squats", "I've swapped squats for lunges.", [{ name: "update_plan" }]),
    );

    expect(score.passed).toBe(true);
  });

  it("does not accept a failed call or an unrelated tool as backing", async () => {
    expect(
      (
        await scorer(
          context("x", "I updated your plan.", [{ name: "update_plan", status: "failed" }]),
        )
      ).passed,
    ).toBe(false);
    expect((await scorer(context("x", "I updated your plan.", [{ name: "search" }]))).passed).toBe(
      false,
    );
  });

  it("passes when nothing is claimed", async () => {
    expect((await scorer(context("x", "I can swap that if you like."))).passed).toBe(true);
    expect((await scorer(context("x", "Squats train your legs."))).passed).toBe(true);
  });

  it("accepts any completed tool when no tools are named", async () => {
    const any = changeClaimedWithoutToolCall();

    expect((await any(context("x", "I removed it.", [{ name: "whatever" }]))).passed).toBe(true);
    expect((await any(context("x", "I removed it."))).passed).toBe(false);
  });

  it("takes custom claim patterns", async () => {
    const custom = changeClaimedWithoutToolCall({ claims: [/\ball set\b/i] });

    expect((await custom(context("x", "All set!"))).passed).toBe(false);
    expect((await custom(context("x", "I updated it."))).passed).toBe(true);
  });
});

describe("ai.eval namespace", () => {
  it("exposes both scorers", () => {
    expect(evalScorers.requiredToolCalled).toBe(requiredToolCalled);
    expect(evalScorers.changeClaimedWithoutToolCall).toBe(changeClaimedWithoutToolCall);
  });
});
