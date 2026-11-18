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
        type: "page",
        target: "/",
        found: true,
        entry: "src/pages/home.page.tsx",
        files: ["src/pages/home.page.tsx"],
      },
      {
        index: 2,
        type: "route",
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

    expect(text).toContain("New arrivals");
    expect(text).toContain("catalog/new-arrivals");
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
      "Could not load the flow: no answer for flows/catalog/nope",
    );
    // It says what to do next and offers a way back.
    expect(view.text).toContain("It may have been renamed or removed.");
    expect(view.links).toContain("#grimoire/features");
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

    expect(view.text).toContain("1 error, 2 warnings");
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

const feature = (id: string, status: string, flows: string[], updated = "2026-11-01") => ({
  id,
  title: `Title of ${id}`,
  status,
  version: "1.0",
  updated,
  apps: [],
  origin: null,
  summary: `About ${id}.`,
  releases: [],
  flows: flows.map((flow) => ({ id: flow, status, since: "1.0", heading: null })),
});

const featuresAnswer = {
  features: [
    feature("auth", "shipped", ["login", "logout"]),
    feature("catalog", "shipped", ["new-arrivals"], "2026-11-05"),
    feature("wishlist", "proposed", []),
  ],
};

/** The button of a listing whose label starts with `label`. */
function button(view: FakeNode, label: string): FakeNode {
  return view.findAll(
    (node) => node.tag === "button" && node.text.startsWith(label),
  )[0] as FakeNode;
}

describe("grimoire view: features", () => {
  it("lists features as cards with status, version, flow chips and a count", async () => {
    const { view } = await renderView({ features: featuresAnswer }, "features");

    expect(view.text).toContain("3 of 3 features");
    expect(view.text).toContain("Title of auth");
    expect(view.text).toContain("version 1.0");
    expect(view.text).toContain("2 flows");
    expect(view.text).toContain("0 flows");
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/feature/auth",
        "#grimoire/flow/auth/login",
        "#grimoire/flow/auth/logout",
        "#grimoire/flow/catalog/new-arrivals",
      ]),
    );
  });

  it("filters by status and by text and keeps the count", async () => {
    const { view } = await renderView({ features: featuresAnswer }, "features");

    button(view, "proposed").fire("click");
    expect(view.text).toContain("1 of 3 features");
    expect(view.links).toContain("#grimoire/feature/wishlist");
    expect(view.links).not.toContain("#grimoire/feature/auth");

    button(view, "all").fire("click");
    (view.find("input")[1] as FakeNode).fire("input", { target: { value: "new-arr" } });
    expect(view.text).toContain("1 of 3 features");
    expect(view.links).toContain("#grimoire/feature/catalog");

    (view.find("input")[1] as FakeNode).fire("input", { target: { value: "zzz" } });
    expect(view.text).toContain("0 of 3 features");
    expect(view.text).toContain("No features match these filters.");
  });

  it("sorts by most flows", async () => {
    const { view } = await renderView({ features: featuresAnswer }, "features");
    const select = view.find("select")[0] as FakeNode;

    select.fire("change", { target: { value: "flows" } });

    const order = view
      .findAll((node) => node.tag === "h3")
      .map((node) => node.text.replace("Title of ", ""));

    expect(order).toEqual(["auth", "catalog", "wishlist"]);
  });
});

describe("grimoire view: navigation", () => {
  const active = (view: FakeNode) =>
    view
      .findAll((node) => node.tag === "a" && node.attributes["aria-current"] === "page")
      .map((node) => node.text.trim());

  it("lists the tabs in order and marks the one the route belongs to", async () => {
    const cases: [string, string[]][] = [
      ["", ["Overview"]],
      ["features", ["Features"]],
      ["feature/auth", ["Features"]],
      ["flow/auth/login", ["Features"]],
      ["apps", ["Apps"]],
      ["page/web/home", ["Apps"]],
      ["tasks", ["Tasks"]],
      ["task/T-1", ["Tasks"]],
      ["releases", ["Releases"]],
      ["release/5.1.0", ["Releases"]],
      ["check", ["Check"]],
      ["modules", ["Modules"]],
      ["file/src%2Fa.ts", ["Modules"]],
    ];

    for (const [route, expected] of cases) {
      const { view } = await renderView({}, route);

      expect(active(view), route).toEqual(expected);
    }

    const { view } = await renderView({}, "features");
    const nav = view.findAll((node) => node.attributes.class === "grimoire-tabs")[0] as FakeNode;

    expect(nav.links).toEqual([
      "#grimoire",
      "#grimoire/features",
      "#grimoire/apps",
      "#grimoire/tasks",
      "#grimoire/releases",
      "#grimoire/check",
      "#grimoire/modules",
    ]);
  });

  it("shows counts on the tabs when the summary has them", async () => {
    const { view } = await renderView(
      {
        summary: {
          ...emptySummary,
          counts,
          features: { schemaVersion: 1, features: featuresAnswer.features },
          apps: { apps: 2, pages: 5, screens: 1 },
          releases: 4,
        },
      },
      "check",
    );
    const counted = view.findAll((node) => node.attributes.class === "grimoire-tab-count");

    expect(counted.map((node) => node.text).filter(Boolean)).toEqual(["3", "2", "0", "4", "3"]);
  });

  it("shows breadcrumbs on detail views", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const trail = view.findAll(
      (node) => node.attributes.class === "grimoire-crumbs",
    )[0] as FakeNode;

    expect(trail.links).toEqual(["#grimoire/features", "#grimoire/feature/catalog"]);
    expect(trail.text).toContain("New arrivals");
  });

  it("opens the first hit with the arrow keys and Enter, and Escape clears the search", async () => {
    const answers = {
      summary: emptySummary,
      "search?q=new&limit=15": {
        type: "search",
        text: "new",
        routes: "cached",
        notes: [],
        hits: [
          { type: "flow", id: "catalog/new-arrivals", detail: null, score: 9 },
          { type: "flow", id: "catalog/new-year", detail: null, score: 8 },
          { type: "file", id: "src/new.ts", detail: null, score: 5 },
        ],
      },
    };
    const panel = fakePanelContext(answers, "");
    const opened: string[] = [];
    const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
    const view = (await render({
      ...panel.context,
      navigate: (target: string) => opened.push(target),
    })) as FakeNode;
    const input = view.find("input")[0] as FakeNode;
    const results = view.findAll(
      (node) => node.attributes.class === "grimoire-results",
    )[0] as FakeNode;

    input.fire("input", { target: { value: "new" } });
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Hits are grouped by type.
    expect(results.text).toContain("flow (2)");
    expect(results.text).toContain("file (1)");

    input.fire("keydown", { key: "ArrowDown", preventDefault: () => undefined });
    input.fire("keydown", { key: "ArrowDown", preventDefault: () => undefined });
    input.fire("keydown", { key: "Enter", preventDefault: () => undefined });
    expect(opened).toEqual(["flow/catalog/new-year"]);

    input.fire("keydown", { key: "Escape" });
    expect(results.children).toHaveLength(0);
  });
});

describe("grimoire view: apps", () => {
  const row = (id: string, route: string | null, origin: string | null, type = "page") => ({
    id,
    type,
    route,
    heading: `Heading of ${id}`,
    origin,
    layout: null,
    blocks: 2,
  });
  const appsAnswer = {
    apps: [
      {
        id: "web-client",
        type: "site",
        root: "src/web/client",
        pages: ["home", "cart", "admin-users"],
        screens: [],
        rows: [
          row("home", "/", "confirmed"),
          row("cart", "/cart", "inferred"),
          row("admin-users", "/admin/users", null),
        ],
      },
      {
        id: "mobile",
        type: "mobile",
        root: "mobile",
        pages: [],
        screens: ["settings"],
        rows: [row("settings", "settings", "confirmed", "screen")],
      },
    ],
  };

  it("shows one card per app and groups its pages by the first route segment", async () => {
    const { view } = await renderView({ apps: appsAnswer }, "apps");
    const groups = view.find("h4").map((node) => node.text);

    expect(view.text).toContain("4 of 4 pages and screens");
    expect(view.text).toContain("site");
    expect(view.text).toContain("mobile app");
    expect(view.text).toContain("src/web/client");
    expect(view.text).toContain("1 confirmed, 1 inferred");
    expect(groups).toEqual(["Top level (2)", "/admin (1)", "Top level (1)"]);
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/page/web-client/home",
        "#grimoire/page/web-client/admin-users",
        "#grimoire/page/mobile/settings",
      ]),
    );
  });

  it("filters by text and by whether the description is confirmed", async () => {
    const { view } = await renderView({ apps: appsAnswer }, "apps");

    (view.find("input")[1] as FakeNode).fire("input", { target: { value: "admin" } });
    expect(view.text).toContain("1 of 4 pages and screens");
    expect(view.links).toContain("#grimoire/page/web-client/admin-users");
    expect(view.links).not.toContain("#grimoire/page/web-client/home");
    // The app without a match is left out while filtering.
    expect(view.text).not.toContain("mobile app");

    (view.find("input")[1] as FakeNode).fire("input", { target: { value: "" } });
    button(view, "inferred").fire("click");
    expect(view.text).toContain("1 of 4 pages and screens");
    expect(view.links).toContain("#grimoire/page/web-client/cart");
  });

  it("still lists pages when an older answer has only ids", async () => {
    const { view } = await renderView(
      {
        apps: {
          apps: [{ id: "web", type: "site", root: "src", pages: ["home"], screens: [] }],
        },
      },
      "apps",
    );

    expect(view.links).toContain("#grimoire/page/web/home");
  });
});

describe("grimoire view: check", () => {
  const finding = (code: string, severity: string, expected: boolean) => ({
    code,
    severity,
    message: `Message ${code}`,
    at: { file: "grimoire/features/a/README.md", line: 4, column: null },
    expected,
    subject: { feature: "a", flow: null, app: null, task: null, file: "src/a.ts" },
    hint: `Fix ${code}`,
  });

  it("separates what to fix from expected findings and filters by severity", async () => {
    const { view } = await renderView(
      {
        check: {
          ok: false,
          routes: "cached",
          counts: { errors: 1, warnings: 1, expected: 1 },
          findings: [
            finding("GR1001", "error", false),
            finding("GR2002", "warning", false),
            finding("GR3003", "error", true),
          ],
        },
      },
      "check",
    );
    const headings = view.find("h3").map((node) => node.text);

    expect(headings).toEqual(["To fix (2)", "Expected: proposed work (1)"]);
    expect(view.text).toContain("Fix GR1001");
    expect(view.text).toContain("grimoire/features/a/README.md:4");
    expect(view.links).toContain("#grimoire/file/src%2Fa.ts");

    button(view, "warning").fire("click");
    expect(view.find("h3").map((node) => node.text)).toEqual(["To fix (1)"]);
  });
});

describe("grimoire view: loading and errors", () => {
  it("shows the opening state at once while a slow answer is pending, then fills it in", async () => {
    const panel = fakePanelContext({}, "features");
    let release: (answer: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
    const view = (await render({
      ...panel.context,
      api: async (path: string) => {
        if (path === "summary") throw new Error("not needed here");

        return gate;
      },
    })) as FakeNode;

    expect(view.text).toContain("Opening the book…");
    // The tabs and the search box are already there.
    expect(view.find("input")).toHaveLength(1);
    expect(view.text).toContain("Features");

    release(featuresAnswer);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(view.text).not.toContain("Opening the book…");
    expect(view.text).toContain("3 of 3 features");
  });

  it("names what failed, why, and what to do next", async () => {
    const { view } = await renderView({}, "features");

    expect(view.text).toContain("Could not load the features: no answer for features");
    expect(view.text).toContain("Run warlock grimoire build, then reload.");
    expect(button(view, "Try again")).toBeDefined();
  });

  it("points a static export at the running app when the answer needs it", async () => {
    const panel = fakePanelContext({}, "check");
    const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
    const view = (await render({
      ...panel.context,
      api: async () => {
        throw new Error("This answer needs the running app. Open the Grimoire tab in devtools.");
      },
    })) as FakeNode;

    expect(view.text).toContain("Could not load the check report:");
    expect(view.text).toContain("Open the Grimoire tab in the devtools dashboard");
  });
});

describe("grimoire view: overview", () => {
  it("shows stat cards, stale route facts with the build hint, releases and top problems", async () => {
    const { view } = await renderView({
      summary: {
        ...emptySummary,
        routes: "stale",
        counts,
        apps: { apps: 2, pages: 5, screens: 1 },
        features: { schemaVersion: 1, features: featuresAnswer.features },
      },
      check: {
        ok: false,
        routes: "stale",
        counts,
        findings: [
          {
            code: "GR1001",
            severity: "error",
            message: "A broken link",
            at: null,
            expected: false,
            subject: { feature: null, flow: null, app: null, task: null, file: null },
            hint: "Fix it",
          },
        ],
      },
      releases: {
        releases: [
          { release: "5.1.0", date: "2026-10-01", file: "grimoire/releases/5.1.0.md" },
          { release: "5.2.0", date: "2026-11-01", file: "grimoire/releases/5.2.0.md" },
        ],
      },
    });

    expect(view.text).toContain("5 pages, 1 screen");
    expect(view.text).toContain("Run warlock grimoire build to refresh them.");
    expect(view.text).toContain("A broken link");
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/release/5.2.0",
        "#grimoire/release/5.1.0",
        "#grimoire/features",
      ]),
    );
  });
});
