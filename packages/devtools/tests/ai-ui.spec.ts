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

function ui(data: object, detail?: object) {
  const source = readFileSync(path.join(resolveUiRoot(), "app.js"), "utf8");
  // Leave startup/event wiring to integration checks; exercise the actual view
  // functions rather than duplicating their formatting in a test helper.
  const context = createContext({
    location: { pathname: "/__warlock/" },
    document: {
      querySelector: () => new Element("main"),
      querySelectorAll: () => [],
      createElement: (tag: string) => new Element(tag),
      createTextNode: (text: string) => Object.assign(new Element("text"), { textContent: text }),
    },
    fetch: async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes("/runs/") ? detail : data),
    }),
  });
  runInContext(source.slice(0, source.lastIndexOf("\ntabs.forEach(")), context);
  return { render: () => runInContext("aiView()", context) as Promise<Element>, context };
}

const run = {
  traceId: "run",
  requestId: "http-a",
  name: "assistant",
  status: "incomplete",
  incomplete: true,
  models: ["provider/<img onerror=alert(1)>"],
  duration: 100,
  usage: {
    input: 10,
    output: 5,
    total: 15,
    cachedTokens: 8,
    cacheWriteTokens: 2,
    inputIncludesCache: false,
  },
  cost: 0.12,
  toolCalls: 1,
  retries: 2,
  cacheHits: 1,
  truncatedTrips: 1,
  compactions: 1,
  skippedCompactions: 1,
  providerCompactions: 0,
};

describe("AI panel rendering", () => {
  it("renders install guidance and an observed-but-empty state", async () => {
    expect(
      (await ui({ available: false, message: "Install @warlock.js/ai-panoptic" }).render()).text,
    ).toContain("Install @warlock.js/ai-panoptic");
    expect((await ui({ available: true, runs: [] }).render()).text).toContain(
      "Enable Panoptic observation",
    );
  });

  it("shows usage, cost, cache semantics, retries, truncation and compaction without interpreting model text as HTML", async () => {
    const view = await ui({
      available: true,
      runs: [run],
      aggregate: { traces: 1, usage: run.usage },
    }).render();
    expect(view.text).toContain("10 input");
    expect(view.text).toContain("8 cache read");
    expect(view.text).toContain("$0.120000 USD");
    expect(view.text).toContain("input excludes cache tokens");
    expect(view.text).toContain("2 retries");
    expect(view.text).toContain("1 provider cache-hit trips");
    expect(view.text).toContain("Incomplete / truncated");
    expect(view.text).toContain("1 applied / 1 skipped compactions");
    expect(view.text).toContain("provider/<img onerror=alert(1)>");
    expect(view.find("img")).toEqual([]);
    expect(view.find("input")[0]?.attributes["aria-label"]).toContain("HTTP request id");
  });

  it("renders tool timing and retry/compaction metadata in the selected run tree", async () => {
    const root = {
      name: "assistant",
      type: "agent",
      status: "incomplete",
      startedAt: "2026-10-19T10:00:00.000Z",
      endedAt: "2026-10-19T10:00:00.100Z",
      duration: 100,
      usage: run.usage,
      attributes: {
        "agent.compactions": [{ type: "applied", tripIndex: 1 }],
        "retry.attempts": [{ duration: 25, status: "failed" }],
      },
      children: [
        {
          name: "search",
          type: "tool",
          status: "completed",
          startedAt: "2026-10-19T10:00:00.010Z",
          endedAt: "2026-10-19T10:00:00.050Z",
          duration: 40,
          usage: { input: 0, output: 0, total: 0 },
          children: [],
        },
      ],
    };
    const { render, context } = ui(
      { available: true, runs: [run], aggregate: { traces: 1, usage: run.usage } },
      { startedAt: root.startedAt, root },
    );
    runInContext('state.selectedAiRun = "run"', context);
    const view = await render();
    expect(view.text).toContain("tool search · completed · +10 ms · 40 ms");
    expect(view.text).toContain('"retry.attempts"');
    expect(view.text).toContain('"agent.compactions"');
    expect(view.text).toContain("Open HTTP request");
  });

  it("shows background/unpriced/unreported values and request-scoped runs", async () => {
    const data = {
      available: true,
      runs: [{ ...run, requestId: undefined, cost: undefined, cacheHits: undefined }],
      aggregate: { traces: 1, usage: run.usage },
    };
    const { render, context } = ui(data);
    const view = await render();
    expect(view.text).toContain("unpriced");
    expect(view.text).toContain("— provider cache-hit trips");
    expect(view.text).toContain("Background / no request id");
    const requestView = (await runInContext('requestAiView("http-a")', context)) as Element;
    expect(requestView.text).toContain("assistant");
  });
});
