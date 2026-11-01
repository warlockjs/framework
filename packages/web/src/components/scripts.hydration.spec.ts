// @vitest-environment jsdom
import { act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentContext, type DocumentContextValue } from "./document-context";
import { Scripts } from "./scripts";

const value: DocumentContextValue = {
  metadata: undefined,
  nonce: "request-nonce",
  hydrationClientModuleUrl: "/entry.js",
  payload: {
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    name: "account",
    locale: "en",
    translations: {},
  },
} as DocumentContextValue;

function tree() {
  return createElement(DocumentContext.Provider, { value, children: createElement(Scripts, {}) });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Scripts hydration under a Content-Security-Policy header", () => {
  it("does not report a mismatch when the browser hides the nonce value", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree());

    // What a browser does to nonced elements once the response carries a CSP header.
    for (const script of container.querySelectorAll("script[nonce]")) {
      script.setAttribute("nonce", "");
    }

    expect(container.querySelectorAll("script[nonce]").length).toBeGreaterThan(0);

    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recoverable: unknown[] = [];

    await act(async () => {
      hydrateRoot(container, tree(), { onRecoverableError: (error) => recoverable.push(error) });
    });

    const mismatch = errors.mock.calls.filter((call) => String(call[0]).includes("hydrated"));
    expect(mismatch).toEqual([]);
    expect(recoverable).toEqual([]);
  });
});
