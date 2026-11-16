import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { resolveUiRoot } from "../src/ui-root";

/** Minimal DOM for exercising the shipped UI's panel code without a browser. */
class Element {
  children: Element[] = [];
  textContent = "";
  attributes: Record<string, string> = {};
  className = "";
  namespace?: string;
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  addEventListener() {}
  append(...children: Element[]) {
    this.children.push(...children);
  }
  get text(): string {
    return [this.textContent, ...this.children.map((child) => child.text)].join(" ").trim();
  }
  find(tag: string): Element[] {
    return [
      ...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child.find(tag)),
    ];
  }
}

/** A tab button as the server renders it for a registered panel. */
function panelTab(id: string, title: string) {
  return { dataset: { tab: id, panel: id }, textContent: title, classList: { toggle() {} } };
}

function ui(responses: Record<string, unknown> = {}, hash = "") {
  const source = readFileSync(path.join(resolveUiRoot(), "app.js"), "utf8");
  const fetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => responses[url],
  }));
  const location = { pathname: "/__warlock/", href: `http://localhost/__warlock/${hash}`, hash };
  const context = createContext({
    location,
    document: {
      querySelector: () => new Element("main"),
      querySelectorAll: () => [
        { dataset: { tab: "requests" }, textContent: "Requests", classList: { toggle() {} } },
        panelTab("processes", "Processes"),
        panelTab("book", "Book"),
      ],
      createElement: (tag: string) => new Element(tag),
      createElementNS: (namespace: string, tag: string) =>
        Object.assign(new Element(tag), { namespace }),
      createTextNode: (text: string) => Object.assign(new Element("text"), { textContent: text }),
    },
    fetch,
  });
  runInContext(source.slice(0, source.lastIndexOf("\ntabs.forEach(")), context);
  return {
    context,
    fetch,
    location,
    /** Replaces the dynamic import with `module` (vm scripts cannot import). */
    useModule(module: unknown) {
      context.loadPanelModule = async () => module;
    },
    panelView: (id: string) => runInContext(`panelView(${JSON.stringify(id)})`, context),
  };
}

describe("panel views in the dashboard", () => {
  it("knows the registered panels from their tab buttons", () => {
    const { context } = ui();

    expect(runInContext("[...panelIds]", context)).toEqual(["processes", "book"]);
  });

  it("renders the built-in Processes view module unchanged", async () => {
    const page = ui({ "api/processes": [{ pid: 123, owner: "example-app" }] });
    page.useModule(
      await import(pathToFileURL(path.join(resolveUiRoot(), "panels", "processes.js")).href),
    );

    const view = (await page.panelView("processes")) as Element;

    expect(page.fetch).toHaveBeenCalledWith("api/processes", undefined);
    expect(view.tag).toBe("section");
    expect(view.className).toBe("card detail");
    expect(view.find("h2")[0]?.text).toBe("Processes");
    expect(view.find("button")[0]?.text).toBe("Refresh");
    expect(JSON.parse(view.find("pre")[0]?.textContent ?? "")).toEqual({
      pid: 123,
      owner: "example-app",
    });
  });

  it("shows the Processes empty state", async () => {
    const page = ui({ "api/processes": [] });
    page.useModule(
      await import(pathToFileURL(path.join(resolveUiRoot(), "panels", "processes.js")).href),
    );

    const view = (await page.panelView("processes")) as Element;

    expect(view.text).toContain("No supervised processes. Configure with warlock add process.");
  });

  it("gives a view its data routes, links, route, assets and SVG helper", async () => {
    const page = ui({ "api/book/search?q=user": ["users.ts"] }, "#book/flow/checkout");
    let seen: Record<string, any> = {};
    page.useModule({
      default: async (panel: Record<string, any>) => {
        seen = panel;
        const results = await panel.api("search?q=user");
        panel.root.append(
          panel.el("a", { href: panel.href(`entry/${encodeURIComponent(results[0])}`) }),
          panel.svg("svg", { viewBox: "0 0 10 10" }, [panel.svg("circle", { r: "2" })]),
        );
      },
    });

    const view = (await page.panelView("book")) as Element;

    expect(seen.id).toBe("book");
    expect(seen.route).toBe("flow/checkout");
    expect(seen.asset("book.css")).toBe("panels/book/book.css");
    expect(page.fetch).toHaveBeenCalledWith("api/book/search?q=user", undefined);
    // Nothing returned: the panel's root section is shown.
    expect(view.tag).toBe("section");
    expect(view.attributes["data-panel"]).toBe("book");
    expect(view.find("a")[0]?.attributes.href).toBe("#book/entry/users.ts");
    expect(view.find("svg")[0]?.namespace).toBe("http://www.w3.org/2000/svg");
    expect(view.find("circle")).toHaveLength(1);

    seen.navigate("tasks");
    expect(page.location.hash).toBe("#book/tasks");
  });

  it("resolves every form of a data path under the panel's API", () => {
    const { context } = ui();
    const urls = runInContext(
      `["", "items", "/items/a", "?page=2"].map((p) => panelApiUrl("book", p))`,
      context,
    );

    expect(urls).toEqual(["api/book", "api/book/items", "api/book/items/a", "api/book?page=2"]);
  });

  it("reads no route from another panel's hash", () => {
    const { context } = ui({}, "#processes/x");

    expect(runInContext(`panelRoute("book")`, context)).toBe("");
    expect(runInContext(`hashPanel()`, context)).toBe("processes");
  });

  it("re-renders the open panel when Back leaves its hash, and leaves other tabs alone", () => {
    const { context, location } = ui({}, "#book/items/a");
    const render = vi.fn();
    context.render = render;
    runInContext(`state.tab = "book"`, context);

    location.hash = "";
    runInContext("onHashChange()", context);
    expect(render).toHaveBeenCalledOnce();

    runInContext(`state.tab = "requests"`, context);
    runInContext("onHashChange()", context);
    expect(render).toHaveBeenCalledOnce();

    location.hash = "#book/items/b";
    runInContext("onHashChange()", context);
    expect(runInContext("state.tab", context)).toBe("book");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("names the panel when its view module fails to load or has no default export", async () => {
    const broken = ui();
    broken.context.loadPanelModule = async () => {
      throw new Error("Failed to fetch dynamically imported module");
    };
    await expect(broken.panelView("book")).rejects.toThrow(
      "the Book panel's view module did not load (Failed to fetch dynamically imported module). Check the terminal running warlock dev.",
    );

    const empty = ui();
    empty.useModule({});
    await expect(empty.panelView("book")).rejects.toThrow(
      "the Book panel's view module has no default export function.",
    );
  });
});
