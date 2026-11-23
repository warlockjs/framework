import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "../src/collector";
import { resolveDevtoolsOptions } from "../src/options";
import { checkDevtoolsPanels, listPanelInfos } from "../src/panels";
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
        path: "/broken",
        handler: () => {
          throw new Error("The book file is read-only.");
        },
      },
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

  it("answers a server failure with its message and a reference written to the log", async () => {
    const warn = vi.fn();
    const app = mount([testPanel()], { warn });
    const response = await app.inject({ url: "/__warlock/api/test-panel/broken", ...local });
    const body = response.json() as { error: string; ref: string };

    expect(response.statusCode).toBe(500);
    expect(body.error).toBe("The book file is read-only.");
    expect(body.ref).toMatch(/^[A-Z2-9]{8}$/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(body.ref));
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

  it("lists the built-in tabs, then the Processes tab and each registered panel", async () => {
    const response = await mount().inject({ url: "/__warlock/api/panels", ...local });
    const tabs = response.json() as { id: string; title: string; type: string }[];
    const ids = tabs.map((tab) => tab.id);

    expect(response.statusCode).toBe(200);
    expect(ids.slice(0, 3)).toEqual(["requests", "queries", "routes"]);
    expect(tabs.find((tab) => tab.id === "api")).toMatchObject({ type: "built-in" });
    expect(tabs.slice(-2)).toEqual([
      { id: "processes", title: "Processes", type: "package", shareable: false },
      { id: "test-panel", title: "Test <panel>", type: "package", shareable: false },
    ]);
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

  it("rejects two routes on one method and path, which would stop the server from starting", () => {
    const handler = () => 1;

    expect(() =>
      checkDevtoolsPanels([
        testPanel({
          routes: [
            { path: "/items", handler },
            { method: "GET", path: "/items", handler },
          ],
        }),
      ]),
    ).toThrow('Devtools panel "test-panel" lists route GET "/items" twice; keep one.');
    expect(() =>
      checkDevtoolsPanels([
        testPanel({
          routes: [
            { path: "/items", handler },
            { method: "POST", path: "/items", handler },
          ],
        }),
      ]),
    ).not.toThrow();
  });
});

describe("panel files and share declarations", () => {
  const dir = path.join(fixtures, "..");

  it("accepts files with the default extensions, and a file: URL folder", () => {
    const [byPath] = checkDevtoolsPanels([testPanel({ files: { dir } })]);
    const [byUrl] = checkDevtoolsPanels([testPanel({ files: { dir: pathToFileURL(dir) } })]);

    expect(byPath?.files).toEqual({
      dir,
      extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    });
    expect(byUrl?.files?.dir).toBe(dir);
    expect(checkDevtoolsPanels([testPanel()])[0]?.files).toBeNull();
    expect(checkDevtoolsPanels([testPanel()])[0]?.share).toBeNull();
  });

  it("keeps the listed extensions", () => {
    const [panel] = checkDevtoolsPanels([testPanel({ files: { dir, extensions: [".png"] } })]);

    expect(panel?.files?.extensions).toEqual([".png"]);
  });

  it.each([
    ["a relative folder", { dir: "shots" }, "needs files.dir to be an absolute path"],
    ["a missing folder value", { dir: undefined }, "needs files.dir to be an absolute path"],
    ["an empty list", { dir, extensions: [] }, "files.extensions that is not a list"],
    ["an upper-case extension", { dir, extensions: [".PNG"] }, 'files.extensions entry ".PNG"'],
    ["an extension with no dot", { dir, extensions: ["png"] }, 'files.extensions entry "png"'],
    ["an svg", { dir, extensions: [".png", ".svg"] }, 'lists files.extensions entry ".svg"'],
    ["html", { dir, extensions: [".html"] }, 'entry ".html"'],
    ["htm", { dir, extensions: [".htm"] }, 'entry ".htm"'],
    ["js", { dir, extensions: [".js"] }, 'entry ".js"'],
  ])("rejects files with %s, naming the panel and the field", (_name, files, message) => {
    expect(() => checkDevtoolsPanels([testPanel({ files: files as never })])).toThrow(
      new RegExp(`Devtools panel "test-panel".*${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });

  const share = (overrides: Record<string, unknown> = {}) => ({
    view: path.join(fixtures, "view.js"),
    routes: ["/search", "/items/:name"],
    assets: ["graph.js"],
    ...overrides,
  });

  it("accepts a share that points at the panel's GET routes and assets", () => {
    const [panel] = checkDevtoolsPanels([
      testPanel({ files: { dir }, share: share({ files: true }) as never }),
    ]);

    expect(panel?.share).toEqual({
      view: path.join(fixtures, "view.js"),
      routes: ["/search", "/items/:name"],
      assets: ["graph.js"],
      files: true,
    });
    expect(
      checkDevtoolsPanels([
        testPanel({ share: share({ routes: [], assets: undefined }) as never }),
      ])[0]?.share,
    ).toEqual({ view: path.join(fixtures, "view.js"), routes: [], assets: [], files: false });
  });

  it.each([
    ["a relative view", { view: "view.js" }, "needs share.view"],
    [
      "a missing view",
      { view: path.join(fixtures, "absent.js") },
      "share.view module of devtools panel",
    ],
    ["routes that are not a list", { routes: "/search" }, "needs share.routes"],
    ["a route the panel does not have", { routes: ["/nope"] }, 'share.routes entry "/nope"'],
    ["a POST route", { routes: ["/items"] }, 'share.routes entry "/items"'],
    ["an asset the panel does not have", { assets: ["x.css"] }, 'share.assets entry "x.css"'],
    ["files without a folder", { files: true }, "share.files, but the panel has no files folder"],
    ["files that are not a boolean", { files: "yes" }, "share.files to be true or false"],
  ])("rejects a share with %s, naming the panel and the field", (_name, overrides, message) => {
    expect(() => checkDevtoolsPanels([testPanel({ share: share(overrides) as never })])).toThrow(
      new RegExp(
        `Devtools panel "test-panel".*${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });

  it("reserves the id share", () => {
    expect(() => checkDevtoolsPanels([testPanel({ id: "share" })])).toThrow(
      'Devtools panel id "share" is used by the dashboard itself',
    );
  });

  it("marks a panel that declares share as shareable in the tab list", () => {
    const panels = checkDevtoolsPanels([testPanel({ share: share() as never })]);

    expect(listPanelInfos(panels, []).find((tab) => tab.id === "test-panel")?.shareable).toBe(true);
  });
});

describe("a panel's folder of images in development", () => {
  it("serves a listed image and answers 404 for everything else", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "devtools-dev-files-"));

    try {
      writeFileSync(path.join(dir, "a.png"), "png");
      writeFileSync(path.join(dir, "b.svg"), "<svg/>");

      const app = mount([testPanel({ files: { dir } })]);
      const ok = await app.inject({ url: "/__warlock/panels/test-panel/files/a.png", ...local });

      expect(ok.statusCode).toBe(200);
      expect(ok.headers["content-type"]).toBe("image/png");
      expect(ok.headers["x-content-type-options"]).toBe("nosniff");
      expect(ok.headers["cache-control"]).toBe("no-store");
      expect(ok.body).toBe("png");

      for (const url of [
        "/__warlock/panels/test-panel/files/b.svg",
        "/__warlock/panels/test-panel/files/missing.png",
        "/__warlock/panels/test-panel/files/..%2fa.png",
        "/__warlock/panels/nope/files/a.png",
      ]) {
        expect((await app.inject({ url, ...local })).statusCode, url).toBe(404);
      }

      // Not from a non-loopback socket.
      expect(
        (
          await app.inject({
            url: "/__warlock/panels/test-panel/files/a.png",
            remoteAddress: "192.0.2.10",
            headers: { host: "localhost:3000" },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers 404 for a panel with no folder", async () => {
    const app = mount();

    expect(
      (await app.inject({ url: "/__warlock/panels/test-panel/files/a.png", ...local })).statusCode,
    ).toBe(404);
  });
});
