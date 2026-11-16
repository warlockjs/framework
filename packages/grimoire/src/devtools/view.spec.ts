import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fakePanelContext, type FakeNode } from "../../tests/support/fake-dom";

const viewPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "ui",
  "grimoire-view.js",
);

async function renderView(answers: Record<string, unknown>, route = "") {
  const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
  const panel = fakePanelContext(answers, route);
  const view = (await render(panel.context)) as FakeNode;

  return { ...panel, view };
}

const counts = { errors: 1, warnings: 2, expected: 0 };

const emptySummary = {
  routes: "missing",
  features: { schemaVersion: 1, features: [] },
  tasks: { schemaVersion: 1, open: [], waiting: [], done: [] },
  counts: { errors: 0, warnings: 0, expected: 0 },
  written: false,
  book: { files: 12, modules: 3, builtAt: "2026-11-16T10:00:00.000Z" },
};

const location = { file: "grimoire/x.md", line: 3, column: null };
const located = <Value>(value: Value) => ({ value, at: location });

const flowAnswer = {
  type: "flow",
  routes: "cached",
  notes: [],
  flow: {
    id: located("new-arrivals"),
    since: located("2.0"),
    status: located("shipped"),
    who: located("everyone"),
    heading: located("New arrivals"),
    cases: [
      {
        question: "not found",
        fixed: true,
        answer: "the global list",
        doesNotApply: false,
        at: location,
      },
    ],
    unknowns: [{ text: "is the limit 20 or 25?", at: location }],
  },
  bookmap: {
    steps: [
      {
        index: 1,
        kind: "page",
        target: "/",
        found: true,
        entry: "src/pages/home.page.tsx",
        files: ["src/pages/home.page.tsx"],
      },
      {
        index: 2,
        kind: "route",
        target: "GET /api/products/new-arrivals",
        found: true,
        entry: null,
        files: ["src/a.ts", "src/b.ts"],
      },
    ],
    criteria: [
      {
        id: "AC-1",
        app: null,
        text: "the newest products come first",
        status: "passing",
        tests: [
          {
            file: "e2e/new.spec.ts",
            line: 12,
            name: "orders products",
            result: "pass",
            stale: false,
          },
        ],
      },
      {
        id: "AC-2",
        app: "mobile",
        text: "the device country is used",
        status: "untested",
        tests: [],
      },
    ],
    shownBy: [
      {
        app: "web-client",
        type: "page",
        id: "home",
        block: "New arrivals",
        file: "grimoire/apps/web-client/pages/home/README.md",
      },
    ],
  },
  history: [
    {
      feature: "catalog",
      version: located("2.1"),
      word: "fixed",
      flow: "new-arrivals",
      criteria: ["AC-2"],
      text: "country fallback",
      release: "5.2.0",
      date: "2026-10-01",
      at: location,
    },
  ],
  findings: [],
};

describe("grimoire view: search", () => {
  it("shows ranked hits as hash links and sets every string as text", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { view, calls } = await renderView({
      summary: emptySummary,
      "search?q=new&limit=15": {
        type: "search",
        text: "new",
        routes: "cached",
        notes: [],
        hits: [
          { type: "flow", id: "catalog/new-arrivals", detail: "New arrivals", score: 9 },
          { type: "route", id: "GET /api/products/new-arrivals", detail: null, score: 8 },
          { type: "file", id: "src/new.ts", detail: hostile, score: 5 },
          { type: "task", id: "T-014", detail: null, score: 4 },
          { type: "block", id: "web-client/home/new-arrivals", detail: null, score: 3 },
        ],
      },
    });
    const input = view.find("input")[0] as FakeNode;

    input.fire("input", { target: { value: "new" } });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(calls).toContain("search?q=new&limit=15");

    const results = view.findAll(
      (node) => node.attributes.class === "grimoire-results",
    )[0] as FakeNode;

    expect(results.links).toEqual([
      "#grimoire/flow/catalog/new-arrivals",
      "#grimoire/route/GET/%2Fapi%2Fproducts%2Fnew-arrivals",
      "#grimoire/file/src%2Fnew.ts",
      "#grimoire/task/T-014",
      "#grimoire/page/web-client/home",
    ]);
    expect(results.text).toContain(hostile);
    expect(view.find("img")).toHaveLength(0);
  });

  it("says when nothing matches and when the search fails", async () => {
    const { view } = await renderView({
      summary: emptySummary,
      "search?q=zzz&limit=15": {
        type: "search",
        text: "zzz",
        routes: "cached",
        notes: [],
        hits: [],
      },
    });
    const input = view.find("input")[0] as FakeNode;
    const results = view.findAll(
      (node) => node.attributes.class === "grimoire-results",
    )[0] as FakeNode;

    input.fire("input", { target: { value: "zzz" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(results.text).toContain('Nothing matches "zzz".');

    input.fire("input", { target: { value: "boom" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(results.text).toContain("Search failed: no answer for search?q=boom&limit=15");
  });
});

describe("grimoire view: flow", () => {
  it("shows steps, criteria with results, where it is shown and the history", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const text = view.text;

    expect(text).toContain("New arrivals (catalog/new-arrivals)");
    expect(text).toContain("GET /api/products/new-arrivals");
    expect(text).toContain("the newest products come first");
    expect(text).toContain("passing");
    expect(text).toContain("untested");
    expect(text).toContain("orders products");
    expect(text).toContain("as block New arrivals");
    expect(text).toContain("country fallback");
    expect(text).toContain("release 5.2.0, 2026-10-01");
    expect(text).toContain("is the limit 20 or 25?");
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/feature/catalog",
        "#grimoire/route/GET/%2Fapi%2Fproducts%2Fnew-arrivals",
        "#grimoire/file/e2e%2Fnew.spec.ts",
        "#grimoire/page/web-client/home",
        "#grimoire/flow/catalog/new-arrivals",
      ]),
    );
  });

  it("shows a missing flow in place instead of failing the tab", async () => {
    const { view } = await renderView({}, "flow/catalog/nope");

    expect(view.find("p").map((node) => node.text)).toContain(
      "Could not load this view: no answer for flows/catalog/nope",
    );
    // The search box and navigation stay.
    expect(view.find("input")).toHaveLength(1);
  });
});

describe("grimoire view: no features written (book only)", () => {
  it("explains the empty state and keeps search and the module graph reachable", async () => {
    const { view } = await renderView({ summary: emptySummary });

    expect(view.text).toContain("No features are written yet.");
    expect(view.text).toContain("12 files");
    expect(view.links).toEqual(
      expect.arrayContaining(["#grimoire/modules", "#grimoire/check", "#grimoire/tasks"]),
    );
    expect(view.find("input")).toHaveLength(1);
  });

  it("says when the book itself is empty", async () => {
    const { view } = await renderView({
      summary: { ...emptySummary, book: { files: 0, modules: 0, builtAt: "" } },
    });

    expect(view.text).toContain("The book is empty. Run warlock grimoire build.");
  });

  it("lists features when there are some, with the check counts", async () => {
    const { view } = await renderView({
      summary: {
        ...emptySummary,
        counts,
        tasks: {
          schemaVersion: 1,
          open: [{ id: "T-1" }, { id: "T-2" }, { id: "T-3" }],
          waiting: [{ id: "T-3" }],
          done: [],
        },
        features: {
          schemaVersion: 1,
          features: [
            {
              id: "auth",
              title: "Sign in",
              status: "shipped",
              version: "1.0",
              updated: "2026-11-01",
              apps: [],
              origin: null,
              flows: [{ id: "login", status: "shipped", since: "1.0" }],
              releases: [],
            },
          ],
        },
      },
    });

    expect(view.text).toContain("1 errors, 2 warnings");
    // Waiting tasks are counted once, as waiting.
    expect(view.text).toContain("2 open, 1 waiting");
    expect(view.links).toContain("#grimoire/feature/auth");
  });
});

describe("grimoire view: tasks", () => {
  const task = (id: string, status: string) => ({
    id,
    title: `Task ${id}`,
    type: "feature",
    status,
    feature: null,
    flow: null,
    apps: [],
    file: `grimoire/tasks/open/${id}.md`,
    shipped: null,
    decisionNeeded: null,
  });

  it("shows a waiting task only under Waiting, not also under Open", async () => {
    const waiting = task("T-2", "waiting for approval");
    const { view } = await renderView(
      {
        tasks: {
          schemaVersion: 1,
          open: [task("T-1", "open"), waiting],
          waiting: [waiting],
          done: [task("T-3", "done")],
        },
      },
      "tasks",
    );
    const headings = view.find("h3").map((node) => node.text);

    expect(headings).toEqual(["Open (1)", "Waiting for approval (1)", "Done (1)"]);
    expect(view.links.filter((link) => link === "#grimoire/task/T-2")).toHaveLength(1);
  });
});

describe("grimoire view: graphs", () => {
  const graph = {
    nodes: [
      { id: "feature:catalog", label: "catalog", type: "center" },
      { id: "flow:catalog/new-arrivals", label: "new-arrivals", type: "flow" },
      { id: "feature:auth", label: "auth", type: "feature" },
    ],
    edges: [
      { from: "feature:catalog", to: "flow:catalog/new-arrivals", type: "has" },
      { from: "feature:catalog", to: "feature:auth", type: "borrows" },
    ],
  };

  it("draws a feature graph as plain SVG with linked nodes", async () => {
    const { view } = await renderView(
      {
        "features/catalog": {
          type: "feature",
          readme: {
            id: located("catalog"),
            title: located("Catalog"),
            status: located("shipped"),
            version: located("3.0"),
            updated: located("2026-11-01"),
            summary: "Browse products.",
          },
          flows: [{ id: "new-arrivals", status: "shipped", since: "2.0", heading: "New arrivals" }],
          bookmap: { own: ["a.ts"], borrowed: [], routes: [], pages: {}, unreached: [] },
          changes: [],
          tasks: [],
          findings: [],
        },
        "graph/feature/catalog": graph,
      },
      "feature/catalog",
    );
    const svg = view.find("svg")[0] as FakeNode;

    expect(svg.namespace).toBe("http://www.w3.org/2000/svg");
    expect(svg.find("circle")).toHaveLength(3);
    expect(svg.find("line")).toHaveLength(2);
    expect(svg.links).toEqual([
      "#grimoire/feature/catalog",
      "#grimoire/flow/catalog/new-arrivals",
      "#grimoire/feature/auth",
    ]);
    expect(view.text).toContain("Browse products.");
  });

  it("links the page, its blocks and flows in a page graph, and leaves the layout unlinked", async () => {
    const { view } = await renderView(
      {
        "apps/web-client/pages/home": {
          page: {
            id: "home",
            heading: located("Home"),
            route: located("/"),
            screen: null,
            purpose: null,
            blocks: [],
            blockFiles: [],
          },
          layout: null,
          book: null,
        },
        "graph/page?app=web-client&page=home": {
          nodes: [
            { id: "page:web-client/home", label: "Home", type: "center" },
            { id: "layout:web-client/main", label: "main", type: "layout" },
            { id: "block:web-client/home/New arrivals", label: "New arrivals", type: "block" },
            { id: "flow:catalog/new-arrivals", label: "catalog/new-arrivals", type: "flow" },
          ],
          edges: [],
        },
      },
      "page/web-client/home",
    );
    const svg = view.find("svg")[0] as FakeNode;

    expect(svg.find("circle")).toHaveLength(4);
    expect(svg.links).toEqual([
      "#grimoire/page/web-client/home",
      "#grimoire/page/web-client/home",
      "#grimoire/flow/catalog/new-arrivals",
    ]);
  });

  it("draws the module graph without a centre", async () => {
    const { view } = await renderView(
      {
        "graph/modules": {
          nodes: [
            { id: "module:src/app/a", label: "src/app/a (3)", type: "module" },
            { id: "module:src/app/b", label: "src/app/b (2)", type: "module" },
          ],
          edges: [{ from: "module:src/app/a", to: "module:src/app/b", type: "imports", weight: 4 }],
        },
      },
      "modules",
    );

    expect(view.find("circle")).toHaveLength(2);
    expect(view.find("line")).toHaveLength(1);
  });
});
