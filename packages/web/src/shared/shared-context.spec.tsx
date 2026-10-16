import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sharedContext } from "./shared-context";

/**
 * after an edit under `warlock dev`, a page answered 500 with
 * "useLocale() was called outside Warlock's LocaleProvider" until restart —
 * the provider and the hook came from two evaluations of the module that
 * created the context. These tests evaluate the module twice on purpose.
 */
describe("sharedContext", () => {
  it("returns the same context for the same name", () => {
    expect(sharedContext("SharedContextSpec", 0)).toBe(sharedContext("SharedContextSpec", 0));
  });

  it("keeps separate contexts for separate names", () => {
    expect(sharedContext("SharedContextSpecA", 0)).not.toBe(sharedContext("SharedContextSpecB", 0));
  });

  it("lets a LocaleProvider from one module evaluation satisfy useLocale from another", async () => {
    const first = await import("../localization");
    vi.resetModules();
    const second = await import("../localization");

    // Two real evaluations: the functions are different objects.
    expect(second.useLocale).not.toBe(first.useLocale);

    function ShowLocale() {
      return createElement("span", null, second.useLocale());
    }

    const html = renderToStaticMarkup(
      createElement(first.LocaleProvider, { locale: "ar", children: createElement(ShowLocale) }),
    );

    expect(html).toBe("<span>ar</span>");
  });

  it("shares the document and session contexts across evaluations too", async () => {
    const firstDocument = await import("../components/document-context");
    const firstSession = await import("../session/use-user");
    vi.resetModules();
    const secondDocument = await import("../components/document-context");
    const secondSession = await import("../session/use-user");

    expect(secondDocument.DocumentContext).toBe(firstDocument.DocumentContext);
    expect(secondSession.SessionContext).toBe(firstSession.SessionContext);
  });
});
