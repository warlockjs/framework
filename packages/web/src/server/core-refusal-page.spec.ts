/**
 * A core-level refusal (a path-traversal 403 on the public mount, a malformed
 * URL) reaches the page host's catch-all. A document request gets the site's
 * page, or the framework fallback; an API request keeps JSON.
 */
import type { HttpContext } from "@warlock.js/core";
import { createElement, type ReactNode } from "react";
import { publishLocaleRouting, resetLocaleRouting } from "../routing/locale-routing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerErrorPageProps } from "../props";
import { createRefusalPageRenderer } from "./core-refusal-page";
import type { ErrorPageModule } from "./error-page";
import { composeErrorPageLoader } from "./error-page";
import { createNotFoundRouteHandler } from "./not-found-page";
import { resetServerErrorReportingStateForTests } from "./report-server-error";

const disclosure = vi.hoisted(() => ({ details: true }));

vi.mock("./error-disclosure", () => ({ discloseErrorDetails: () => disclosure.details }));

const REFUSAL_STATUS = Symbol.for("warlock.http.refusal-status");

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

type Sent = { kind: "json" | "html"; status: number | undefined; body: unknown };

function context(options: { refused?: number; accept?: string; method?: string; path?: string }) {
  const sent: Sent[] = [];
  const request = {
    id: "req-1",
    method: options.method ?? "GET",
    path: options.path ?? "/public/../x",
    locale: "en",
    nonce: undefined,
    baseRequest: options.refused === undefined ? {} : { [REFUSAL_STATUS]: options.refused },
    header: (name: string) => (name === "accept" ? options.accept : undefined),
  };
  const response = {
    header: vi.fn(),
    headers: vi.fn(),
    setContentType: vi.fn(),
    send: vi.fn(async (body: unknown, status?: number) => {
      sent.push({ kind: "json", status, body });
    }),
    html: vi.fn(async (body: string, status?: number) => {
      sent.push({ kind: "html", status, body });
    }),
  };

  return { http: { request, response } as unknown as HttpContext, sent, response };
}

const forbiddenModule = (): ErrorPageModule => ({
  default: (props: ServerErrorPageProps) =>
    createElement("main", { id: "site-forbidden" }, `site forbidden ${props.status}`),
});

beforeEach(() => {
  resetServerErrorReportingStateForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLocaleRouting();
  disclosure.details = true;
});

describe("core-level refusals on a page host", () => {
  it("renders the site's forbidden page, with the refused status, for an HTML request", async () => {
    const renderRefusal = createRefusalPageRenderer({
      name: "warlock.not-found",
      loadErrorPage: composeErrorPageLoader({ forbidden: async () => forbiddenModule() }),
    });
    const handler = createNotFoundRouteHandler({ renderRefusal });
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await handler(http);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("html");
    expect(sent[0]?.status).toBe(403);
    expect(String(sent[0]?.body)).toContain("site forbidden 403");
  });

  it("renders the framework fallback page when the site ships no forbidden page", async () => {
    const renderRefusal = createRefusalPageRenderer({ name: "warlock.not-found" });
    const handler = createNotFoundRouteHandler({ renderRefusal });
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await handler(http);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("html");
    expect(sent[0]?.status).toBe(403);
    expect(String(sent[0]?.body)).toContain("<html");
    expect(String(sent[0]?.body)).not.toContain('{"');
  });

  it("falls back to the framework document when no renderer is wired", async () => {
    const handler = createNotFoundRouteHandler({});
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await handler(http);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("html");
    expect(sent[0]?.status).toBe(403);
    expect(String(sent[0]?.body)).toContain("<h1>403</h1>");
  });

  it("keeps JSON for a request that does not ask for a document", async () => {
    const renderRefusal = vi.fn();
    const handler = createNotFoundRouteHandler({ renderRefusal });
    const { http, sent } = context({ refused: 403, accept: "application/json" });

    await handler(http);

    expect(renderRefusal).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("json");
    expect(sent[0]?.status).toBe(403);
  });

  it("keeps JSON for a bare fetch() and for a non-GET method", async () => {
    const renderRefusal = vi.fn();
    const handler = createNotFoundRouteHandler({ renderRefusal });
    const fetched = context({ refused: 400, accept: "*/*" });
    const posted = context({ refused: 403, accept: BROWSER_ACCEPT, method: "POST" });

    await handler(fetched.http);
    await handler(posted.http);

    expect(renderRefusal).not.toHaveBeenCalled();
    expect(fetched.sent[0]).toMatchObject({ kind: "json", status: 400 });
    expect(posted.sent[0]).toMatchObject({ kind: "json", status: 403 });
  });

  it("an ordinary unmatched URL is still a 404, not a refusal", async () => {
    const handler = createNotFoundRouteHandler({ renderRefusal: vi.fn() });
    const { http, sent } = context({ accept: "application/json" });

    await handler(http);

    expect(sent[0]).toMatchObject({ kind: "json", status: 404 });
  });
});

describe("what a refusal page receives", () => {
  const prefixed = {
    strategy: "prefix-except-default",
    codes: ["en", "ar"],
    defaultLocale: "en",
  } as const;

  it("answers in the locale the URL prefix names, not the one core resolved", async () => {
    publishLocaleRouting(prefixed);
    const renderRefusal = createRefusalPageRenderer({
      name: "warlock.not-found",
      loadErrorPage: async () => ({
        default: () => createElement("main", null, "refused"),
      }),
    });
    const { http, sent } = context({
      refused: 403,
      accept: BROWSER_ACCEPT,
      path: "/ar/public/../x",
    });

    await createNotFoundRouteHandler({ renderRefusal })(http);

    expect(http.request.locale).toBe("ar");
    expect(sent[0]?.status).toBe(403);
    expect(String(sent[0]?.body)).toContain('lang="ar"');
  });

  it("keeps the resolved locale when the first segment is not a locale code", async () => {
    publishLocaleRouting(prefixed);
    const renderRefusal = createRefusalPageRenderer({ name: "warlock.not-found" });
    const { http } = context({ refused: 403, accept: BROWSER_ACCEPT, path: "/public/../x" });

    await createNotFoundRouteHandler({ renderRefusal })(http);

    expect(http.request.locale).toBe("en");
  });

  it("hands the site's page the request id as the error code in production", async () => {
    disclosure.details = false;
    const renderRefusal = createRefusalPageRenderer({
      name: "warlock.not-found",
      loadErrorPage: async () => ({
        default: ({ error }: ServerErrorPageProps) =>
          createElement("main", null, `code ${(error as { errorCode?: string }).errorCode}`),
      }),
    });
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await createNotFoundRouteHandler({ renderRefusal })(http);

    expect(String(sent[0]?.body)).toContain("code req-1");
  });

  it("renders inside the site's root and layouts when they load", async () => {
    const Shell = ({ children }: { children?: ReactNode }) =>
      createElement(
        "html",
        null,
        createElement("body", null, createElement("header", null, "site header"), children),
      );
    const Layout = ({ children }: { children?: ReactNode }) =>
      createElement("div", { id: "layout" }, children);
    const renderRefusal = createRefusalPageRenderer({
      name: "warlock.not-found",
      loadErrorPage: composeErrorPageLoader({ forbidden: async () => forbiddenModule() }),
      loadShell: async () => ({ app: { default: Shell }, layouts: [{ default: Layout }] }),
    });
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await createNotFoundRouteHandler({ renderRefusal })(http);

    const body = String(sent[0]?.body);

    expect(body).toContain("site header");
    expect(body).toContain('<div id="layout"><main id="site-forbidden">');
    expect(sent[0]?.status).toBe(403);
  });

  it("falls back to the framework document when the root fails to render", async () => {
    const Broken = (): never => {
      throw new Error("root exploded");
    };
    const renderRefusal = createRefusalPageRenderer({
      name: "warlock.not-found",
      loadErrorPage: composeErrorPageLoader({ forbidden: async () => forbiddenModule() }),
      loadShell: async () => ({ app: { default: Broken } }),
    });
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await createNotFoundRouteHandler({ renderRefusal })(http);

    expect(String(sent[0]?.body)).toContain("site forbidden 403");
    expect(sent[0]?.status).toBe(403);
  });

  it("falls back to the framework document when the shell does not load", async () => {
    const renderRefusal = createRefusalPageRenderer({
      name: "warlock.not-found",
      loadErrorPage: composeErrorPageLoader({ forbidden: async () => forbiddenModule() }),
      loadShell: async () => {
        throw new Error("cannot load root");
      },
    });
    const { http, sent } = context({ refused: 403, accept: BROWSER_ACCEPT });

    await createNotFoundRouteHandler({ renderRefusal })(http);

    expect(String(sent[0]?.body)).toContain("site forbidden 403");
  });
});
