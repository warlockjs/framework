// @vitest-environment jsdom
import { stringify } from "devalue";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Form } from "../../components/form";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import { currentNavigator } from "../../routing/navigator";
import { configureLivePageData, type LivePageSocket } from "./live-page-data";
import { NavigationRoot } from "./navigation-root";
import { hasDirtyForms } from "./dirty-form-store";
import { resetScrollPositions } from "./scroll-positions";
import { resetManualScrollRestorationInstalled } from "./scroll-restoration";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const listeners = new Map<string, (payload?: unknown) => void>();
const socket: LivePageSocket = {
  connected: true,
  on: (event, listener) => listeners.set(event, listener),
  off: (event) => listeners.delete(event),
};
function invalidate() {
  listeners.get("warlock:page-invalidated")?.({ tags: ["products"] });
}
function payload(name = "products", value = "fresh"): HydrationDocumentPayloadSource {
  return {
    appData: {},
    layoutData: {},
    pageData: value,
    shared: {},
    name,
    locale: "en",
    translations: {},
    live: { tags: [name] },
  };
}
function tree(data: HydrationDocumentPayloadSource) {
  return createElement(
    "main",
    null,
    createElement("p", null, String(data.pageData)),
    createElement(Form, null, createElement("input", { name: "title", defaultValue: "original" })),
  );
}
function response(data: HydrationDocumentPayloadSource, url: string) {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => stringify(data),
  };
}
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
  window.history.replaceState(null, "", "/products");
  vi.stubGlobal("scrollTo", vi.fn());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  configureLivePageData({ socket });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  configureLivePageData({});
  listeners.clear();
  vi.unstubAllGlobals();
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
});
async function mount() {
  const initial = payload("products", "initial");
  await act(async () =>
    root.render(
      createElement(NavigationRoot, {
        pages: [],
        initialPayload: initial,
        initialTree: tree(initial),
        buildTree: async (_pages, data) => tree(data),
      }),
    ),
  );
}
function edit(value: string) {
  const input = host.querySelector("input");
  if (!input) throw new Error("Missing form input");
  input.value = value;
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("live page loader refresh", () => {
  it("fetches fresh loader data through the router and leaves the URL unchanged", async () => {
    const fetch = vi.fn(async (url: string) => response(payload(), url));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await act(async () => invalidate());
    expect(host.querySelector("p")?.textContent).toBe("fresh");
    expect(window.location.pathname).toBe("/products");
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ "x-warlock-live": "1" }),
      }),
    );
  });

  it("waits for unsent edits to revert, and resumes after a native reset", async () => {
    const fetch = vi.fn(async (url: string) => response(payload(), url));
    vi.stubGlobal("fetch", fetch);
    await mount();
    edit("unsent");
    await act(async () => invalidate());
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => edit("original"));
    expect(host.querySelector("p")?.textContent).toBe("fresh");
    edit("another edit");
    await act(async () => invalidate());
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector("form")?.reset());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hasDirtyForms()).toBe(false);
  });

  it("drops a live result if input becomes dirty while loaders run", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await gate;
        return response(payload(), url);
      }),
    );
    await mount();
    act(() => invalidate());
    edit("keep this draft");
    await act(async () => release());
    expect(host.querySelector("p")?.textContent).toBe("initial");
    expect(host.querySelector("input")?.value).toBe("keep this draft");
  });

  it("never supersedes a pending navigation with a refresh of the old page", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async (url: string) => {
      await gate;
      return response(payload("orders", "orders data"), url);
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    act(() => {
      currentNavigator()?.("/orders");
    });
    act(() => invalidate());
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/orders");
    expect(host.querySelector("p")?.textContent).toBe("orders data");
  });

  it("lets a navigation overtake an already-running live refresh", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (new URL(url).pathname === "/products") {
          await gate;
          return response(payload(), url);
        }
        return response(payload("orders", "orders data"), url);
      }),
    );
    await mount();
    act(() => invalidate());
    await act(async () => {
      currentNavigator()?.("/orders");
    });
    await act(async () => release());
    expect(window.location.pathname).toBe("/orders");
    expect(host.querySelector("p")?.textContent).toBe("orders data");
  });
});
