import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "../src/collector";
import { resolveDevtoolsOptions } from "../src/options";
import { checkDevtoolsPanels } from "../src/panels";
import { mountDevtoolsRoutes } from "../src/server";
import type { DevtoolsOptions, DevtoolsPanel } from "../src/types";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "test-panel");

function testPanel(overrides: Partial<DevtoolsPanel> = {}): DevtoolsPanel {
  return {
    id: "test-panel",
    title: "Test <panel>",
    view: path.join(fixtures, "view.js"),
    assets: { "graph.js": pathToFileURL(path.join(fixtures, "graph.js")) },
    routes: [
      {
        path: "/search",
        handler: ({ query }) => ({ results: [query.q], query }),
      },
      { path: "/items/:name", handler: ({ params }) => ({ name: params.name }) },
      { method: "POST", path: "/items", handler: ({ body }) => ({ received: body }) },
      { method: "DELETE", path: "/items", handler: () => undefined },
      {
        path: "/missing",
        handler: () => {
          throw Object.assign(new Error("No such entry."), { statusCode: 404 });
        },
      },
    ],
    ...overrides,
  };
}

const servers: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

function mount(
  panels: readonly DevtoolsPanel[] = [testPanel()],
  {
    development = true,
    options: extra = {},
    warn,
  }: { development?: boolean; options?: DevtoolsOptions; warn?: (message: string) => void } = {},
) {
  const app = Fastify();
  const options = resolveDevtoolsOptions(extra);
  mountDevtoolsRoutes(app, {
    collector: createCollector(options),
    options,
    panels,
    isDevelopment: () => development,
    ...(warn ? { warn } : {}),
  });
  servers.push(app);
  return app;
}

const local = { remoteAddress: "127.0.0.1", headers: { host: "localhost:3000" } };

describe("registered panels", () => {
  it("serves a panel's data routes under the devtools API without caching", async () => {
    const app = mount();

    const search = await app.inject({ url: "/__warlock/api/test-panel/search?q=book", ...local });
    expect(search.statusCode).toBe(200);
    expect(search.headers["cache-control"]).toBe("no-store");
    expect(search.json()).toEqual({ results: ["book"], query: { q: "book" } });

    const item = await app.inject({ url: "/__warlock/api/test-panel/items/checkout", ...local });
    expect(item.json()).toEqual({ name: "checkout" });

    const posted = await app.inject({
      method: "POST",
      url: "/__warlock/api/test-panel/items",
      payload: { name: "a" },
      ...local,
    });
    expect(posted.json()).toEqual({ received: { name: "a" } });

    const removed = await app.inject({
      method: "DELETE",
      url: "/__warlock/api/test-panel/items",
      ...local,
    });
    expect(removed.statusCode).toBe(204);
  });

  it("answers a thrown error's status code with its message", async () => {
    const app = mount();
    const response = await app.inject({ url: "/__warlock/api/test-panel/missing", ...local });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "No such entry." });
  });

  it("serves the view module and listed assets, and nothing else", async () => {
    const app = mount();

    const view = await app.inject({ url: "/__warlock/panels/test-panel/view.js", ...local });
    expect(view.statusCode).toBe(200);
    expect(view.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.headers["x-content-type-options"]).toBe("nosniff");
    expect(view.body).toContain("export default async function renderTestPanel");

    const graph = await app.inject({ url: "/__warlock/panels/test-panel/graph.js", ...local });
    expect(graph.statusCode).toBe(200);
    expect(graph.body).toContain("drawBars");

    for (const url of [
      "/__warlock/panels/test-panel/panel.ts",
      "/__warlock/panels/test-panel/..%2Fpanel.ts",
      "/__warlock/panels/test-panel/constructor",
      "/__warlock/panels/unknown/view.js",
    ]) {
      expect((await app.inject({ url, ...local })).statusCode, url).toBe(404);
    }
  });

  it("adds a tab per panel after the built-in Processes tab and before API", async () => {
    const response = await mount().inject({ url: "/__warlock/", ...local });
    const html = response.body;

    expect(html).toContain(
      '<button class="tab" data-tab="processes" data-panel="processes">Processes</button>',
    );
    expect(html).toContain(
      '<button class="tab" data-tab="test-panel" data-panel="test-panel">Test &lt;panel&gt;</button>',
    );
    expect(html.indexOf('data-tab="routes"')).toBeLessThan(html.indexOf('data-tab="processes"'));
    expect(html.indexOf('data-tab="processes"')).toBeLessThan(
      html.indexOf('data-tab="test-panel"'),
    );
    expect(html.indexOf('data-tab="test-panel"')).toBeLessThan(html.indexOf('data-tab="api"'));
    expect(html).not.toContain("devtools:panel-tabs");
  });

  it("serves the built-in Processes view module", async () => {
    const response = await mount([]).inject({
      url: "/__warlock/panels/processes/view.js",
      ...local,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("No supervised processes");
  });
});

describe("registered panels behind the devtools guard", () => {
  const urls = ["/__warlock/api/test-panel/search?q=a", "/__warlock/panels/test-panel/view.js"];

  it.each(urls)("refuses %s from a non-loopback socket", async (url) => {
    const response = await mount().inject({
      url,
      remoteAddress: "192.0.2.10",
      headers: { host: "localhost:3000" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
  });

  it.each(urls)("refuses %s from a foreign origin and says why once", async (url) => {
    const warn = vi.fn();
    const app = mount([testPanel()], { warn });

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.inject({
        url,
        remoteAddress: "127.0.0.1",
        headers: { host: "localhost:3000", origin: "https://attacker.example" },
      });
      expect(response.statusCode).toBe(404);
    }

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('origin "https://attacker.example"');
  });

  it.each(urls)("refuses %s for a host that is not loopback", async (url) => {
    const response = await mount().inject({
      url,
      remoteAddress: "127.0.0.1",
      headers: { host: "evil.example" },
    });

    expect(response.statusCode).toBe(404);
  });

  it.each(urls)("refuses %s when it came through a proxy", async (url) => {
    const response = await mount().inject({
      url,
      remoteAddress: "127.0.0.1",
      headers: { host: "localhost:3000", "x-forwarded-for": "203.0.113.5" },
    });

    expect(response.statusCode).toBe(404);
  });

  it.each(urls)("refuses %s outside development", async (url) => {
    const response = await mount([testPanel()], { development: false }).inject({
      url,
      ...local,
    });

    expect(response.statusCode).toBe(404);
  });

  it("refuses a POST to a panel route from a foreign origin before the handler runs", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const app = mount([testPanel({ routes: [{ method: "POST", path: "/run", handler }] })]);

    const response = await app.inject({
      method: "POST",
      url: "/__warlock/api/test-panel/run",
      remoteAddress: "127.0.0.1",
      headers: { host: "localhost:3000", origin: "http://192.0.2.1:8080" },
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("panel registration checks", () => {
  it("rejects a reused id, naming the panel that has it", () => {
    expect(() => mount([testPanel(), testPanel({ title: "Second" })])).toThrow(
      'Devtools panel id "test-panel" is already registered by the "Test <panel>" panel; each panel needs its own id.',
    );
  });

  it("rejects the built-in Processes id", () => {
    expect(() => mount([testPanel({ id: "processes" })])).toThrow(
      'Devtools panel id "processes" is already registered by the "Processes" panel',
    );
  });

  it.each(["mail", "api", "assets"])("rejects the dashboard's own id %s", (id) => {
    expect(() => checkDevtoolsPanels([testPanel({ id })])).toThrow(
      `Devtools panel id "${id}" is used by the dashboard itself; give the panel another id.`,
    );
  });

  it.each(["Grimoire", "1st", "a/b", "", "a.b"])("rejects the malformed id %j", (id) => {
    expect(() => checkDevtoolsPanels([testPanel({ id })])).toThrow(
      'A devtools panel needs an "id" of lower-case letters, digits and dashes',
    );
  });

  it("rejects a missing title, a relative or missing view, a bad route and a bad asset name", () => {
    expect(() => checkDevtoolsPanels([testPanel({ title: " " })])).toThrow(
      'Devtools panel "test-panel" needs a "title" for its tab.',
    );
    expect(() => checkDevtoolsPanels([testPanel({ view: "view.js" })])).toThrow(
      'Devtools panel "test-panel" needs a "view"',
    );
    expect(() =>
      checkDevtoolsPanels([testPanel({ view: path.join(fixtures, "absent.js") })]),
    ).toThrow('The view module of devtools panel "test-panel" was not found at');
    expect(() =>
      checkDevtoolsPanels([testPanel({ routes: [{ path: "search", handler: () => 1 }] })]),
    ).toThrow('use "" or a path starting with "/"');
    expect(() =>
      checkDevtoolsPanels([
        testPanel({ assets: { "../graph.js": path.join(fixtures, "graph.js") } }),
      ]),
    ).toThrow('has an asset named "../graph.js"');
  });
});
