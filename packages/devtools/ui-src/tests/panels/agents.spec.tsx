import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentsPanel } from "@/panels/agents";
import { failure, FakeEventSource, mockApi, renderPanel } from "./helpers";

const row = (runId: string, overrides: Record<string, unknown> = {}) => ({
  runId,
  agent: "coach",
  status: "completed",
  startedAt: "2026-10-25T10:00:00.000Z",
  durationMs: 40,
  model: "mock/<img onerror=alert(1)>",
  turns: 2,
  toolCalls: 2,
  refusals: 1,
  usage: { input: 10, output: 5 },
  cost: 0.00123,
  ...overrides,
});

function trace(runId: string, promptHash = "p1", toolHash = "abcdef123456") {
  return {
    runId,
    agent: "coach",
    status: "completed",
    input: "swap squats",
    systemPrompt: { hash: promptHash, text: "You are a coach." },
    toolSchemas: {
      [toolHash]: {
        name: "update_plan",
        description: "Change the plan.",
        schema: '{"type":"object"}',
      },
    },
    turns: [
      {
        index: 0,
        startedAt: "2026-10-25T10:00:00.000Z",
        durationMs: 12.4,
        input: "swap squats",
        finishReason: "tool_calls",
        systemPromptHash: promptHash,
        toolsHash: "t1",
        toolsOffered: [{ name: "update_plan", schemaHash: toolHash, tokens: 40 }],
        text: "Looking.",
        toolCalls: [
          {
            name: "update_plan",
            status: "failed",
            durationMs: 3,
            input: { id: "zercher" },
            refusal: "Exercise not in library",
            error: { type: "SchemaValidationError", message: "Exercise not in library" },
          },
        ],
        usage: { input: 10, output: 5, total: 15 },
        cost: 0.001,
        contract: [
          { type: "refusal-retry", tripIndex: 0, tool: "update_plan", reason: "not in library" },
        ],
      },
    ],
    usage: { input: 10, output: 5, total: 15 },
  };
}

beforeEach(() => FakeEventSource.install());

describe("Agents panel", () => {
  it("renders install guidance and an empty state", async () => {
    mockApi([
      ["api/ai/agent-runs", { available: false, message: "Install @warlock.js/ai 5.38", runs: [] }],
    ]);
    renderPanel(AgentsPanel);

    expect(await screen.findByText("Install @warlock.js/ai 5.38")).toBeInTheDocument();
  });

  it("renders the no-runs state", async () => {
    mockApi([["api/ai/agent-runs", { available: true, runs: [] }]]);
    renderPanel(AgentsPanel);

    expect(await screen.findByText(/No agent runs yet/)).toBeInTheDocument();
  });

  it("lists runs with counts, usage and cost, without interpreting text as HTML", async () => {
    mockApi([["api/ai/agent-runs", { available: true, runs: [row("run_1")] }]]);
    renderPanel(AgentsPanel);

    expect(await screen.findByText("coach · completed · 40 ms")).toBeInTheDocument();
    expect(
      screen.getByText("2 turns · 2 tool calls · 1 refused · 10 input · 5 output · $0.001230 USD"),
    ).toBeInTheDocument();
    expect(screen.getByText("mock/<img onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByLabelText(/Filter agent runs by HTTP request id/)).toBeInTheDocument();
  });

  it("requests the request-id filter from the server", async () => {
    const { calls } = mockApi([[/^api\/ai\/agent-runs/, { available: true, runs: [] }]]);
    const user = userEvent.setup();

    renderPanel(AgentsPanel);
    await screen.findByText(/No agent runs yet/);
    await user.type(screen.getByLabelText(/Filter agent runs by HTTP request id/), "req-1");
    await user.click(screen.getByRole("button", { name: "Filter / refresh" }));

    expect(calls.some((call) => call.url === "api/ai/agent-runs?requestId=req-1")).toBe(true);
  });

  it("shows the selected run's prompt, tools, turns, calls, refusals and contract actions", async () => {
    mockApi([
      ["api/ai/agent-runs", { available: true, runs: [row("run_2"), row("run_1")] }],
      ["api/ai/agent-runs/run_2", trace("run_2")],
      ["api/ai/agent-runs/run_1", trace("run_1")],
    ]);
    renderPanel(AgentsPanel, { route: "run_2" });

    expect(await screen.findByText("System prompt p1")).toBeInTheDocument();
    expect(screen.getByText("You are a coach.")).toBeInTheDocument();
    expect(screen.getByText("Tool update_plan@abcdef12")).toBeInTheDocument();
    expect(
      screen.getByText("turn 0 · tool_calls · 12 ms · 10 input · 5 output · $0.001000 USD"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tools offered (~40 tokens): update_plan@abcdef12"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "update_plan · failed · 3 ms · refused: Exercise not in library · error: Exercise not in library",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("contract: refusal-retry update_plan (not in library)"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Same system prompt and tool definitions as run_1."),
    ).toBeInTheDocument();
  });

  it("flags a changed prompt and tool definitions against the previous run of the agent", async () => {
    mockApi([
      ["api/ai/agent-runs", { available: true, runs: [row("run_2"), row("run_1")] }],
      ["api/ai/agent-runs/run_2", trace("run_2", "p2", "ffffff000000")],
      ["api/ai/agent-runs/run_1", trace("run_1", "p1", "abcdef123456")],
    ]);
    renderPanel(AgentsPanel, { route: "run_2" });

    expect(await screen.findByText(/Against run_1: system prompt changed/)).toBeInTheDocument();
    expect(screen.getByText(/tools changed: update_plan/)).toBeInTheDocument();
  });

  it("says when there is no earlier run to compare with and when text was not kept", async () => {
    mockApi([
      ["api/ai/agent-runs", { available: true, runs: [row("run_1")] }],
      ["api/ai/agent-runs/run_1", { ...trace("run_1"), systemPrompt: { hash: "p1" } }],
    ]);
    const user = userEvent.setup();

    renderPanel(AgentsPanel, { route: "run_1" });

    expect(
      await screen.findByText("No earlier run of this agent to compare with."),
    ).toBeInTheDocument();
    await user.click(screen.getByText("System prompt p1"));
    expect(screen.getByText("Text not kept (only the hash is recorded).")).toBeInTheDocument();
  });

  it("shows API errors with message and ref", async () => {
    mockApi([
      ["api/ai/agent-runs", failure(500, "Agent runs could not be read. Reload.", { ref: "ag-1" })],
    ]);
    renderPanel(AgentsPanel);

    expect(await screen.findByText("Agent runs could not be read. Reload.")).toBeInTheDocument();
    expect(screen.getByText("Reference: ag-1")).toBeInTheDocument();
  });

  it("selecting a run navigates to it", async () => {
    mockApi([
      ["api/ai/agent-runs", { available: true, runs: [row("run_1")] }],
      ["api/ai/agent-runs/run_1", trace("run_1")],
    ]);
    const user = userEvent.setup();
    const { navigations } = renderPanel(AgentsPanel);

    await user.click(await screen.findByText("coach · completed · 40 ms"));

    expect(navigations).toEqual(["run_1"]);
  });
});
