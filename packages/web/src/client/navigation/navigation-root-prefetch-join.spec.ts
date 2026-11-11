// @vitest-environment jsdom
import { act, createElement } from "react";
import { stringify } from "devalue";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import { currentNavigator } from "../../routing/navigator";
import type { ClientPageEntry, ClientRouteComposition } from "../runtime";
import { NavigationRoot } from "./navigation-root";
import { prefetchPageData, resetPrefetchCache } from "./prefetch";
import { resetScrollPositions } from "./scroll-positions";
import { resetManualScrollRestorationInstalled } from "./scroll-restoration";

/**
 * A click that lands while the hover prefetch for the same URL is still in the
 * air waits for that request instead of sending a second identical one, and
 * the prefetched page's chunk starts loading as soon as its data arrives.
 */

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

/** A `fetch` whose single response is released by the test. */
function stubDeferredFetch(payload: HydrationDocumentPayloadSource): {
  release: () => void;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  const fetchMock = vi.fn(async (input: string | URL) => {
    await released;

    const url = new URL(String(input), window.location.href);

    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
      url: url.href,
      text: async () => stringify(payload),
    };
  });

  vi.stubGlobal("fetch", fetchMock);

  return { release, fetchMock };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index++) await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
  resetPrefetchCache();
  window.history.replaceState(null, "", "/a");

  vi.stubGlobal("scrollTo", vi.fn());

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPrefetchCache();
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
});

async function mount(pages: readonly ClientPageEntry[] = []): Promise<void> {
  await act(async () => {
    root.render(
      createElement(NavigationRoot, {
        pages,
        initialPayload: payloadOf("page.a"),
        initialTree: createElement("div", { "data-testid": "page" }, "a"),
        buildTree: async (_pages, payload) =>
          createElement("div", { "data-testid": "page" }, payload.name),
      }),
    );
  });
}

function pageText(): string | null | undefined {
  return container.querySelector('[data-testid="page"]')?.textContent;
}

describe("NavigationRoot — a click during an in-flight prefetch", () => {
  it("joins the prefetch: one request, and the prefetched payload is rendered", async () => {
    const { release, fetchMock } = stubDeferredFetch(payloadOf("page.b"));
    await mount();

    const prefetch = prefetchPageData("/b");

    act(() => {
      currentNavigator()?.("/b");
    });
    await flush();

    release();
    await prefetch;
    await flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pageText()).toBe("page.b");
    expect(window.location.pathname).toBe("/b");
  });

  it("starts loading the page chunk when the prefetched data arrives", async () => {
    const { release } = stubDeferredFetch(payloadOf("page.b"));
    const load = vi.fn(async () => ({}) as unknown as ClientRouteComposition);
    await mount([{ type: "page", name: "page.b", path: "/b", load }]);

    const prefetch = prefetchPageData("/b");

    expect(load).not.toHaveBeenCalled();

    release();
    await prefetch;
    await flush();

    expect(load).toHaveBeenCalledOnce();
  });
});
