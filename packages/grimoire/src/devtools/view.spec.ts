import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

const counts0 = { direct: 0, feature: 0, reachable: 0, typeOnly: 0 };

const flowAnswer = {
  type: "flow",
  routes: "cached",
  notes: [],
  flow: {
    id: located("new-arrivals"),
    since: located("2.0"),
    status: located("shipped"),
    who: located("everyone"),
    origin: located("inferred"),
    heading: located("New arrivals"),
    summary: "Shows the newest products first, using `created_at`.",
    steps: [{ index: 2, note: "the list the page calls" }],
    differs: [{ name: "mobile", text: "uses the device country", at: location }],
    cases: [
      {
        question: "not found",
        fixed: true,
        answer: "the global list (AC-1)",
        doesNotApply: false,
        criteria: ["AC-1"],
        at: location,
      },
      {
        question: "expiry",
        fixed: true,
        answer: "does not apply: products never expire",
        doesNotApply: true,
        criteria: [],
        at: location,
      },
    ],
    notHandled: [{ name: "double submit", text: "not guarded yet", at: location }],
    unknowns: [{ text: "is the limit 20 or 25?", at: location }],
  },
  feature: { id: "catalog", title: "Catalog", status: "shipped", apps: ["web-client"] },
  previous: null,
  next: { id: "search", heading: "Search" },
  health: {
    criteria: {
      total: 2,
      proven: 1,
      byStatus: { pass: 1, fail: 0, stale: 0, "not-run": 0, "no-test": 1 },
    },
    steps: { total: 2, resolved: 2 },
    findings: { errors: 0, warnings: 2, expected: 0 },
  },
  results: {
    recorded: true,
    file: "grimoire/book/test-results.json",
    updatedAt: "2026-11-17T10:00:00.000Z",
    proofs: 1,
    withResult: 1,
    unmatched: 0,
  },
  bookmap: {
    steps: [
      {
        index: 1,
        type: "page",
        target: "/",
        found: true,
        entry: "src/pages/home.page.tsx",
        entries: ["src/pages/home.page.tsx"],
        counts: { direct: 6, feature: 8, reachable: 1192, typeOnly: 40 },
        direct: ["src/pages/home.setup.ts"],
        linked: null,
      },
      {
        index: 2,
        type: "route",
        target: "GET /api/products/new-arrivals",
        found: true,
        entry: null,
        entries: [],
        counts: { ...counts0, direct: 2 },
        direct: ["src/a.ts", "src/b.ts"],
        linked: null,
      },
    ],
    criteria: [
      {
        id: "AC-1",
        app: null,
        text: "the newest products come first",
        status: "pass",
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
        status: "no-test",
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
  findings: [
    {
      code: "GR4001",
      severity: "warning",
      message: "AC-2 has no test",
      at: null,
      expected: false,
      subject: {
        feature: "catalog",
        flow: "catalog/new-arrivals",
        app: null,
        task: null,
        file: null,
      },
      hint: "Add a test",
    },
    {
      code: "GR1030",
      severity: "warning",
      message: "A different warning",
      at: null,
      expected: false,
      subject: {
        feature: "catalog",
        flow: "catalog/new-arrivals",
        app: null,
        task: null,
        file: null,
      },
      hint: "Fix the other thing",
    },
  ],
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
    const input = view.findAll(
      (node) => node.attributes.class === "grimoire-search",
    )[0] as FakeNode;

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

/** Open the nth collapsed group of a page (a step on the Files tab). */
function openStepGroup(view: FakeNode, index: number): void {
  const head = view.findAll((node) => node.attributes.class === "grimoire-group-head")[
    index
  ] as FakeNode;

  expect(head.attributes["aria-expanded"]).toBe("false");
  head.fire("click");
  expect(head.attributes["aria-expanded"]).toBe("true");
}

describe("grimoire view: flow", () => {
  it("shows steps resolved out of the steps that were checked, and how many were not checked", async () => {
    const { view } = await renderView(
      {
        "flows/catalog/new-arrivals": {
          ...flowAnswer,
          health: { ...flowAnswer.health, steps: { total: 5, resolved: 2, unchecked: 3 } },
        },
      },
      "flow/catalog/new-arrivals",
    );

    expect(view.text).toContain("Steps resolved");
    expect(view.text).toContain("2/2");
    expect(view.text).toContain("found in the book; 3 not checked");
  });

  it("shows the journey, the cases, where it is shown and the history on the default tab", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const text = view.text;

    expect(text).toContain("New arrivals");
    expect(text).toContain("catalog/new-arrivals");
    expect(text).toContain("GET /api/products/new-arrivals");
    expect(text).toContain("as block New arrivals");
    expect(text).toContain("country fallback");
    expect(text).toContain("release 5.2.0, 2026-10-01");
    expect(text).toContain("is the limit 20 or 25?");
    expect(text).toContain("uses the device country");
    expect(text).toContain("not guarded yet");
    expect(text).toContain("inferred");
    // The criteria and their tests belong to the Proof tab, which is not built until it opens.
    expect(text).not.toContain("orders products");
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/feature/catalog",
        "#grimoire/page/web-client/home",
        "#grimoire/flow/catalog/search",
      ]),
    );
  });

  it("shows the criteria with their tests on the Proof tab", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals/proof",
    );

    expect(view.text).toContain("the newest products come first");
    expect(view.text).toContain("orders products");
    expect(view.links).toContain("#grimoire/file/e2e%2Fnew.spec.ts");
  });

  it("draws each written step as a node and opens its entry and files when clicked", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const nodes = view.findAll(
      (node) => node.attributes.class?.includes("grimoire-jnode ") ?? false,
    );

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.attributes["aria-expanded"]).toBe("false");
    expect(nodes[0]?.text).toContain("page");
    expect(nodes[1]?.text).toContain("GET /api/products/new-arrivals");
    expect(view.links).not.toContain("#grimoire/file/src%2Fpages%2Fhome.page.tsx");

    (nodes[0] as FakeNode).fire("click");
    expect((nodes[0] as FakeNode).attributes["aria-expanded"]).toBe("true");
    expect(view.links).toContain("#grimoire/file/src%2Fpages%2Fhome.page.tsx");
    expect(view.text).toContain("6 direct · 8 in feature · 1192 reachable · 40 type-only");

    (nodes[1] as FakeNode).fire("click");
    expect(view.links).toContain("#grimoire/route/GET/%2Fapi%2Fproducts%2Fnew-arrivals");
  });

  it("draws a step the book could not find as a dashed warn node and says so", async () => {
    const answer = {
      ...flowAnswer,
      bookmap: {
        ...flowAnswer.bookmap,
        steps: [{ ...flowAnswer.bookmap.steps[0], found: false, entry: null, entries: [] }],
      },
    };
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": answer },
      "flow/catalog/new-arrivals",
    );
    const node = view.findAll(
      (nodeItem) => nodeItem.attributes.class?.includes("grimoire-jnode ") ?? false,
    )[0] as FakeNode;

    expect(node.attributes.class).toContain("is-missing");
    expect(node.text).toContain("not found");
  });

  it("lists the cases as a What if lane and ties none of them to a step", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const cards = view.findAll((node) => node.attributes.class === "grimoire-whatif-card");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.text).toContain("What if not found?");
    expect(cards[0]?.text).toContain("the global list");
    expect(view.links).toContain("#grimoire/flow/catalog/new-arrivals/proof");
  });

  it("opens the tab named in the hash, keeps tabs as real buttons and shows counts", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals/findings",
    );
    const tabs = view.findAll((node) => node.attributes.role === "tab");

    expect(tabs.map((tab) => tab.tag)).toEqual(["button", "button", "button", "button"]);
    expect(tabs.map((tab) => tab.attributes["aria-selected"])).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(tabs[0]?.text).toContain("Journey");
    expect(tabs[1]?.text).toContain("Proof");

    // Opening another tab builds it then; an unknown tab opens the default one.
    (tabs[1] as FakeNode).fire("click");
    expect(view.text).toContain("the newest products come first");
    expect(tabs[1]?.attributes["aria-selected"]).toBe("true");

    const unknown = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals/nope",
    );

    expect(
      unknown.view.findAll((node) => node.attributes.role === "tab")[0]?.attributes[
        "aria-selected"
      ],
    ).toBe("true");
  });

  it("shows the Journey sections in the planned order, with a health strip and the summary", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const headings = view.find("h3").map((node) => node.text);

    expect(headings).toEqual([
      "Journey",
      "What if…",
      "Differs by app",
      "Not handled",
      "Unknowns",
      "Where users see it",
      "History",
    ]);
    expect(view.text).toContain("Shows the newest products first, using");
    expect(view.text).toContain("1/2");
    expect(view.text).toContain("2 warnings");
    expect(view.text).toContain("2026-11-17");
    expect(view.links).toContain("#grimoire/check?flow=catalog%2Fnew-arrivals");
    // Next flow at the top and the bottom.
    expect(view.links.filter((link) => link === "#grimoire/flow/catalog/search")).toHaveLength(2);
  });

  it("says when a flow has no summary", async () => {
    const answer = { ...flowAnswer, flow: { ...flowAnswer.flow, summary: null } };
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": answer },
      "flow/catalog/new-arrivals",
    );

    expect(view.text).toContain("No summary yet. Add one sentence under the title");
  });

  it("offers the first criterion without a test, with a copyable @proves line", async () => {
    const written: string[] = [];

    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: async (text: string) => void written.push(text) } },
      configurable: true,
    });

    try {
      const { view } = await renderView(
        { "flows/catalog/new-arrivals": flowAnswer },
        "flow/catalog/new-arrivals/proof",
      );
      const box = view.findAll(
        (node) => node.attributes.class?.includes("grimoire-fixnext") ?? false,
      )[0] as FakeNode;

      expect(box.text).toContain("AC-2 has no test");
      expect(box.text).toContain("// @proves catalog/new-arrivals AC-2");

      button(box, "Copy").fire("click");
      await vi.waitFor(() => expect(written).toEqual(["// @proves catalog/new-arrivals AC-2"]));
      await vi.waitFor(() => expect(box.text).toContain("Copied."));
    } finally {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  it("puts failing criteria before untested ones and says when everything is proven", async () => {
    const criteria = flowAnswer.bookmap.criteria;
    const failing = {
      ...flowAnswer,
      bookmap: {
        ...flowAnswer.bookmap,
        criteria: [
          { ...criteria[1], id: "AC-2" },
          {
            ...criteria[0],
            id: "AC-3",
            status: "fail",
            tests: [{ file: "e2e/x.spec.ts", line: 4, name: "x", result: "fail", stale: false }],
          },
        ],
      },
    };
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": failing },
      "flow/catalog/new-arrivals/proof",
    );
    const box = view.findAll(
      (node) => node.attributes.class?.includes("grimoire-fixnext") ?? false,
    )[0] as FakeNode;

    expect(box.text).toContain("AC-3 fails in e2e/x.spec.ts:4");

    const proven = {
      ...flowAnswer,
      bookmap: { ...flowAnswer.bookmap, criteria: [criteria[0]] },
    };
    const done = await renderView(
      { "flows/catalog/new-arrivals": proven },
      "flow/catalog/new-arrivals/proof",
    );

    expect(done.view.text).toContain("Every criterion is proven");
  });

  it("shows one status per criterion and no duplicated no-test text or finding", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals/proof",
    );
    const proof = view.findAll((node) => node.attributes.id === "grimoire-ac-AC-2")[0] as FakeNode;

    expect(proof.text.match(/no-test/g)).toHaveLength(1);
    expect(proof.text).not.toContain("no test");
    // The Fix next box names the criterion once.
    expect(view.text.match(/AC-2 has no test/g)).toHaveLength(1);

    // The Findings tab has no GR4001 row: missing tests are shown per criterion.
    const findings = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals/findings",
    );

    expect(findings.view.text).not.toContain("GR4001");
    expect(findings.view.text).toContain("GR1030");
  });

  it("explains missing test results once and calls tagged tests tagged, not not-run", async () => {
    const answer = {
      ...flowAnswer,
      results: {
        ...flowAnswer.results,
        recorded: false,
        updatedAt: null,
        withResult: 0,
        proofs: 1,
      },
      bookmap: {
        ...flowAnswer.bookmap,
        criteria: [
          {
            ...flowAnswer.bookmap.criteria[0],
            status: "not-run",
            tests: [
              {
                file: "e2e/new.spec.ts",
                line: 12,
                name: "orders products",
                result: "not-run",
                stale: false,
              },
            ],
          },
        ],
      },
    };
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": answer },
      "flow/catalog/new-arrivals/proof",
    );
    const proof = view.findAll((node) => node.attributes.id === "grimoire-ac-AC-1")[0] as FakeNode;

    expect(view.text.match(/No test results recorded yet/g)).toHaveLength(1);
    expect(view.text).toContain("grimoireReporter()");
    expect(view.text).toContain("testResultsFile");
    expect(proof.text).toContain("tagged");
    expect(proof.text).not.toContain("not-run");
  });

  it("groups cases: handled first as What if cards with criteria links, does not apply collapsed without a repeated prefix", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals",
    );
    const details = view.find("details")[0] as FakeNode;

    expect(view.text).not.toContain("does not apply: does not apply");
    expect(details.text).toContain("Does not apply (1)");
    expect(details.text).toContain("products never expire");
    expect(details.text).not.toContain("does not apply:");
    expect(view.links).toContain("#grimoire/flow/catalog/new-arrivals/proof");
  });

  it("loads the files of a step on demand, a set and a page at a time", async () => {
    const page = (offset: number, total: number) => ({
      ref: "catalog/new-arrivals",
      index: 1,
      set: "reachable",
      total,
      offset,
      limit: 200,
      files: [{ file: `src/f${offset}.ts`, module: "shared", owner: null }],
      modules: [{ module: "shared", count: total }],
    });
    const base = "flows/catalog/new-arrivals/steps/1/files";
    const { view, calls } = await renderView(
      {
        "flows/catalog/new-arrivals": flowAnswer,
        [`${base}?set=direct&offset=0`]: { ...page(0, 1), set: "direct" },
        [`${base}?set=reachable&offset=0`]: page(0, 2),
        [`${base}?set=reachable&offset=1`]: page(1, 2),
        [`${base}?set=type-only&offset=0`]: { ...page(0, 1), set: "type-only" },
      },
      "flow/catalog/new-arrivals/files",
    );

    // Nothing is requested until the files are asked for.
    expect(calls.filter((call) => call.includes("/files"))).toEqual([]);

    openStepGroup(view, 0);
    await vi.waitFor(() => expect(view.text).toContain("src/f0.ts"));
    expect(calls).toContain(`${base}?set=direct&offset=0`);

    button(view, "All reachable").fire("click");
    await vi.waitFor(() => expect(calls).toContain(`${base}?set=reachable&offset=0`));
    await vi.waitFor(() => expect(view.text).toContain("Load 1 more"));
    button(view, "Load 1 more").fire("click");
    await vi.waitFor(() => expect(calls).toContain(`${base}?set=reachable&offset=1`));
    await vi.waitFor(() => expect(view.text).toContain("src/f1.ts"));
    expect(view.text).toContain("shared (2)");

    button(view, "Type-only").fire("click");
    await vi.waitFor(() => expect(calls).toContain(`${base}?set=type-only&offset=0`));
  });

  it("keeps a step files failure in place with a way to try again", async () => {
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": flowAnswer },
      "flow/catalog/new-arrivals/files",
    );

    openStepGroup(view, 0);
    await vi.waitFor(() => expect(view.text).toContain("Could not load the files: no answer for"));
    expect(view.text).toContain("Try again");
  });

  it("renders code spans as code elements and never as HTML", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const answer = {
      ...flowAnswer,
      flow: { ...flowAnswer.flow, summary: `Uses \`${hostile}\` and \`created_at\`.` },
    };
    const { view } = await renderView(
      { "flows/catalog/new-arrivals": answer },
      "flow/catalog/new-arrivals",
    );
    const code = view.find("code").map((node) => node.text);

    expect(code).toEqual(expect.arrayContaining([hostile, "created_at"]));
    expect(view.text).not.toContain("`");
    expect(view.find("img")).toHaveLength(0);
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

const chip = (step: number, type: string, label: string, extra: Record<string, unknown> = {}) => ({
  step,
  type,
  label,
  found: true,
  app: null,
  page: null,
  method: null,
  path: null,
  file: null,
  ...extra,
});

const featurePageAnswer = {
  type: "feature",
  routes: "cached",
  notes: [],
  readme: {
    id: located("catalog"),
    title: located("Catalog"),
    status: located("shipped"),
    version: located("3.0"),
    updated: located("2026-11-01"),
    summary: "Browse products.",
  },
  flows: [
    {
      id: "new-arrivals",
      status: "shipped",
      since: "2.0",
      heading: "New arrivals",
      steps: 3,
      cases: 2,
      criteria: 2,
      tested: 1,
      findings: 1,
    },
    {
      id: "search",
      status: "building",
      since: "3.0",
      heading: null,
      steps: 1,
      cases: 0,
      criteria: 0,
      tested: 0,
      findings: 0,
    },
  ],
  bookmap: {
    own: ["src/app/catalog/a.ts", "src/app/catalog/b.ts", "src/app/cart/c.ts"],
    borrowed: [{ file: "src/shared/x.ts", owner: null, by: ["src/app/catalog/a.ts"] }],
    routes: [{ method: "GET", path: "/api/products", file: "src/app/catalog/routes.ts" }],
    pages: { "web-client": [{ route: "/", file: "src/pages/home.page.tsx", type: "page" }] },
    unreached: ["src/app/cart/c.ts"],
  },
  map: {
    columns: [
      { id: "app:web-client", title: "Storefront", type: "site" },
      { id: "app:mobile", title: "Shop app", type: "mobile" },
      { id: "api", title: "API", type: "api" },
      { id: "background", title: "Background", type: "background" },
    ],
    rows: [
      {
        flow: "new-arrivals",
        heading: "New arrivals",
        status: "shipped",
        cells: {
          "app:web-client": [chip(1, "page", "/", { app: "web-client", page: "home" })],
          api: [
            chip(2, "route", "GET /api/products/new-arrivals", {
              method: "GET",
              path: "/api/products/new-arrivals",
            }),
          ],
          background: [
            chip(3, "mail", "arrivals-digest", { file: "src/mail/digest.ts" }),
            chip(4, "job", "ghost-job", { found: false }),
          ],
        },
      },
      { flow: "search", heading: null, status: "building", cells: {} },
    ],
  },
  fileGroups: [
    { module: "cart", files: ["src/app/cart/c.ts"] },
    { module: "catalog", files: ["src/app/catalog/a.ts", "src/app/catalog/b.ts"] },
  ],
  proofs: [
    {
      flow: "new-arrivals",
      heading: "New arrivals",
      criteria: [
        {
          id: "AC-1",
          app: null,
          text: "newest first",
          status: "pass",
          tests: [
            { file: "e2e/new.spec.ts", line: 3, name: "orders", result: "pass", stale: false },
          ],
        },
        { id: "AC-2", app: null, text: "global list", status: "no-test", tests: [] },
      ],
    },
    { flow: "search", heading: null, criteria: [] },
  ],
  changes: [],
  tasks: [],
  findings: [
    {
      code: "GR4008",
      severity: "warning",
      message: "AC-1 did not run",
      at: null,
      expected: false,
      subject: {
        feature: "catalog",
        flow: "catalog/new-arrivals",
        app: null,
        task: null,
        file: null,
      },
      hint: null,
    },
    {
      code: "GR4008",
      severity: "warning",
      message: "AC-2 did not run",
      at: null,
      expected: false,
      subject: {
        feature: "catalog",
        flow: "catalog/new-arrivals",
        app: null,
        task: null,
        file: null,
      },
      hint: null,
    },
    {
      code: "GR3006",
      severity: "warning",
      message: "file not reached",
      at: null,
      expected: true,
      subject: { feature: "catalog", flow: null, app: null, task: null, file: null },
      hint: null,
    },
  ],
};

describe("grimoire view: feature page", () => {
  const answers = { "features/catalog": featurePageAnswer };

  it("opens on the Overview with the feature map, flow cards and counts on the tabs", async () => {
    const { view } = await renderView(answers, "feature/catalog");
    const tabs = view.findAll((node) => node.attributes.role === "tab");

    expect(tabs.map((tab) => tab.text.replace(/\s+/g, " ").trim())).toEqual([
      "Overview",
      "Flows 2",
      "Files 3",
      "Findings 2",
      "Tests 2",
    ]);
    expect(tabs[0]?.attributes["aria-selected"]).toBe("true");
    expect(view.text).toContain("Browse products.");
    expect(view.find("h3").map((node) => node.text)).toEqual([
      "Feature map",
      "Flows",
      "Recent changes",
    ]);
  });

  it("draws flows as rows and places as columns, with a dash for an empty cell and links on the chips", async () => {
    const { view } = await renderView(answers, "feature/catalog");
    const headers = view
      .findAll((node) => node.tag === "th" && node.attributes.scope === "col")
      .map((node) => node.text);

    expect(headers[0]).toBe("Flow");
    expect(headers.join("|")).toContain("Storefront");
    expect(headers.join("|")).toContain("Shop app");
    expect(headers.join("|")).toContain("Background");
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/page/web-client/home",
        "#grimoire/route/GET/%2Fapi%2Fproducts%2Fnew-arrivals",
        "#grimoire/file/src%2Fmail%2Fdigest.ts",
        "#grimoire/flow/catalog/new-arrivals",
      ]),
    );

    const rows = view.find("tbody")[0]?.find("tr") ?? [];

    expect(rows).toHaveLength(2);
    // The search flow touches nothing: every cell is a dash.
    expect(
      rows[1]?.findAll((node) => node.tag === "td").every((cell) => cell.text.trim() === "–"),
    ).toBe(true);

    const missing = view.findAll(
      (node) =>
        (node.attributes.class ?? "").includes("grimoire-mapchip") &&
        (node.attributes.class ?? "").includes("is-missing"),
    );

    expect(missing).toHaveLength(1);
    expect(missing[0]?.text).toContain("ghost-job");
  });

  it("builds a tab only when it opens, and puts it in the hash route", async () => {
    const { view } = await renderView(answers, "feature/catalog");

    expect(view.text).not.toContain("src/app/cart/c.ts");
    expect(view.text).not.toContain("GR4008");

    const files = view.findAll((node) => node.attributes.role === "tab")[2] as FakeNode;

    files.fire("click");
    expect(files.attributes["aria-selected"]).toBe("true");
    expect(view.text).toContain("3 files in 2 modules");
  });

  it("lists files by module, every group closed until opened, and filters them", async () => {
    const { view } = await renderView(answers, "feature/catalog/files");
    const heads = view.findAll((node) => node.attributes.class === "grimoire-group-head");
    const titles = heads.map((node) => node.text.replace(/\s+/g, " ").trim());

    expect(titles).toEqual(
      expect.arrayContaining([
        "▸ Routes 1",
        "▸ Not reached by a flow 1",
        "▸ cart 1",
        "▸ catalog 2",
      ]),
    );
    expect(heads.every((node) => node.attributes["aria-expanded"] === "false")).toBe(true);
    // Closed groups hold no files yet.
    expect(view.links).not.toContain("#grimoire/file/src%2Fapp%2Fcatalog%2Fa.ts");

    heads.find((node) => node.text.includes("catalog 2"))?.fire("click");
    expect(view.links).toContain("#grimoire/file/src%2Fapp%2Fcatalog%2Fa.ts");

    const input = view.findAll(
      (node) => node.attributes.class === "grimoire-filterbox",
    )[0] as FakeNode;

    input.fire("input", { target: { value: "cart" } });
    expect(view.text).toContain("1 of 3 files match");
    expect(view.text).not.toContain("catalog 2");
  });

  it("groups findings by code, closed, with counts and the expected ones left out of the tab count", async () => {
    const { view } = await renderView(
      { ...answers, "check/groups": { groups: [{ code: "GR4008", title: "A test did not run" }] } },
      "feature/catalog/findings",
    );
    const heads = view.findAll((node) => node.attributes.class === "grimoire-group-head");

    expect(heads.map((node) => node.text.replace(/\s+/g, " ").trim())).toEqual([
      "▸ warning GR4008 2",
      "▸ warning GR3006 1",
    ]);
    expect(view.text).not.toContain("AC-1 did not run");

    heads[0]?.fire("click");
    expect(view.text).toContain("AC-1 did not run");
    expect(view.text).toContain("AC-2 did not run");
  });

  it("shows the criteria of each flow with their tests on the Tests tab", async () => {
    const { view } = await renderView(answers, "feature/catalog/tests");
    const heads = view.findAll((node) => node.attributes.class === "grimoire-group-head");

    // The flow with no criteria has no group.
    expect(heads).toHaveLength(1);
    expect(heads[0]?.text).toContain("1/2 proven");
    heads[0]?.fire("click");
    expect(view.text).toContain("newest first");
    expect(view.links).toContain("#grimoire/file/e2e%2Fnew.spec.ts");
  });

  it("still opens an older answer that has no map, file groups or proofs", async () => {
    const { map: _map, fileGroups: _groups, proofs: _proofs, ...older } = featurePageAnswer;
    const { view } = await renderView({ "features/catalog": older }, "feature/catalog");

    expect(view.text).toContain("Browse products.");
    expect(view.text).toContain("This answer has no feature map");
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
      ["product", ["Product map"]],
      ["product/feature/auth", ["Product map"]],
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
      ["check?code=GR3006&feature=cart", ["Check"]],
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
      "#grimoire/product",
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
    expect(trail.text).toContain("Catalog");
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
  const group = (
    code: string,
    severity: string,
    count: number,
    expected: number,
    features: [string, number][],
  ) => ({
    code,
    severity,
    area: "written",
    title: `Title of ${code}`,
    fix: `Fix ${code} like this`,
    count,
    expected,
    features: features.map(([feature, total]) => ({ feature, count: total })),
  });
  const groups = {
    ok: true,
    counts: { errors: 0, warnings: 3, expected: 1 },
    groups: [
      group("GR2002", "warning", 2, 0, [["cart", 2]]),
      group("GR3006", "warning", 1, 0, [["cart", 1]]),
      group("GR5000", "error", 0, 1, [["wishlist", 1]]),
    ],
  };
  const finding = (code: string, file: string) => ({
    code,
    severity: "warning",
    message: `Message ${code}`,
    at: null,
    expected: false,
    subject: { feature: "cart", flow: null, app: null, task: null, file },
    hint: `Fix ${code} like this`,
  });
  const page = (findings: unknown[], total: number, offset = 0) => ({
    ok: true,
    routes: "cached",
    counts: groups.counts,
    findings,
    total,
    offset,
    limit: 20,
  });

  it("heads the tab with errors, warnings and kinds, and shows each fix once", async () => {
    const { view } = await renderView({ "check/groups": groups }, "check");

    expect(view.text).toContain("0 errors · 3 warnings in 2 kinds");
    expect(view.find("h3").map((node) => node.text)).toEqual([
      "To fix (2 kinds)",
      "Title of GR2002",
      "Title of GR3006",
      "Expected: proposed work (1 kind)",
      "Title of GR5000",
    ]);
    expect(view.text.match(/Fix GR2002 like this/g)).toHaveLength(1);
  });

  it("renders code spans in a group title as code, not as literal backticks", async () => {
    const titled = {
      ...groups,
      groups: [
        {
          ...group("GR6007", "error", 1, 0, [["cart", 1]]),
          title: "A flow's `since` is newer than its feature's version",
        },
      ],
    };
    const { view } = await renderView({ "check/groups": titled }, "check");
    const heading = view.find("h3").find((node) => node.text.includes("is newer than"));

    // The fake DOM joins child texts with spaces.
    expect(heading?.text.replace(/\s+/g, " ")).toBe(
      "A flow's since is newer than its feature's version",
    );
    expect(heading?.find("code").map((node) => node.text)).toEqual(["since"]);
    expect(view.text).not.toContain("`since`");
  });

  it("shows files no flow reaches one row per feature and loads them on request", async () => {
    const { view, calls } = await renderView(
      {
        "check/groups": groups,
        "check?code=GR3006&feature=cart&state=unexpected&offset=0&limit=20": page(
          [finding("GR3006", "src/cart/a.ts")],
          1,
        ),
      },
      "check",
    );
    const card = view.findAll(
      (node) =>
        node.attributes.class === "grimoire-card grimoire-check-group" &&
        node.text.includes("Title of GR3006"),
    )[0] as FakeNode;

    expect(card.text).toContain("1 file");
    expect(card.text).not.toContain("Show all");
    expect(card.text).toContain("Show files");
    expect(calls.filter((call) => call.startsWith("check"))).toEqual(["check/groups"]);

    button(card, "Show files").fire("click");
    await vi.waitFor(() => expect(card.text).toContain("src/cart/a.ts"));
    // The fix is not repeated for each finding.
    expect(card.text.match(/Fix GR3006 like this/g)).toHaveLength(1);
  });

  it("pages a code's findings with Load more", async () => {
    const { view } = await renderView(
      {
        "check/groups": groups,
        "check?code=GR2002&state=unexpected&offset=0&limit=20": page(
          [finding("GR2002", "a.ts")],
          2,
        ),
        "check?code=GR2002&state=unexpected&offset=1&limit=20": page(
          [finding("GR2002", "b.ts")],
          2,
          1,
        ),
      },
      "check",
    );
    const card = view.findAll(
      (node) =>
        node.attributes.class === "grimoire-card grimoire-check-group" &&
        node.text.includes("Title of GR2002"),
    )[0] as FakeNode;

    button(card, "Show all 2").fire("click");
    await vi.waitFor(() => expect(card.text).toContain("Showing 1 of 2"));
    button(card, "Load 1 more").fire("click");
    await vi.waitFor(() => expect(card.text).toContain("Showing 2 of 2"));
    expect(card.text).toContain("b.ts");
  });

  it("keeps filters in the hash: links carry them and the route opens the filtered view", async () => {
    const { view } = await renderView(
      { "check/groups": groups },
      "check?code=GR2002&severity=warning",
    );

    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/check?code=GR2002",
        "#grimoire/check?code=GR2002&severity=error",
        "#grimoire/check?code=GR2002&severity=warning&state=expected",
      ]),
    );
    expect(view.find("h3").map((node) => node.text)).toEqual([
      "To fix (1 kind)",
      "Title of GR2002",
    ]);
    expect(view.text).toContain("code: GR2002 ×");
  });

  it("lists a flow's findings flat when the hash names the flow", async () => {
    const { view, calls } = await renderView(
      {
        "check/groups": groups,
        "check?flow=catalog%2Fnew-arrivals&state=unexpected&offset=0&limit=50": page(
          [finding("GR1030", "x.md")],
          1,
        ),
      },
      "check?flow=catalog%2Fnew-arrivals",
    );

    await vi.waitFor(() => expect(view.text).toContain("Message GR1030"));
    expect(calls).toContain("check?flow=catalog%2Fnew-arrivals&state=unexpected&offset=0&limit=50");
    expect(view.text).toContain("flow: catalog/new-arrivals ×");
  });

  it("says when nothing is wrong", async () => {
    const { view } = await renderView(
      { "check/groups": { ok: true, counts: { errors: 0, warnings: 0, expected: 0 }, groups: [] } },
      "check",
    );

    expect(view.text).toContain("0 errors · 0 warnings in 0 kinds");
    expect(view.text).toContain("No findings.");
  });
});

describe("grimoire view: product map", () => {
  it("loads the product map module from a page-relative asset URL", async () => {
    // A host may return `panels/grimoire/product-map.js`; import() refuses that bare
    // specifier, so the view resolves it against the page first.
    const dashboard = pathToFileURL(
      path.join(path.dirname(viewPath), "..", "dashboard") + path.sep,
    ).href;

    vi.stubGlobal("document", { baseURI: dashboard });

    try {
      const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
      const panel = fakePanelContext(
        { product: { builtAt: null, features: [], apps: [], developer: true } },
        "product",
      );
      const context = { ...panel.context, asset: (name: string) => `../ui/${name}` };
      const view = (await render(context)) as FakeNode;

      expect(view.text).toContain("No features are written yet");
      expect(view.text).not.toContain("Could not load");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hands the product routes to the product map module with the path parts", async () => {
    const calls: string[][] = [];

    Object.assign(globalThis, {
      grimoireProductMap: {
        productMapView: async (_ctx: unknown, parts: string[]) => {
          calls.push(parts);
          return fakePanelContext({}, "").root;
        },
      },
    });

    try {
      await renderView({}, "product");
      await renderView({}, "product/feature/cart");
      await renderView({}, "product/flow/catalog/new-arrivals");
    } finally {
      Reflect.deleteProperty(globalThis, "grimoireProductMap");
    }

    expect(calls).toEqual([[], ["feature", "cart"], ["flow", "catalog", "new-arrivals"]]);
  });

  it("says what failed when the product map module cannot load", async () => {
    const { view } = await renderView({}, "product");

    expect(view.text).toContain("Could not load the product map");
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

  it("shows a skeleton with progress, an elapsed counter and a hint that grows with time", async () => {
    vi.useFakeTimers();
    try {
      const panel = fakePanelContext({}, "");
      let release: (answer: unknown) => void = () => undefined;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
      const pending = render({
        ...panel.context,
        api: async () => gate,
      }) as Promise<FakeNode>;

      await vi.advanceTimersByTimeAsync(200);

      const view = await pending;
      const disabled = () => (view.find("input")[0] as unknown as { disabled?: boolean }).disabled;

      // Rendered even without grimoire.css: the layout is inline.
      const grid = view.findAll((node) => node.attributes.class === "grimoire-skeleton-grid")[0];

      expect(grid?.attributes.style).toContain("grid");
      expect(
        view.findAll((node) => node.attributes.class === "grimoire-skeleton-row"),
      ).toHaveLength(5);
      expect(disabled()).toBe(true);
      expect(view.text).toMatch(/Elapsed\s+[0-1] s/);
      expect(view.text).not.toContain("Large books take 5–15 s");

      await vi.advanceTimersByTimeAsync(5200);
      expect(view.text).toMatch(/Elapsed\s+5 s/);
      expect(view.text).toContain(
        "Large books take 5–15 s the first time; later opens are instant.",
      );

      await vi.advanceTimersByTimeAsync(11_000);
      expect(view.text).toContain("taking longer than usual");

      release({});
      await vi.advanceTimersByTimeAsync(50);
      expect(view.text).not.toContain("Elapsed");
      expect(disabled()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the HTTP status and a retry button inside the loading area when the book fails", async () => {
    const panel = fakePanelContext({}, "features");
    const { default: render } = await import(/* @vite-ignore */ pathToFileURL(viewPath).href);
    const view = (await render({
      ...panel.context,
      api: async () => {
        throw Object.assign(new Error("The server answered badly"), { status: 502 });
      },
    })) as FakeNode;

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(view.text).toContain("The server answered badly (HTTP 502)");
    expect(button(view, "Try again")).toBeDefined();
    expect(view.text).not.toContain("Elapsed");
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
      "check/groups": {
        ok: false,
        counts,
        groups: [
          {
            code: "GR2002",
            severity: "warning",
            area: "w",
            title: "Many warnings",
            fix: "x",
            count: 9,
            expected: 0,
            features: [],
          },
          {
            code: "GR1001",
            severity: "error",
            area: "w",
            title: "A broken link",
            fix: "Fix it",
            count: 1,
            expected: 0,
            features: [],
          },
          {
            code: "GR3003",
            severity: "warning",
            area: "w",
            title: "Few warnings",
            fix: "x",
            count: 2,
            expected: 0,
            features: [],
          },
          {
            code: "GR9999",
            severity: "error",
            area: "w",
            title: "Only expected",
            fix: "x",
            count: 0,
            expected: 4,
            features: [],
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
    expect(view.text).not.toContain("Only expected");
    // Errors first, then the biggest group; each leads to the filtered Check tab.
    const problems = view.findAll(
      (node) =>
        node.tag === "a" && node.attributes.href?.startsWith("#grimoire/check?code=") === true,
    );

    expect(problems.map((node) => node.attributes.href)).toEqual([
      "#grimoire/check?code=GR1001",
      "#grimoire/check?code=GR2002",
      "#grimoire/check?code=GR3003",
    ]);
    expect(view.links).toEqual(
      expect.arrayContaining([
        "#grimoire/release/5.2.0",
        "#grimoire/release/5.1.0",
        "#grimoire/features",
      ]),
    );
  });
});

describe("grimoire view: host and flow cards", () => {
  const host = {
    name: "Warlock.js",
    version: "5.59.0",
    logo: "data:image/png;base64,AAAA",
    app: { name: "shop", version: "1.4.0" },
  };
  const featureWith = (flows: unknown[]) => ({
    type: "feature",
    readme: {
      id: located("catalog"),
      title: located("Catalog"),
      status: located("shipped"),
      version: located("3.0"),
      updated: located("2026-11-01"),
      summary: "Browse products.",
    },
    flows,
    bookmap: { own: [], borrowed: [], routes: [], pages: {}, unreached: [] },
    changes: [],
    tasks: [],
    findings: [],
  });

  it("shows the framework in the header and the app at the bottom when the summary has a host", async () => {
    const { view } = await renderView({ summary: { ...emptySummary, host } });
    const brand = view.findAll((node) => node.attributes.class === "grimoire-brand")[0];
    const footer = view.find("footer")[0];

    expect(brand?.text).toContain("Warlock.js");
    expect(brand?.text).toContain("v5.59.0");
    expect(brand?.find("img")[0]?.attributes.src).toBe(host.logo);
    expect(footer?.text).toContain("shop 1.4.0");
  });

  it("shows nothing when the adapter reports no host", async () => {
    const { view } = await renderView({ summary: { ...emptySummary, host: null } });

    expect(view.findAll((node) => node.attributes.class === "grimoire-brand")).toHaveLength(0);
    expect(view.find("footer")[0]?.text ?? "").toBe("");
  });

  it("lists the flows as linked cards with the heading, id, status, counts and findings", async () => {
    const { view } = await renderView(
      {
        "features/catalog": featureWith([
          {
            id: "new-arrivals",
            status: "shipped",
            since: "2.0",
            heading: "New arrivals",
            steps: 4,
            cases: 1,
            criteria: 3,
            tested: 2,
            findings: 2,
          },
          { id: "search", status: "proposed", since: "3.0", heading: null },
        ]),
      },
      "feature/catalog",
    );
    const cards = view.findAll((node) => node.attributes.class === "grimoire-flowcard");

    expect(cards).toHaveLength(2);
    expect(cards[0]?.text).toContain("New arrivals");
    expect(cards[0]?.text).toContain("new-arrivals");
    expect(cards[0]?.text).toContain("since 2.0");
    expect(cards[0]?.text).toContain("4 steps");
    expect(cards[0]?.text).toContain("2/3 criteria tested");
    expect(cards[0]?.text).toContain("2 findings");
    expect(cards[0]?.links).toEqual(["#grimoire/flow/catalog/new-arrivals"]);
    // A flow without counts (an older answer) still renders, with its id as the title.
    expect(cards[1]?.text).toContain("search");
    expect(cards[1]?.text).not.toContain("finding");
  });
});
