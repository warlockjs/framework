import { MockModel } from "@warlock.js/ai";
import { describe, expect, it } from "vitest";
import { evaluateSystemPrompt } from "./evaluate-system-prompt";

// Exercises the REAL judgePromptBody (no mocking of our own glue) against a
// MockModel — the same building block ai's own criteria tests use
// (prompts-validate-criteria.spec.ts) — so this proves the actual
// integration, not just that we call a function.
describe("evaluateSystemPrompt", () => {
  const verdict = (score: number, reason: string) =>
    JSON.stringify({ score, passed: score >= 0.5, reason });

  it("grades with a literal model instance", async () => {
    const model = new MockModel("judge", [{ content: verdict(0.8, "clear and scoped") }]);

    const outcome = await evaluateSystemPrompt("You are a helpful support agent.", { model });

    expect(outcome.score).toBe(0.8);
    expect(outcome.issues).toEqual(["clear and scoped"]);
  });

  it("resolves a sync factory before grading", async () => {
    const model = new MockModel("judge", [{ content: verdict(0.6, "ok") }]);

    const outcome = await evaluateSystemPrompt("Prompt text", { model: () => model });

    expect(outcome.score).toBe(0.6);
  });

  it("resolves an async factory before grading", async () => {
    const model = new MockModel("judge", [{ content: verdict(0.6, "ok") }]);

    const outcome = await evaluateSystemPrompt("Prompt text", {
      model: async () => model,
    });

    expect(outcome.score).toBe(0.6);
  });

  it("a per-run instructions override wins over config.instructions", async () => {
    const model = new MockModel("judge", [{ content: verdict(0.7, "matches override rule") }]);

    await evaluateSystemPrompt("Prompt text", { model, instructions: "config rule" }, "override rule");

    const sent = model.callHistory
      .flatMap(call => call.messages)
      .map(message => JSON.stringify(message.content))
      .join("\n");
    expect(sent).toContain("override rule");
    expect(sent).not.toContain("config rule");
  });

  it("falls back to config.instructions when no override is given", async () => {
    const model = new MockModel("judge", [{ content: verdict(0.7, "matches config rule") }]);

    await evaluateSystemPrompt("Prompt text", { model, instructions: "config rule" });

    const sent = model.callHistory
      .flatMap(call => call.messages)
      .map(message => JSON.stringify(message.content))
      .join("\n");
    expect(sent).toContain("config rule");
  });

  it("a blank override is treated as absent, not a blank rubric", async () => {
    const model = new MockModel("judge", [{ content: verdict(0.7, "matches config rule") }]);

    await evaluateSystemPrompt("Prompt text", { model, instructions: "config rule" }, "   ");

    const sent = model.callHistory
      .flatMap(call => call.messages)
      .map(message => JSON.stringify(message.content))
      .join("\n");
    expect(sent).toContain("config rule");
  });
});
