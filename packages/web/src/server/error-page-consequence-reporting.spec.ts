/**
 * When the module graph breaks, the first failure is the one to fix and the
 * `useLocale() was called outside Warlock's LocaleProvider` that follows it is
 * a consequence. The log must say so: the ORIGINAL error first, the secondary
 * one marked as its consequence and naming it.
 */
import { Response, type Request } from "@warlock.js/core";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerErrorReportingStateForTests } from "./report-server-error";
import { renderPageFailure } from "./render-page";

const LOCALE_PROVIDER_MESSAGE = /outside Warlock's LocaleProvider/;

const CONTEXT_REGISTRY_SLOT = Symbol.for("warlock.web.reactContexts");

/**
 * A SECOND copy of the localization module with its own `LocaleContext`, which
 * the framework's `LocaleProvider` (the first copy) never fills, and it throws
 * the real error. A plain re-evaluation now shares the first context (see
 * `shared/shared-context.ts`), so the shared registry is hidden while the copy
 * loads — the case a graph that cannot share it at all still produces — and
 * put back afterwards.
 */
async function secondLocaleCopy() {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const registry = holder[CONTEXT_REGISTRY_SLOT];

  delete holder[CONTEXT_REGISTRY_SLOT];
  vi.resetModules();

  try {
    return await import("../localization");
  } finally {
    holder[CONTEXT_REGISTRY_SLOT] = registry;
  }
}

function createHttp() {
  return {
    request: { nonce: undefined, locale: "en", id: "req-1", method: "GET" } as unknown as Request,
    response: new Response(),
  };
}

beforeEach(() => {
  resetServerErrorReportingStateForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderPageFailure — an error page that fails because the first error broke the graph", () => {
  it("marks the LocaleProvider error as a consequence and names the original error as the root cause", async () => {
    const { useLocale } = await secondLocaleCopy();
    const original = new Error("server-only barrel evaluated in the browser graph");
    const { request, response } = createHttp();

    await renderPageFailure({
      name: "dashboard",
      path: "/dashboard",
      request,
      response,
      thrown: original,
      loadErrorPage: async () => ({
        default: () => {
          useLocale();

          return createElement("main", null, "unreachable");
        },
      }),
    });

    const calls = vi.mocked(console.error).mock.calls;
    const errorPageReports = calls.filter(([message]) =>
      String(message).includes("the application error page itself failed"),
    );

    expect(errorPageReports).toHaveLength(1);

    const [message, thrown] = errorPageReports[0] as [string, Error];

    expect(message).toContain("CONSEQUENCE");
    expect(message).toContain("ROOT CAUSE: Error: server-only barrel evaluated in the browser graph");
    expect(thrown.message).toMatch(LOCALE_PROVIDER_MESSAGE);
  });

  it("adds no root-cause wording to the line when the error page was fine", async () => {
    const { request, response } = createHttp();

    await renderPageFailure({
      name: "dashboard",
      path: "/dashboard",
      request,
      response,
      thrown: new Error("boom"),
      loadErrorPage: async () => ({ default: () => createElement("main", null, "Sorry") }),
    });

    expect(console.error).not.toHaveBeenCalled();
  });
});
