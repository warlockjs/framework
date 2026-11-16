/**
 * The Grimoire devtools panel over the `shop` fixture: data routes, the
 * book-only case, the static export. Needs `scry()` (search and per-item answers).
 */
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { fakeHelpers, FakeNode } from "./support/fake-dom";
import grimoireDevtoolsPanelDefault, {
  exportGrimoireSite,
  grimoireDevtoolsPanel,
  type GrimoireDevtoolsPanel,
} from "../src/devtools";
import { openGrimoire } from "../src/workspace";
import { createShopAdapter } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

/** The panel over a copy of the fixture, with the route cache seeded the way `warlock grimoire build` leaves it. */
async function shopPanel(options: { written?: boolean } = {}) {
  copy = copyFixture();

  if (options.written === false)
    rmSync(path.join(copy.root, "grimoire"), { recursive: true, force: true });

  await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh" });

  const adapter = createShopAdapter();
  const panel = await grimoireDevtoolsPanel({ root: copy.root, adapter, ttlMs: 0 });

  return { panel, adapter, root: copy.root };
}

/** Call one route by its path pattern, like devtools does (`/flows/:feature/:flow` with `params`). */
async function call(
  panel: GrimoireDevtoolsPanel,
  route: string,
  request: { params?: Record<string, string>; query?: Record<string, string> } = {},
): Promise<any> {
  const found = panel.routes?.find((candidate) => candidate.path === route);

  if (found === undefined) throw new Error(`no route ${route}`);

  return found.handler({
    params: request.params ?? {},
    query: request.query ?? {},
    body: undefined,
  });
}

describe("the panel", () => {
  it("is a devtools panel with a view module, a style asset and the default export", async () => {
    const { panel } = await shopPanel();

    expect(grimoireDevtoolsPanelDefault).toBe(grimoireDevtoolsPanel);
    expect(panel.id).toBe("grimoire");
    expect(panel.title).toBe("Grimoire");
    expect(String(panel.view)).toMatch(/ui\/grimoire-view\.js$/);
    expect(Object.keys(panel.assets ?? {})).toEqual(["grimoire.css"]);
    expect(panel.routes?.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        "/summary",
        "/search",
        "/file",
        "/features/:feature",
        "/flows/:feature/:flow",
        "/check",
        "/graph/modules",
      ]),
    );
    expect(readFileSync(new URL(panel.view), "utf8")).toContain("export default renderGrimoire;");
  });

  it("answers the summary, lists and reports from the snapshot without booting the app", async () => {
    const { panel, adapter } = await shopPanel();
    const summary = await call(panel, "/summary");

    expect(summary.features.features.map((feature: { id: string }) => feature.id)).toEqual([
      "auth",
      "catalog",
      "orders",
    ]);
    expect(summary.book.files).toBeGreaterThan(10);
    expect(summary.counts).toEqual(
      expect.objectContaining({ errors: expect.any(Number), warnings: expect.any(Number) }),
    );
    expect((await call(panel, "/apps")).apps.map((app: { id: string }) => app.id).sort()).toEqual([
      "mobile",
      "web-admin",
      "web-client",
    ]);
    expect(
      (await call(panel, "/tasks")).open.map((task: { id: string }) => task.id).sort(),
    ).toEqual(["T-014", "T-015"]);
    expect(
      (await call(panel, "/releases")).releases.map(
        (release: { release: string }) => release.release,
      ),
    ).toContain("1.0.0");
    expect((await call(panel, "/check")).findings).toBeInstanceOf(Array);
    expect(adapter.calls.routes).toBe(0);
  });

  it("answers per-item questions through scry", async () => {
    const { panel } = await shopPanel();
    const flow = await call(panel, "/flows/:feature/:flow", {
      params: { feature: "catalog", flow: "new-arrivals" },
    });
    const feature = await call(panel, "/features/:feature", { params: { feature: "catalog" } });
    const search = await call(panel, "/search", { query: { q: "arrivals", limit: "5" } });
    const file = await call(panel, "/file", { query: { path: "src/app/catalog/routes.ts" } });

    expect(flow.bookmap.criteria.map((criterion: { id: string }) => criterion.id)).toEqual([
      "AC-1",
      "AC-2",
      "AC-3",
    ]);
    expect(feature.readme.id.value).toBe("catalog");
    expect(search.hits.length).toBeGreaterThan(0);
    expect(search.hits.length).toBeLessThanOrEqual(5);
    expect(search.hits.map((hit: { id: string }) => hit.id)).toContain("catalog/new-arrivals");
    expect(file.entry.file).toBe("src/app/catalog/routes.ts");
  });

  it("answers a page with its layout and blocks, by id or by route", async () => {
    const { panel } = await shopPanel();
    const byId = await call(panel, "/apps/:app/pages/:page", {
      params: { app: "web-client", page: "home" },
    });
    const byRoute = await call(panel, "/apps/:app/pages/:page", {
      params: { app: "web-client", page: "/" },
    });

    expect(byId.page.blocks.map((block: { block: string }) => block.block)).toContain(
      "New arrivals",
    );
    expect(byRoute.page.id).toBe("home");
    expect(byId.layout.id).toBe("site");
  });

  it("answers with a status for what does not exist or what was not asked", async () => {
    const { panel } = await shopPanel();
    const status = async (route: string, request: Parameters<typeof call>[2] = {}) =>
      call(panel, route, request).then(
        () => 200,
        (error: { statusCode?: number }) => error.statusCode,
      );

    expect(await status("/features/:feature", { params: { feature: "nope" } })).toBe(404);
    expect(
      await status("/flows/:feature/:flow", { params: { feature: "catalog", flow: "nope" } }),
    ).toBe(404);
    expect(await status("/file", { query: { path: "src/none.ts" } })).toBe(404);
    expect(await status("/file")).toBe(400);
    expect(await status("/releases/:release", { params: { release: "9.9.9" } })).toBe(404);
    expect(
      await status("/apps/:app/pages/:page", { params: { app: "web-client", page: "nope" } }),
    ).toBe(404);
    expect(await status("/graph/file", { query: { path: "src/none.ts" } })).toBe(404);
  });

  it("returns small graphs: a file's neighbours, a feature, a page and module coupling", async () => {
    const { panel } = await shopPanel();
    const file = await call(panel, "/graph/file", { query: { path: "src/app/catalog/routes.ts" } });
    const feature = await call(panel, "/graph/feature/:feature", {
      params: { feature: "catalog" },
    });
    const page = await call(panel, "/graph/page", { query: { app: "web-client", page: "home" } });
    const modules = await call(panel, "/graph/modules");

    for (const graph of [file, feature, page, modules]) {
      const ids = new Set(graph.nodes.map((node: { id: string }) => node.id));

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.nodes.length).toBeLessThanOrEqual(60);
      expect(ids.size).toBe(graph.nodes.length);
      for (const edge of graph.edges) {
        expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
      }
    }

    expect(file.nodes[0]).toEqual({
      id: "file:src/app/catalog/routes.ts",
      label: "catalog/routes.ts",
      type: "center",
    });
    expect(file.edges.some((edge: { type: string }) => edge.type === "imports")).toBe(true);
    expect(feature.nodes.map((node: { id: string }) => node.id)).toEqual(
      expect.arrayContaining(["feature:catalog", "flow:catalog/new-arrivals"]),
    );
    expect(page.nodes.map((node: { id: string }) => node.id)).toEqual(
      expect.arrayContaining([
        "page:web-client/home",
        "block:web-client/home/New arrivals",
        "flow:catalog/new-arrivals",
      ]),
    );
  });

  it("opens the snapshot again when the written files change", async () => {
    const { panel, root } = await shopPanel();

    expect((await call(panel, "/tasks")).open).toHaveLength(2);
    rmSync(path.join(root, "grimoire", "tasks", "open", "T-015-double-order.md"));

    expect((await call(panel, "/tasks")).open.map((task: { id: string }) => task.id)).toEqual([
      "T-014",
    ]);
  });
});

describe("the panel with no features written (book only)", () => {
  it("serves the book, search and graphs, and 404s the written items", async () => {
    const { panel } = await shopPanel({ written: false });
    const summary = await call(panel, "/summary");
    const search = await call(panel, "/search", { query: { q: "routes" } });

    expect(summary.features.features).toEqual([]);
    expect(summary.written).toBe(false);
    expect(summary.book.files).toBeGreaterThan(10);
    expect((await call(panel, "/apps")).apps).toEqual([]);
    expect((await call(panel, "/tasks")).open).toEqual([]);
    expect(search.hits.some((hit: { type: string }) => hit.type === "file")).toBe(true);
    expect((await call(panel, "/graph/modules")).nodes.length).toBeGreaterThan(1);
    await expect(
      call(panel, "/features/:feature", { params: { feature: "catalog" } }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

/** Run the exported page's inline module in a vm with a small document; returns the root node after rendering. */
async function openExportedPage(html: string, hash = "") {
  const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
  const json =
    /<script type="application\/json" id="grimoire-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
    "";
  const rootNode = new FakeNode("main");
  const helpers = fakeHelpers();
  const listeners: Record<string, (() => unknown)[]> = {};
  const location = { hash };
  const context = createContext({
    location,
    URLSearchParams,
    Object,
    Array,
    Number,
    JSON,
    Error,
    Promise,
    document: {
      getElementById: (id: string) => (id === "grimoire-data" ? { textContent: json } : rootNode),
      createElement: (tag: string) => helpers.el(tag),
      createElementNS: (_namespace: string, tag: string) => helpers.svg(tag),
    },
    window: {
      addEventListener: (type: string, listener: () => unknown) =>
        (listeners[type] ??= []).push(listener),
    },
  });

  runInContext(`(async () => {${script.replace(/^\s*export .*$/gm, "")}})()`, context);
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    root: rootNode,
    goTo: async (next: string) => {
      location.hash = next;
      for (const listener of listeners.hashchange ?? []) await listener();
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

describe("exportGrimoireSite", () => {
  it("writes one self-contained index.html under grimoire/book/site by default", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await openGrimoire(copy.root, adapter, { routes: "fresh" });
    const outDir = await exportGrimoireSite(copy.root, { adapter });
    const html = copy.read(`${outDir}/index.html`);

    expect(outDir).toBe("grimoire/book/site");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // Self-contained: no external script, style or fetch of data files.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toContain("</script></script>");
    // The view, the loader and the data are inline.
    expect(html).toContain("async function renderGrimoire");
    expect(html).toContain("function grimoireStaticApi");
    expect(html).not.toContain("export default");
    const data = JSON.parse(/id="grimoire-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}");

    expect(Object.keys(data.routes)).toEqual(
      expect.arrayContaining([
        "summary",
        "apps",
        "tasks",
        "releases",
        "check",
        "graph/modules",
        "features/catalog",
        "flows/catalog/new-arrivals",
        "graph/feature/catalog",
        "releases/1.0.0",
      ]),
    );
    expect(data.search.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["catalog/new-arrivals", "T-014"]),
    );
    expect(Object.keys(data.files)).toContain("src/app/catalog/routes.ts");
    // The book writer leaves the folder alone on the next run.
    await openGrimoire(copy.root, createShopAdapter(), { routes: "cached" });
    expect(copy.read(`${outDir}/index.html`)).toBe(html);
  });

  it("honours outDir, escapes data inside the page and renders offline", async () => {
    copy = copyFixture();
    copy.replace("grimoire/tasks/open/T-014-wishlist.md", "# ", "# </script><b>x</b> ");
    const adapter = createShopAdapter();

    await openGrimoire(copy.root, adapter, { routes: "fresh" });
    const outDir = await exportGrimoireSite(copy.root, { adapter, outDir: "out/grimoire-site" });
    const html = copy.read(`${outDir}/index.html`);

    expect(outDir).toBe("out/grimoire-site");
    expect(html.match(/<\/script>/g)).toHaveLength(2);

    const page = await openExportedPage(html);

    expect(page.root.text).toContain("Features");
    expect(page.root.links).toContain("#grimoire/feature/catalog");

    await page.goTo("#grimoire/flow/catalog/new-arrivals");
    expect(page.root.text).toContain("Acceptance criteria");
    expect(page.root.text).toContain("AC-1");

    await page.goTo("#grimoire/tasks");
    expect(page.root.find("b")).toHaveLength(0);
    expect(page.root.text).toContain("</script><b>x</b>");

    await page.goTo("#grimoire/modules");
    expect(page.root.find("svg")).toHaveLength(1);

    await page.goTo("#grimoire/file/src%2Fapp%2Fcatalog%2Froutes.ts");
    expect(page.root.text).toContain("src/app/catalog/routes.ts");
  });

  it("exports a book-only project", async () => {
    copy = copyFixture();
    rmSync(path.join(copy.root, "grimoire"), { recursive: true, force: true });
    const adapter = createShopAdapter();
    const outDir = await exportGrimoireSite(copy.root, { adapter });
    const page = await openExportedPage(copy.read(`${outDir}/index.html`));

    expect(page.root.text).toContain("No features are written yet.");
  });
});
