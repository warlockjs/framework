// @vitest-environment jsdom
import { act, createElement } from "react";
import { stringify } from "devalue";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import { currentNavigator } from "../../routing/navigator";
import { routerEvents } from "../../routing/router-events";
import { navigateTo } from "./verbs";
import { NavigationRoot } from "./navigation-root";
import { resetScrollPositions } from "./scroll-positions";
import { resetManualScrollRestorationInstalled } from "./scroll-restoration";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function payloadOf(name: string): HydrationDocumentPayloadSource {
  return {
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    name,
    locale: "en",
    translations: {},
  };
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), window.location.href);
    const headers = new Headers();

    headers.set("content-type", "application/json; charset=utf-8");

    return {
      ok: true,
      status: 200,
      headers,
      url: url.href,
      text: async () => stringify(payloadOf(`page${url.pathname.replace("/", ".")}`)),
    };
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index++) await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;
const stops: Array<() => void> = [];

beforeEach(async () => {
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
  window.history.replaceState(null, "", "/a");
  vi.stubGlobal("scrollTo", vi.fn());

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(NavigationRoot, {
        pages: [],
        initialPayload: payloadOf("page.a"),
        initialTree: createElement("div", { "data-testid": "page" }, "page.a"),
        buildTree: async (_pages, payload) =>
          createElement("div", { "data-testid": "page" }, payload.name),
      }),
    );
  });
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
});

const pageText = (): string | null | undefined =>
  container.querySelector('[data-testid="page"]')?.textContent;

describe("NavigationRoot — before-navigate guards", () => {
  it("cancels a navigateTo() when a listener answers false, with the source named", async () => {
    const fetchMock = stubFetch();
    const listener = vi.fn(() => false as const);

    stops.push(routerEvents.onBeforeNavigate(listener));

    act(() => {
      navigateTo("/b");
    });
    await flush();

    expect(listener).toHaveBeenCalledWith({
      to: "/b",
      from: expect.stringContaining("/a"),
      type: "navigate",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pageText()).toBe("page.a");
  });

  it("reports a link source and lets the navigation go ahead on a promised true", async () => {
    stubFetch();
    const listener = vi.fn(async () => true);

    stops.push(routerEvents.onBeforeNavigate(listener));

    act(() => {
      currentNavigator()?.("/b", { source: "link" });
    });
    await flush();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "link" }));
    expect(pageText()).toBe("page.b");
  });

  it("does not ask about a jump to a fragment of the current page", async () => {
    const listener = vi.fn(() => false as const);

    stops.push(routerEvents.onBeforeNavigate(listener));

    act(() => {
      currentNavigator()?.("/a#top");
    });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("restores the previous URL when Back is cancelled, without re-rendering", async () => {
    const fetchMock = stubFetch();

    stops.push(routerEvents.onBeforeNavigate(() => false));

    // The browser has already moved the address bar when popstate fires.
    window.history.pushState(null, "", "/c");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await flush();

    expect(window.location.pathname).toBe("/a");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pageText()).toBe("page.a");
  });
});
