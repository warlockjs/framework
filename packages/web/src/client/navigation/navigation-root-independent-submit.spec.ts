// @vitest-environment jsdom
import { act, createElement } from "react";
import { stringify } from "devalue";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import { currentNavigator } from "../../routing/navigator";
import { submitAction } from "./action-submitter";
import { readNavigationPending } from "./navigation-pending-store";
import { NavigationRoot } from "./navigation-root";
import { resetScrollPositions } from "./scroll-positions";
import { resetManualScrollRestorationInstalled } from "./scroll-restoration";

/**
 * Review fixes for `<Form independent>` (WR-013) against the REAL navigation
 * runtime: a result for the page the user left is never drawn over the page
 * they reached, and an independent write never strands another operation's
 * pending commit (which left `useIsNavigating()` stuck true).
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

type Gate = { open: () => void; opened: Promise<void> };

function makeGate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, opened };
}

/** One gated response per `METHOD path`, each answering a page payload. */
function stubFetch(pages: Record<string, HydrationDocumentPayloadSource>): Record<string, Gate> {
  const gates: Record<string, Gate> = {};

  for (const key of Object.keys(pages)) gates[key] = makeGate();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      const payload = pages[key];

      if (payload === undefined) throw new Error(`no stub for ${key}`);

      await gates[key]!.opened;

      const headers = new Headers();

      headers.set("content-type", "application/json; charset=utf-8");

      return {
        ok: true,
        status: 200,
        headers,
        url: url.href,
        text: async () => stringify(payload),
      };
    }),
  );

  return gates;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
  window.history.replaceState(null, "", "/run");
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
  resetScrollPositions();
  resetManualScrollRestorationInstalled();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(NavigationRoot, {
        pages: [],
        initialPayload: payloadOf("page.run"),
        initialTree: createElement("div", { "data-testid": "page" }, "page.run"),
        buildTree: async (_pages, payload) =>
          createElement("div", { "data-testid": "page" }, payload.name),
      }),
    );
  });
}

function pageText(): string | null | undefined {
  return container.querySelector('[data-testid="page"]')?.textContent;
}

describe("NavigationRoot — independent submissions", () => {
  it("drops a result that arrives after a navigation already in flight has committed", async () => {
    const gates = stubFetch({
      "GET /other": payloadOf("page.other"),
      "POST /run": payloadOf("page.run.cancelled"),
    });

    await mount();

    // The navigation claims its ticket BEFORE the independent submit starts.
    act(() => {
      currentNavigator()?.("/other");
    });
    await flush();

    let outcome: unknown;
    const pending = submitAction("/run", new FormData(), { independent: true }).then((value) => {
      outcome = value;
    });

    await flush();

    gates["GET /other"]!.open();
    await flush();
    expect(pageText()).toBe("page.other");

    gates["POST /run"]!.open();
    await act(async () => {
      await pending;
    });

    expect(outcome).toEqual({ type: "dropped" });
    expect(pageText()).toBe("page.other");
    expect(window.location.pathname).toBe("/other");
    expect(readNavigationPending()).toBe(false);
  });

  it("still applies its result when nothing moved the page", async () => {
    const gates = stubFetch({ "POST /run": payloadOf("page.run.cancelled") });

    await mount();

    const pending = submitAction("/run", new FormData(), { independent: true });

    gates["POST /run"]!.open();

    let outcome: unknown;

    await act(async () => {
      outcome = await pending;
    });

    expect(outcome).toEqual({ type: "success" });
    expect(pageText()).toBe("page.run.cancelled");
  });

  it("never leaves an overtaken operation's commit pending", async () => {
    const gates = stubFetch({
      "GET /other": payloadOf("page.other"),
      "GET /third": payloadOf("page.third"),
    });

    await mount();

    act(() => {
      currentNavigator()?.("/other");
    });
    act(() => {
      currentNavigator()?.("/third");
    });

    gates["GET /other"]!.open();
    gates["GET /third"]!.open();
    await flush();
    await flush();

    expect(pageText()).toBe("page.third");
    expect(readNavigationPending()).toBe(false);
  });
});
