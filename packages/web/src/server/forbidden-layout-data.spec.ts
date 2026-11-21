import { ForbiddenError, Response, type Request } from "@warlock.js/core";
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

// Reads `data.permissions` like an app layout that renders navigation from its loader.
function Layout({ data, children }: { data?: { permissions: string[] }; children?: ReactNode }) {
  return createElement("div", { id: "layout" }, data!.permissions.join(","), children);
}

function createHttp() {
  const response = new Response();
  const request = {
    id: "req-forbidden-layout",
    nonce: undefined,
    locale: "en",
    params: {},
    query: {},
    setValidatedData() {},
    validated: () => ({}),
  } as unknown as Request;

  return { request, response };
}

const entry: PageRouteEntry = {
  path: "/staff",
  name: "staff",
  triple: {
    app: { default: App },
    layout: { loader: () => ({ permissions: ["read"] }), default: Layout as never },
    page: {
      route: { path: "/staff" },
      middleware: [
        (() => {
          throw new ForbiddenError("Forbidden");
        }) as never,
      ],
      default: () => createElement("main", {}, "staff page"),
    },
  },
};

describe("a forbidden page when the page middleware refuses and the layout has a loader", () => {
  it("renders the forbidden page and never throws inside the layout", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args));
    const { request, response } = createHttp();

    const rendered = (await renderPageRequest("/staff", {
      routes: [entry],
      createHttp: () => ({ request, response }),
      loadErrorPage: async () => ({
        default: (props: ServerErrorPageProps) =>
          createElement("main", { id: "forbidden" }, `forbidden:${props.status}`),
      }),
    })) as RenderedPage;

    spy.mockRestore();

    expect(rendered.status).toBe(403);
    expect(rendered.html).toContain("forbidden:403");
    expect(JSON.stringify(errors)).not.toContain("permissions");
    expect(errors).toEqual([]);
    // The browser reads this marker to leave the layout out of its tree too.
    expect(rendered.html).toContain("layoutSkipped");
    expect(rendered.bundle?.layoutSkipped).toBe(true);
    expect(rendered.html).not.toContain('id="layout"');
  });
});

describe("a page boundary when the page middleware refuses and the layout has a loader", () => {
  it("renders the boundary without the layout and marks the payload", async () => {
    const { request, response } = createHttp();
    const withBoundary: PageRouteEntry = {
      ...entry,
      triple: {
        ...entry.triple,
        page: {
          ...entry.triple.page,
          ErrorBoundary: ({ status }: { status: number }) =>
            createElement("main", { id: "boundary" }, `boundary:${status}`),
        },
      },
    };

    const rendered = (await renderPageRequest("/staff", {
      routes: [withBoundary],
      createHttp: () => ({ request, response }),
    })) as RenderedPage;

    expect(rendered.html).toContain("boundary:403");
    expect(rendered.html).not.toContain('id="layout"');
    expect(rendered.bundle?.layoutSkipped).toBe(true);
    expect(rendered.html).toContain("layoutSkipped");
  });
});
