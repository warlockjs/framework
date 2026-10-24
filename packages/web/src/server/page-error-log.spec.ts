/**
 * A page that answers 5xx leaves ONE error-level log record that says what
 * threw, where (page file, route, site) and in which phase; a 4xx leaves none.
 * Outside production the same facts are drawn on the error page; production
 * stays generic.
 */
import { BadRequestError, log, Response, setEnvironment, type Request } from "@warlock.js/core";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DefaultApp from "../components/default-app";
import type { ServerErrorPageProps } from "../props";

const { resolvePageMetadata } = vi.hoisted(() => ({
  resolvePageMetadata: vi.fn((): Record<string, unknown> => ({ metadata: {} })),
}));

vi.mock("./resolve-page-metadata", async () => {
  const actual =
    await vi.importActual<typeof import("./resolve-page-metadata")>("./resolve-page-metadata");
  return { ...actual, resolvePageMetadata };
});
vi.mock("../shared", () => ({
  enterSharedScope: vi.fn(),
  sealShared: vi.fn(async () => Object.freeze({})),
}));

import { connectPageContext, type PageRouteEntry } from "./execute-page-request";
import { runInPageErrorScope, tagErrorPhase } from "./page-error-scope";
import { resetServerErrorReportingStateForTests, setServerStackFixer } from "./report-server-error";
import { renderPageFailure, renderPageRequest } from "./render-page";
import type { ErrorPageModule } from "./error-page";

const PAGE_FILE = "/app/src/posts/pages/post.page.tsx";

let logError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetServerErrorReportingStateForTests();
  resolvePageMetadata.mockReset();
  resolvePageMetadata.mockImplementation(() => ({ metadata: {} }));
  connectPageContext({
    buildStore: (payload) => payload as never,
    getStore: () => undefined,
    run: async (_store, callback) => callback(),
  });
  logError = vi.spyOn(log, "error").mockImplementation(() => log);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  setEnvironment("test");
});

afterEach(() => {
  vi.restoreAllMocks();
  setServerStackFixer(undefined);
  setEnvironment("test");
});

function createHttp() {
  const response = new Response();
  const request = {
    nonce: undefined,
    locale: "en",
    id: "req-1",
    method: "GET",
    path: "/posts/7",
  } as unknown as Request;

  return { request, response };
}

function entryWith(page: PageRouteEntry["triple"]["page"]): PageRouteEntry {
  return {
    path: "/posts/:id",
    name: "post",
    triple: {
      app: {
        default: ({ children }: { children?: ReactNode }) =>
          createElement(DefaultApp, { children }),
      },
      layout: {},
      page,
    },
  };
}

async function render(entry: PageRouteEntry, loadErrorPage?: () => Promise<ErrorPageModule>) {
  const { request, response } = createHttp();

  const rendered = await runInPageErrorScope(
    { file: PAGE_FILE, routePath: "/posts/:id", routeName: "post", site: "docs" },
    () =>
      renderPageRequest("/posts/7", {
        routes: [entry],
        createHttp: () => ({ request, response }),
        ...(loadErrorPage === undefined ? {} : { loadErrorPage }),
      }),
  );

  if (rendered instanceof Response) throw new Error("unexpected terminal Response");

  return rendered;
}

/** The single error-level record the request wrote. */
function onlyRecord() {
  expect(logError).toHaveBeenCalledTimes(1);

  const [entry] = logError.mock.calls[0] as [
    { module: string; action: string; message: string; context: Record<string, unknown> },
  ];

  return entry;
}

describe("5xx page failures log one located error record", () => {
  it("logs a loader throw with message, stack, page file, route, site and phase", async () => {
    const boom = new Error("loader exploded");
    const rendered = await render(
      entryWith({
        loader: () => {
          throw boom;
        },
        default: () => createElement("p", null, "ok"),
      }),
    );

    expect(rendered.status).toBe(500);

    const entry = onlyRecord();

    expect(entry.module).toBe("web");
    expect(entry.action).toBe("page.loader");
    expect(entry.message).toContain("loader exploded");
    expect(entry.context).toMatchObject({
      name: "Error",
      message: "loader exploded",
      phase: "loader",
      level: "page",
      file: PAGE_FILE,
      routePath: "/posts/:id",
      site: "docs",
      method: "GET",
      requestId: "req-1",
    });
    expect(entry.context.stack).toContain("loader exploded");
  });

  it("logs a page middleware throw as the middleware phase", async () => {
    await render(
      entryWith({
        middleware: [
          () => {
            throw new Error("middleware exploded");
          },
        ],
        default: () => createElement("p", null, "ok"),
      }),
    );

    expect(onlyRecord().context).toMatchObject({
      phase: "middleware",
      level: "page",
      file: PAGE_FILE,
    });
  });

  it("logs a metadata failure as the metadata phase", async () => {
    resolvePageMetadata.mockImplementation(() => ({
      metadata: {},
      thrown: new Error("metadata exploded"),
      throwingLevel: "page",
    }));

    await render(entryWith({ default: () => createElement("p", null, "ok") }));

    expect(onlyRecord().context).toMatchObject({ phase: "metadata", message: "metadata exploded" });
  });

  it("logs a component that throws while rendering once, as the render phase, even though the escalation re-observes it", async () => {
    const rendered = await render(
      entryWith({
        default: () => {
          throw new Error("render exploded");
        },
      }),
    );

    expect(rendered.status).toBe(500);
    expect(onlyRecord().context).toMatchObject({
      phase: "render",
      message: "render exploded",
      file: PAGE_FILE,
      site: "docs",
    });
  });

  it("logs a failure swallowed into the app error page, not only the page that failed", async () => {
    const rendered = await render(
      entryWith({
        loader: () => {
          throw new Error("swallowed by the error page");
        },
        default: () => createElement("p", null, "ok"),
      }),
      async () => ({ default: () => createElement("h1", null, "We couldn't load this page") }),
    );

    expect(rendered.html).toContain("We couldn&#x27;t load this page");
    expect(onlyRecord().context).toMatchObject({ phase: "loader" });
  });

  it("locates a failure outside the pipeline by the phase its stage tagged", async () => {
    const failure = new Error("could not stream");
    tagErrorPhase(failure, "stream");

    const { request, response } = createHttp();
    const rendered = await renderPageFailure({
      name: "post",
      path: "/posts/:id",
      request,
      response,
      thrown: failure,
      loadErrorPage: undefined,
    });

    expect(rendered.status).toBe(500);
    expect(rendered.html).toContain("data-warlock-dev-error");
    expect(rendered.html).toContain("stream");
    expect(rendered.html).toContain("could not stream");
  });

  it("maps the stack through the registered fixer", async () => {
    setServerStackFixer((error) => {
      error.stack = "Error: mapped\n    at src/posts/pages/post.page.tsx:3:9";
    });

    await render(
      entryWith({
        loader: () => {
          throw new Error("mapped");
        },
        default: () => createElement("p", null, "ok"),
      }),
    );

    expect(onlyRecord().context.stack).toBe(
      "Error: mapped\n    at src/posts/pages/post.page.tsx:3:9",
    );
  });
});

describe("4xx outcomes are not logged as errors", () => {
  it("does not log a loader that throws a 4xx HttpError", async () => {
    const rendered = await render(
      entryWith({
        loader: () => {
          throw new BadRequestError("nope");
        },
        default: () => createElement("p", null, "ok"),
      }),
    );

    expect(rendered.status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });

  it("does not log a loader notFound() short-circuit", async () => {
    const rendered = await render(
      entryWith({
        loader: ({ response }: { response: { notFound(): unknown } }) => response.notFound(),
        default: () => createElement("p", null, "ok"),
      } as never),
    );

    expect(rendered.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("does not log a loader redirect", async () => {
    const rendered = await render(
      entryWith({
        loader: ({ response }: { response: { redirect(url: string): unknown } }) =>
          response.redirect("/login"),
        default: () => createElement("p", null, "ok"),
      } as never),
    );

    expect(rendered.status).toBe(302);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe("the error page in development and production", () => {
  const failing = entryWith({
    loader: () => {
      throw new Error("secret detail");
    },
    default: () => createElement("p", null, "ok"),
  });
  const errorPage = async (): Promise<ErrorPageModule> => ({
    default: (props: ServerErrorPageProps) =>
      createElement("h1", null, props.error instanceof Error ? "We hit an error" : "unknown"),
  });

  it("shows message, stack, page file, phase and site in development and test", async () => {
    const rendered = await render(failing, errorPage);

    expect(rendered.html).toContain("data-warlock-dev-error");
    expect(rendered.html).toContain("Error: secret detail");
    expect(rendered.html).toContain(PAGE_FILE);
    expect(rendered.html).toContain("loader (page)");
    expect(rendered.html).toContain("/posts/:id");
    expect(rendered.html).toContain("docs");
  });

  it("shows the same details on the framework fallback when the app has no error page", async () => {
    const rendered = await render(failing);

    expect(rendered.html).toContain("Something went wrong.");
    expect(rendered.html).toContain("data-warlock-dev-error");
    expect(rendered.html).toContain("secret detail");
  });

  it("stays generic in production: no message, stack, file or panel", async () => {
    setEnvironment("production");

    const rendered = await render(failing, errorPage);

    expect(rendered.html).not.toContain("data-warlock-dev-error");
    expect(rendered.html).not.toContain("secret detail");
    expect(rendered.html).not.toContain(PAGE_FILE);
    expect(rendered.html).not.toContain("page-error-log.spec");

    // The log keeps the full record for the operator.
    expect(onlyRecord().context).toMatchObject({ message: "secret detail", file: PAGE_FILE });
  });

  it("keeps the framework fallback generic in production", async () => {
    setEnvironment("production");

    const rendered = await render(failing);

    expect(rendered.html).toContain("Something went wrong.");
    expect(rendered.html).not.toContain("data-warlock-dev-error");
    expect(rendered.html).not.toContain("secret detail");
  });
});
