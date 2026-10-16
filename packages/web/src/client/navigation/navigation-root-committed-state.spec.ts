// @vitest-environment jsdom
import { act, createElement, startTransition, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import type { RefreshRuntime } from "./refresh";
import { NavigationRoot } from "./navigation-root";

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
