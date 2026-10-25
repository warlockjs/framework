import { ForbiddenError, Response, UnAuthorizedError, type Request } from "@warlock.js/core";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Head } from "../components/head";
import { Scripts } from "../components/scripts";
import type { ServerErrorPageProps } from "../props";

vi.mock("../shared", () => ({
  enterSharedScope: vi.fn(),
  sealShared: vi.fn(async () => Object.freeze({})),
}));

import { connectPageContext, type PageRouteEntry } from "./execute-page-request";
import {
  composeErrorPageLoader,
  isForbiddenPageStatus,
  type ErrorPageModule,
  type ErrorPageModuleLoader,
} from "./error-page";
import { renderPageRequest, type RenderedPage } from "./render-page";

beforeEach(() => {
  connectPageContext({
    buildStore: (payload) => payload as never,
    getStore: () => undefined,
    run: async (_store, callback) => callback(),
  });
});

function App({ children }: { children?: ReactNode }): ReactNode {
  return createElement(
    "html",
    {},
    createElement("head", {}, createElement(Head)),
    createElement("body", {}, children, createElement(Scripts)),
  );
}

function createHttp() {
  const response = new Response();
  const request = {
    id: "req-forbidden-1",
    nonce: undefined,
    locale: "en",
    params: {},
    query: {},
    setValidatedData() {},
    validated: () => ({}),
  } as unknown as Request;

  return { request, response };
}

function entry(pageMiddleware: () => unknown, pageLoader?: () => unknown): PageRouteEntry {
  return {
    path: "/staff",
    name: "staff",
    triple: {
      app: { default: App },
      layout: {},
      page: {
        route: { path: "/staff" },
        middleware: [pageMiddleware as never],
        ...(pageLoader === undefined ? {} : { loader: pageLoader }),
        default: () => createElement("main", {}, "staff page"),
      },
    },
  };
}

const errorModule = (): ErrorPageModule => ({
  default: (props: ServerErrorPageProps) =>
    createElement("main", { id: "app-error-page" }, `error page status:${props.status}`),
});

const forbiddenModule = (): ErrorPageModule => ({
  default: (props: ServerErrorPageProps) =>
    createElement("main", { id: "app-forbidden-page" }, `forbidden page status:${props.status}`),
});

async function render(
  page: PageRouteEntry,
  loadErrorPage: ErrorPageModuleLoader | undefined,
): Promise<RenderedPage> {
  const { request, response } = createHttp();

  const rendered = await renderPageRequest("/staff", {
    routes: [page],
    createHttp: () => ({ request, response }),
    loadErrorPage,
  });

  if (rendered instanceof Response) throw new Error("unexpected terminal Response");

  return rendered;
}

const refuse = () => {
  throw new ForbiddenError("Forbidden");
};

describe("isForbiddenPageStatus", () => {
  it("is true for 401 and 403 only", () => {
    expect(isForbiddenPageStatus(401)).toBe(true);
    expect(isForbiddenPageStatus(403)).toBe(true);
    expect(isForbiddenPageStatus(404)).toBe(false);
    expect(isForbiddenPageStatus(500)).toBe(false);
    expect(isForbiddenPageStatus(undefined)).toBe(false);
  });
});

describe("composeErrorPageLoader", () => {
  it("is undefined when the app has neither page", () => {
    expect(composeErrorPageLoader({})).toBeUndefined();
  });

  it("serves the forbidden page for 401 and 403 and the error page otherwise", async () => {
    const error = errorModule();
    const forbidden = forbiddenModule();
    const load = composeErrorPageLoader({
      error: async () => error,
      forbidden: async () => forbidden,
    })!;

    expect(await load(401)).toBe(forbidden);
    expect(await load(403)).toBe(forbidden);
    expect(await load(404)).toBe(error);
    expect(await load(500)).toBe(error);
    expect(await load()).toBe(error);
  });

  it("falls back to the error page for a 403 when there is no forbidden page", async () => {
    const error = errorModule();
    const load = composeErrorPageLoader({ error: async () => error })!;

    expect(await load(403)).toBe(error);
  });

  it("answers undefined for a 500 when only the forbidden page exists", async () => {
    const load = composeErrorPageLoader({ forbidden: async () => forbiddenModule() })!;

    expect(await load(500)).toBeUndefined();
    expect(await load(403)).toBeDefined();
  });
});

describe("a refused page request", () => {
  const loader = composeErrorPageLoader({
    error: async () => errorModule(),
    forbidden: async () => forbiddenModule(),
  });

  it("renders the forbidden page with the 403 a failed guard threw", async () => {
    const rendered = await render(entry(refuse), loader);

    expect(rendered.status).toBe(403);
    expect(rendered.html).toContain("forbidden page status:403");
    expect(rendered.html).not.toContain("error page status");
  });

  it("renders the forbidden page with 401 for a thrown UnAuthorizedError", async () => {
    const rendered = await render(
      entry(
        () => undefined,
        () => {
          throw new UnAuthorizedError("Unauthorized");
        },
      ),
      loader,
    );

    expect(rendered.status).toBe(401);
    expect(rendered.html).toContain("forbidden page status:401");
  });

  it("uses the error page for a 403 when the app has no forbidden page", async () => {
    const rendered = await render(
      entry(refuse),
      composeErrorPageLoader({ error: async () => errorModule() }),
    );

    expect(rendered.status).toBe(403);
    expect(rendered.html).toContain("error page status:403");
  });

  it("keeps a 500 on the error page even when a forbidden page exists", async () => {
    const rendered = await render(
      entry(() => {
        throw new Error("database is down");
      }),
      loader,
    );

    expect(rendered.status).toBe(500);
    expect(rendered.html).toContain("error page status:500");
  });

  it("renders a plain framework default with the request id and a way home when the app has no page", async () => {
    const rendered = await render(entry(refuse), undefined);

    expect(rendered.status).toBe(403);
    expect(rendered.html).toContain("You don&#x27;t have access to this page.");
    expect(rendered.html).toContain("Request ID: req-forbidden-1");
    expect(rendered.html).toContain('href="/"');
    expect(rendered.html).toContain("Back to home");
  });

  it("keeps the generic framework default for a 500", async () => {
    const rendered = await render(
      entry(() => {
        throw new Error("database is down");
      }),
      undefined,
    );

    expect(rendered.status).toBe(500);
    expect(rendered.html).toContain("Something went wrong.");
    expect(rendered.html).toContain("Request ID: req-forbidden-1");
  });
});
