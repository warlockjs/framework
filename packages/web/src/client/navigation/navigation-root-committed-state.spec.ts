// @vitest-environment jsdom
import { act, createElement, startTransition, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import type { RefreshRuntime } from "./refresh";
import { NavigationRoot } from "./navigation-root";
import { reportClientError } from "../report-client-error";

vi.mock("../report-client-error", () => ({ reportClientError: vi.fn() }));

const captured = vi.hoisted(() => ({ runtime: undefined as RefreshRuntime | undefined }));

vi.mock("./refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./refresh")>();
  return {
    ...actual,
    createRefresher(runtime: RefreshRuntime) {
      captured.runtime = runtime;
      return actual.createRefresher(runtime);
    },
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function payload(name: string): HydrationDocumentPayloadSource {
  return {
    name,
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    locale: "en",
    translations: {},
  };
}

it("exposes only the committed page to navigation callbacks while a transition suspends", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pending = new Promise<never>(() => {});
  const attempted = vi.fn();
  function WaitingPage(): never {
    attempted();
    throw pending;
  }
  vi.stubGlobal("scrollTo", vi.fn());
  window.history.replaceState(null, "", "/committed");
  const initial = payload("committed");

  try {
    await act(async () => {
      root.render(
        createElement(
          Suspense,
          { fallback: "loading" },
          createElement(NavigationRoot, {
            pages: [],
            initialPayload: initial,
            initialTree: createElement("span", null, "committed"),
            buildTree: async () => null,
          }),
        ),
      );
    });
    const runtime = captured.runtime!;
    const abandoned = payload("abandoned");
    await act(async () => {
      startTransition(() =>
        runtime.writeCurrent({
          payload: abandoned,
          routeSource: abandoned,
          tree: createElement(WaitingPage),
        }),
      );
    });
    expect(attempted).toHaveBeenCalled();
    expect(container.textContent).toBe("committed");
    expect(runtime.readCurrent().payload).toBe(initial);

    const replacement = payload("replacement");
    await act(async () =>
      runtime.writeCurrent({
        payload: replacement,
        routeSource: replacement,
        tree: createElement("span", null, "replacement"),
      }),
    );
    expect(container.textContent).toBe("replacement");
    expect(runtime.readCurrent().payload).toBe(replacement);
  } finally {
    act(() => root.unmount());
    container.remove();
    captured.runtime = undefined;
    vi.unstubAllGlobals();
  }
});

it("keeps the boundary fallback until a replacement swap commits after an abandoned transition", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pending = new Promise<never>(() => {});
  const attempted = vi.fn();
  function BrokenPage(): never {
    throw new Error("page failed");
  }
  const props = {
    pages: [],
    initialPayload: payload("broken"),
    initialTree: createElement(BrokenPage),
    buildTree: async () => null,
  };
  let setBlocked!: (blocked: boolean) => void;
  function Harness() {
    const [blocked, updateBlocked] = useState(false);
    setBlocked = updateBlocked;
    if (blocked) {
      attempted();
      throw pending;
    }
    return createElement(NavigationRoot, props);
  }
  const render = () =>
    root.render(createElement(Suspense, { fallback: "loading" }, createElement(Harness)));
  vi.mocked(reportClientError).mockClear();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => render());
    const fallback = container.textContent;
    expect(fallback).not.toBe("");
    expect(fallback).not.toBe("loading");
    expect(reportClientError).toHaveBeenCalledTimes(1);
    const runtime = captured.runtime!;
    const abandoned = payload("abandoned");
    await act(async () => {
      startTransition(() => {
        setBlocked(true);
        runtime.writeCurrent({
          payload: abandoned,
          routeSource: abandoned,
          tree: createElement("span", null, "abandoned"),
        });
      });
    });
    expect(attempted).toHaveBeenCalled();
    expect(container.textContent).toBe(fallback);
    expect(container.querySelector("[style*='display: none']")).toBeNull();
    // An urgent unrelated render abandons the suspended page. Its reset signal
    // must not reset the still-committed error boundary or report its error again.
    await act(async () => render());
    expect(container.textContent).toBe(fallback);
    expect(container.querySelector("[style*='display: none']")).toBeNull();
    expect(reportClientError).toHaveBeenCalledTimes(1);

    const replacement = payload("replacement");
    await act(async () => {
      setBlocked(false);
      runtime.writeCurrent({
        payload: replacement,
        routeSource: replacement,
        tree: createElement("span", null, "replacement"),
      });
    });
    expect(container.textContent).toBe("replacement");
    expect(reportClientError).toHaveBeenCalledTimes(1);
    await act(async () =>
      runtime.writeCurrent({
        payload: replacement,
        routeSource: replacement,
        tree: createElement(BrokenPage),
      }),
    );
    expect(container.textContent).toBe(fallback);
    expect(reportClientError).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    container.remove();
    captured.runtime = undefined;
    consoleError.mockRestore();
  }
});
