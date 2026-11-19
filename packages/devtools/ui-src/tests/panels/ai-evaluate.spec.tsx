import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AiEvaluatePanel } from "@/panels/ai-evaluate";
import { unavailable } from "./ai-fixtures";
import { failure, mockApi, renderPanel } from "./helpers";

const view = (overrides: Record<string, unknown> = {}) => ({
  available: true,
  configured: true,
  judge: "openai/gpt-4o-mini",
  instructions: "Must be clear.",
  prompts: [
    {
      hash: "h1",
      agents: ["support"],
      runId: "run-1",
      lastSeenAt: "2026-11-12T10:00:00.000Z",
      preview: "You are a <i>support</i> agent.",
      length: 900,
    },
  ],
  ...overrides,
});

describe("AI Evaluate", () => {
  it("lists recent prompts as text and runs the evaluation of the selected one", async () => {
    const { calls } = mockApi([
      ["api/ai/evaluate", view()],
      [
        "api/ai/evaluate",
        {
          score: 0.82,
          issues: ["Too vague about refunds."],
          judge: "openai/gpt-4o-mini",
          durationMs: 2500,
        },
        "POST",
      ],
    ]);

    renderPanel(AiEvaluatePanel);

    expect(
      await screen.findByText("You are a <i>support</i> agent.", { selector: "p" }),
    ).toBeInTheDocument();
    expect(document.querySelector("i")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Run evaluation/ }));

    const result = await screen.findByRole("region", { name: "Evaluation result" });

    expect(within(result).getByText("82%")).toBeInTheDocument();
    expect(within(result).getByRole("meter", { name: "Score" })).toHaveAttribute(
      "aria-valuenow",
      "82",
    );
    expect(within(result).getByText("Too vague about refunds.")).toBeInTheDocument();
    expect(within(result).getByText("Judged by openai/gpt-4o-mini in 2.5 s")).toBeInTheDocument();
    // The configured instructions are not resent.
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ runId: "run-1" });
  });

  it("sends a pasted prompt and edited instructions", async () => {
    const { calls } = mockApi([
      ["api/ai/evaluate", view({ prompts: [] })],
      ["api/ai/evaluate", { score: null, issues: [], judge: "j", durationMs: 100 }, "POST"],
    ]);

    renderPanel(AiEvaluatePanel);
    await userEvent.type(await screen.findByLabelText("System prompt to grade"), "Be brief.");
    await userEvent.type(screen.getByLabelText(/Grading instructions/), " Cite sources.");
    await userEvent.click(screen.getByRole("button", { name: /Run evaluation/ }));

    expect(await screen.findByText(/The judge returned no score/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      systemPrompt: "Be brief.",
      instructions: "Must be clear. Cite sources.",
    });
  });

  it("asks for a prompt before calling the server", async () => {
    const { calls } = mockApi([["api/ai/evaluate", view({ prompts: [] })]]);

    renderPanel(AiEvaluatePanel);
    await userEvent.click(await screen.findByRole("button", { name: /Run evaluation/ }));

    expect(screen.getByText(/Pick a recent prompt or paste one/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it.each([
    [
      "The judge could not be reached. Check its API key and run again.",
      "ai.evaluate-failed",
      "ev-1",
    ],
    [
      "Evaluate is not set up. Add panoptic.evaluate to the AI config.",
      "ai.evaluate-unavailable",
      undefined,
    ],
    ["That prompt is no longer stored. Pick another prompt.", "ai.prompt-not-found", undefined],
  ])("shows the error %s inside the card", async (message, code, ref) => {
    mockApi([
      ["api/ai/evaluate", view()],
      [
        "api/ai/evaluate",
        { __status: 502, body: { error: message, code, ...(ref ? { ref } : {}) } },
        "POST",
      ],
    ]);

    renderPanel(AiEvaluatePanel);
    await userEvent.click(await screen.findByRole("button", { name: /Run evaluation/ }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText("The evaluation failed")).toBeInTheDocument();

    if (ref) expect(screen.getByText(`Reference: ${ref}`)).toBeInTheDocument();

    // The prompt and instructions stay in place so the user can run again.
    expect(screen.getByRole("button", { name: /Run evaluation/ })).toBeEnabled();
  });

  it("shows the setup card when no judge is configured", async () => {
    mockApi([["api/ai/evaluate", view({ configured: false, judge: null, prompts: [] })]]);
    renderPanel(AiEvaluatePanel);

    expect(await screen.findByText("Set up a judge model")).toBeInTheDocument();
    expect(screen.getByText(/panoptic: \{/)).toBeInTheDocument();
    // `model()` takes a config object (`openai.model({ name })`), never a bare model name.
    expect(screen.getByText(/openai\.model\(\{ name: "gpt-4o-mini" \}\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run evaluation/ })).toBeNull();
  });

  it.each([
    ["not-collected", "Production keeps hourly AI totals, not run details."],
    ["panoptic-missing", "Panoptic isn't installed"],
  ])("explains the %s state", async (reason, title) => {
    mockApi([["api/ai/evaluate", unavailable(reason, title, "Do this next.")]]);
    renderPanel(AiEvaluatePanel);

    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it("shows a load error with its reference", async () => {
    mockApi([
      ["api/ai/evaluate", failure(500, "The evaluator could not be read. Reload.", { ref: "x-1" })],
    ]);
    renderPanel(AiEvaluatePanel);

    expect(await screen.findByText("Could not load the evaluator")).toBeInTheDocument();
    expect(screen.getByText("Reference: x-1")).toBeInTheDocument();
  });
});
