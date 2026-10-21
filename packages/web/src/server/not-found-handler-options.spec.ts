import { describe, expect, it } from "vitest";
import { notFoundPageHandlerOptions } from "./not-found-handler-options";
import { NOT_FOUND_ROUTE_NAME, NOT_FOUND_ROUTE_PATH } from "./not-found-page";
import { resolvePayloadBudget } from "./payload-budget";

describe("notFoundPageHandlerOptions", () => {
  it("assembles the invariant not-found handler options", () => {
    const loadModule = async () => ({});
    const loadErrorPage = async () => ({}) as never;

    const options = notFoundPageHandlerOptions({
      appFile: "src/web/root.tsx",
      pageFile: "src/web/404.page.tsx",
      loadModule,
      hydrationClientModuleUrl: "/hydrate.js",
      loadErrorPage,
      stylesheetUrls: ["/assets/root.css"],
    });

    expect(options.path).toBe(NOT_FOUND_ROUTE_PATH);
    expect(options.name).toBe(NOT_FOUND_ROUTE_NAME);
    expect(options.appFile).toBe("src/web/root.tsx");
    expect(options.pageFile).toBe("src/web/404.page.tsx");
    // No layout, ever — the invariant this route relies on to never run a guard.
    expect(options.layoutFile).toBeUndefined();
    expect(options.loadModule).toBe(loadModule);
    expect(options.hydrationClientModuleUrl).toBe("/hydrate.js");
    expect(options.loadErrorPage).toBe(loadErrorPage);
    expect(options.stylesheetUrls).toEqual(["/assets/root.css"]);
    expect(options.matchPath?.("/anything/missed")).toBe("/anything/missed");
    expect(options.statusForRenderedOk).toBe(404);
    expect(options.skipPageLoader).toBe(true);
    // Never assembled here — each caller adds it, or does not, on its own.
    expect("httpServer" in options).toBe(false);
  });

  it("hands the not-found document the same route names and payload budget as every page", () => {
    const payloadBudget = resolvePayloadBudget({ page: "32kb" });
    const clientApiRouteNames = () => ["orders.show"];

    const options = notFoundPageHandlerOptions({
      appFile: "src/web/root.tsx",
      pageFile: "src/web/404.page.tsx",
      loadModule: async () => ({}),
      stylesheetUrls: [],
      clientApiRouteNames,
      payloadBudget,
    });

    expect(options.clientApiRouteNames).toBe(clientApiRouteNames);
    expect(options.payloadBudget).toBe(payloadBudget);
  });

  it("carries an empty stylesheet chain through untouched", () => {
    const options = notFoundPageHandlerOptions({
      appFile: "src/web/root.tsx",
      pageFile: "src/web/404.page.tsx",
      loadModule: async () => ({}),
      stylesheetUrls: [],
    });

    expect(options.stylesheetUrls).toEqual([]);
    expect(options.hydrationClientModuleUrl).toBeUndefined();
    expect(options.loadErrorPage).toBeUndefined();
  });
});
