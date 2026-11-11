/**
 * The page renders ONCE per live request.
 *
 * `finishRender` decides the outcome (escalation, status) from the streaming
 * render itself: the attempt that reaches its shell is the response stream, a
 * shell error escalates exactly as a throwing render does, and a data request
 * renders once and keeps no stream. The serializability check is the only
 * pre-render pass over loader data, and the payload budget reuses its text.
 */
import { Writable } from "node:stream";
import { createElement, lazy, Suspense, use } from "react";
import type { PipeableStream } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "@warlock.js/core";
import { createCoreHttp, requestContext } from "./__fixtures__/core-http";
import * as App from "../../__tests__/server/fixtures/root";
import * as layout from "../../__tests__/server/fixtures/layout";
import {
  connectPageContext,
  renderPageRequest,
  type PageContextRunner,
  type PageRouteEntry,
  type PageTripleModule,
} from "./index";
import { connectSharedStore, type SharedStoreResolver } from "../shared";
import { serializeHydrationPayload } from "./build-hydration-payload";
import { PageDataSerializationError } from "./page-data-serialization-error";
import { resetPayloadBudgetReports, resolvePayloadBudget } from "./payload-budget";
import type { ErrorPageModule } from "./error-page";
import type { PageDataBundle } from "./execute-page-request";
import type { RenderedPage } from "./render-page";

const { stringifyCalls, reportCalls } = vi.hoisted(() => ({
  stringifyCalls: [] as unknown[],
  reportCalls: [] as string[],
}));

vi.mock("devalue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("devalue")>();

  return {
    ...actual,
    stringify: (...args: Parameters<typeof actual.stringify>) => {
      stringifyCalls.push(args[0]);
      return actual.stringify(...args);
    },
  };
});

vi.mock("./report-server-error", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./report-server-error")>();

  return {
    ...actual,
    reportServerError: (...args: Parameters<typeof actual.reportServerError>) => {
      reportCalls.push(args[0]);
      return actual.reportServerError(...args);
    },
  };
});

let previousRunner: PageContextRunner | undefined;
let previousResolver: SharedStoreResolver | undefined;

beforeAll(() => {
  previousRunner = connectPageContext(requestContext as unknown as PageContextRunner);
  previousResolver = connectSharedStore(() => requestContext.getStore() as never);
});

afterAll(() => {
  connectPageContext(previousRunner);
  connectSharedStore(previousResolver);
});

beforeEach(() => {
  stringifyCalls.length = 0;
  reportCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pageEntry(path: string, page: Record<string, unknown>): PageRouteEntry {
  return {
    path,
    name: path.slice(1),
    triple: {
      app: App as unknown as PageTripleModule,
      layout: layout as unknown as PageTripleModule,
      page: page as unknown as PageTripleModule,
    },
  };
}

async function render(
  path: string,
  page: Record<string, unknown>,
  options: Partial<Parameters<typeof renderPageRequest>[1]> = {},
): Promise<RenderedPage> {
  const http = createCoreHttp({ url: path });
  const rendered = await renderPageRequest(path, {
    routes: [pageEntry(path, page)],
    createHttp: () => ({ request: http.request, response: http.response }),
    bufferHtml: false,
    ...options,
  });

  if (rendered instanceof Response) throw new Error("unexpected terminal Response");

  return rendered;
}

/** Pipes a stream into one string. */
function drain(stream: PipeableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        callback();
      },
    });

    sink.on("finish", () => resolve(Buffer.concat(chunks).toString("utf8")));
    sink.on("error", reject);
    stream.pipe(sink);
  });
}

function countingPage(counter: { renders: number }) {
  return {
    loader: async () => ({ marker: "single-pass", greeting: "Hello once" }),
    default: ({ data }: { data: { greeting: string } }) => {
      counter.renders += 1;
      return createElement("main", null, data.greeting);
    },
  };
}

function errorPageModule(): ErrorPageModule {
  return { default: () => createElement("main", null, "Sorry about that.") };
}

const isPageData = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as { marker?: unknown }).marker === "single-pass";

const carriesPageData = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  isPageData((value as { pageData?: unknown }).pageData);

describe("a document request renders its page once", () => {
  it("streams the document from the only render, with no buffered copy", async () => {
    const counter = { renders: 0 };
    const rendered = await render("/once", countingPage(counter));

    expect(rendered.status).toBe(200);
    expect(rendered.html).toBe("");
    expect(rendered.pipeableStream).toBeDefined();

    const body = await drain(rendered.pipeableStream!);

    expect(counter.renders).toBe(1);
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(body).toContain("Hello once");
  });

  it("flushes the shell before a slow Suspense boundary resolves", async () => {
    let release!: (value: string) => void;
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    const Slow = () => createElement("span", null, use(slow));
    const rendered = await render("/slow", {
      default: () =>
        createElement(
          "main",
          null,
          "shell",
          createElement(Suspense, { fallback: "LOADING" }, createElement(Slow)),
        ),
    });

    // `renderPageRequest` resolved while the boundary is still pending: the
    // response can start with the shell.
    const body = drain(rendered.pipeableStream!);
    release("arrived");

    const html = await body;
    expect(html).toContain("LOADING");
    expect(html).toContain("arrived");
  });
});

describe("a shell that waits on a component", () => {
  it("renders a lazy component outside any Suspense boundary once it loads, instead of failing the page", async () => {
    const Lazy = lazy(async () => ({ default: () => createElement("p", null, "loaded lazily") }));
    const rendered = await render("/lazy", { default: () => createElement(Lazy) });

    expect(rendered.status).toBe(200);
    expect(rendered.bundle?.error).toBeUndefined();
    expect(await drain(rendered.pipeableStream!)).toContain("loaded lazily");
  });
});

describe("a data request renders once and keeps no stream", () => {
  it("decides the outcome from one render and returns no pipeable stream", async () => {
    const counter = { renders: 0 };
    const rendered = await render("/data-once", countingPage(counter), { dataRequest: true });

    expect(rendered.status).toBe(200);
    expect(rendered.pipeableStream).toBeUndefined();
    expect(counter.renders).toBe(1);
  });

  it("still escalates a render-time throw into the error page payload", async () => {
    const rendered = await render(
      "/data-boom",
      {
        default: () => {
          throw new Error("page render exploded");
        },
      },
      { dataRequest: true, loadErrorPage: async () => errorPageModule() },
    );

    expect(rendered.status).toBe(500);
    expect(rendered.pipeableStream).toBeUndefined();
    expect(rendered.bundle?.errorPage).toBeDefined();
  });
});

describe("escalation runs on the streaming render", () => {
  it("a page that throws while rendering streams the error page with status 500, reported once as a render error", async () => {
    let renders = 0;
    const rendered = await render(
      "/boom",
      {
        default: () => {
          renders += 1;
          throw new Error("page render exploded");
        },
      },
      { loadErrorPage: async () => errorPageModule() },
    );

    expect(rendered.status).toBe(500);

    const body = await drain(rendered.pipeableStream!);

    expect(body).toContain("Sorry about that.");
    expect(renders).toBe(1);
    expect(reportCalls.filter((message) => message.startsWith("SSR render error"))).toHaveLength(1);
    expect(reportCalls.filter((message) => message.startsWith("SSR stream error"))).toHaveLength(0);
  });

  it("an error inside a Suspense boundary stays recoverable: status 200, reported once as a stream error", async () => {
    const Broken = () => {
      throw new Error("inside a boundary");
    };
    const rendered = await render("/recoverable", {
      default: () =>
        createElement(
          "main",
          null,
          "page shell",
          createElement(Suspense, { fallback: "FALLBACK" }, createElement(Broken)),
        ),
    });

    expect(rendered.status).toBe(200);

    const body = await drain(rendered.pipeableStream!);

    expect(body).toContain("page shell");
    expect(reportCalls.filter((message) => message.startsWith("SSR stream error"))).toHaveLength(1);
    expect(reportCalls.filter((message) => message.startsWith("SSR render error"))).toHaveLength(0);
  });
});

describe("loader data is serialized once before render", () => {
  beforeEach(() => {
    resetPayloadBudgetReports();
  });

  it("a document checks the page data once (the budget reuses that text) and embeds it once", async () => {
    const rendered = await render("/count", countingPage({ renders: 0 }), {
      payloadBudget: resolvePayloadBudget({ page: "64kb" }),
    });
    await drain(rendered.pipeableStream!);

    expect(stringifyCalls.filter(isPageData)).toHaveLength(1);
    expect(stringifyCalls.filter(carriesPageData)).toHaveLength(1);
  });

  it("a data request checks the page data once and renders its payload once", async () => {
    await render("/count-data", countingPage({ renders: 0 }), {
      dataRequest: true,
      payloadBudget: resolvePayloadBudget({ page: "64kb" }),
    });

    expect(stringifyCalls.filter(isPageData)).toHaveLength(1);
    expect(stringifyCalls.filter(carriesPageData)).toHaveLength(1);
  });
});

describe("serializeHydrationPayload", () => {
  function bundle(pageData: unknown): PageDataBundle {
    return {
      route: { name: "products.show", path: "/products/:id", params: {}, query: {} },
      pageData,
    } as unknown as PageDataBundle;
  }

  it("serializes a valid payload in one pass", () => {
    const text = serializeHydrationPayload(bundle({ marker: "single-pass" }), "en");

    expect(stringifyCalls).toHaveLength(1);
    expect(text).toContain("single-pass");
  });

  it("names the level, key path and route when loader data cannot cross the wire", () => {
    class Product {
      public name = "chair";
    }

    let thrown: unknown;
    try {
      serializeHydrationPayload(bundle({ product: new Product() }), "en");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PageDataSerializationError);
    expect((thrown as PageDataSerializationError).level).toBe("page");
    expect((thrown as PageDataSerializationError).route).toBe("products.show");
    expect((thrown as Error).message).toContain(".product");
  });
});
