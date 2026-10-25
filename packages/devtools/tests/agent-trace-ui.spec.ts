import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUiRoot } from "../src/ui-root";

/** Minimal DOM for exercising the shipped UI's render functions without a browser. */
class Element {
  children: Element[] = [];
  textContent = "";
  attributes: Record<string, string> = {};
  value = "";
  className = "";
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
    if (key === "value") this.value = value;
  }
  addEventListener() {}
  append(...children: Element[]) {
    this.children.push(...children);
  }
  get text(): string {
    return [this.textContent, ...this.children.map((child) => child.text)].join(" ");
  }
  find(tag: string): Element[] {
    return [
      ...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child.find(tag)),
    ];
  }
}

function ui(routes: Record<string, unknown>) {
  const source = readFileSync(path.join(resolveUiRoot(), "app.js"), "utf8");
  const urls: string[] = [];
  const context = createContext({
    location: { pathname: "/__warlock/" },
    document: {
      querySelector: () => new Element("main"),
      querySelectorAll: () => [],
      createElement: (tag: string) => new Element(tag),
      createTextNode: (text: string) => Object.assign(new Element("text"), { textContent: text }),
    },
    fetch: async (url: string) => {
      urls.push(url);
      const key = url.replace(/^api\/ai\/agent-runs/, "") || "/";
      const body = routes[key];
      return body === undefined
        ? { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) }
        : { ok: true, status: 200, json: async () => body };
    },
  });
  runInContext(source.slice(0, source.lastIndexOf("\ntabs.forEach(")), context);
  return {
    urls,
    context,
    render: () => runInContext("agentsView()", context) as Promise<Element>,
    select: (runId: string) => runInContext(`state.selectedAgentRun = ${JSON.stringify(runId)}`, context),
  };
}

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
      [toolHash]: { name: "update_plan", description: "Change the plan.", schema: '{"type":"object"}' },
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
        contract: [{ type: "refusal-retry", tripIndex: 0, tool: "update_plan", reason: "not in library" }],
      },
    ],
    usage: { input: 10, output: 5, total: 15 },
  };
}

describe("Agents panel rendering", () => {
  it("renders install guidance and an empty state", async () => {
    expect(
      (await ui({ "/": { available: false, message: "Install @warlock.js/ai 5.38" } }).render()).text,
    ).toContain("Install @warlock.js/ai 5.38");
    expect((await ui({ "/": { available: true, runs: [] } }).render()).text).toContain(
      "No agent runs yet",
    );
  });

  it("lists runs with counts, usage and cost, without interpreting text as HTML", async () => {
    const view = await ui({ "/": { available: true, runs: [row("run_1")] } }).render();

    expect(view.text).toContain("coach · completed · 40 ms");
    expect(view.text).toContain("2 turns · 2 tool calls · 1 refused · 10 input · 5 output · $0.001230 USD");
    expect(view.text).toContain("mock/<img onerror=alert(1)>");
    expect(view.find("img")).toEqual([]);
    expect(view.find("input")[0]?.attributes["aria-label"]).toContain("HTTP request id");
  });

  it("requests the request-id filter from the server", async () => {
    const harness = ui({ "/": { available: true, runs: [] } });

    runInContext('state.agentRequestId = "req-1"', harness.context);
    const urls = harness.urls;

    await harness.render().catch(() => undefined);

    expect(urls[0]).toBe("api/ai/agent-runs?requestId=req-1");
  });

  it("shows the selected run's prompt, tools, turns, calls, refusals and contract actions", async () => {
    const harness = ui({
      "/": { available: true, runs: [row("run_2"), row("run_1")] },
      "/run_2": trace("run_2"),
      "/run_1": trace("run_1"),
    });

    harness.select("run_2");
    const view = await harness.render();

    expect(view.text).toContain("System prompt p1");
    expect(view.text).toContain("You are a coach.");
    expect(view.text).toContain("Tool update_plan@abcdef12");
    expect(view.text).toContain("turn 0 · tool_calls · 12 ms · 10 input · 5 output · $0.001000 USD");
    expect(view.text).toContain("Tools offered (~40 tokens): update_plan@abcdef12");
    expect(view.text).toContain("update_plan · failed · 3 ms · refused: Exercise not in library");
    expect(view.text).toContain("contract: refusal-retry update_plan (not in library)");
    expect(view.text).toContain("Same system prompt and tool definitions as run_1.");
  });

  it("flags a changed prompt and tool definitions against the previous run of the agent", async () => {
    const harness = ui({
      "/": { available: true, runs: [row("run_2"), row("run_1")] },
      "/run_2": trace("run_2", "p2", "ffffff000000"),
      "/run_1": trace("run_1", "p1", "abcdef123456"),
    });

    harness.select("run_2");
    const view = await harness.render();

    expect(view.text).toContain("Against run_1: system prompt changed");
    expect(view.text).toContain("tools changed: update_plan");
  });

  it("says when there is no earlier run to compare with and when text was not kept", async () => {
    const kept = trace("run_1");
    const harness = ui({
      "/": { available: true, runs: [row("run_1")] },
      "/run_1": { ...kept, systemPrompt: { hash: "p1" } },
    });

    harness.select("run_1");
    const view = await harness.render();

    expect(view.text).toContain("No earlier run of this agent to compare with.");
    expect(view.text).toContain("Text not kept (only the hash is recorded).");
  });
});
