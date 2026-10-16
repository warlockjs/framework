import { EventEmitter } from "node:events";
import config from "@mongez/config";
import { Request, Response } from "@warlock.js/core";
import { parse, stringify } from "devalue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { resolvePageMetadata as ResolvePageMetadata } from "./resolve-page-metadata";

const { resolvePageMetadata, shared } = vi.hoisted(() => ({
  resolvePageMetadata: vi.fn<typeof ResolvePageMetadata>((_input) => ({ metadata: {} })),
  shared: {} as Record<string, unknown>,
}));

vi.mock("./resolve-page-metadata", () => ({ resolvePageMetadata }));
vi.mock("../shared", () => ({
  shared,
  enterSharedScope: vi.fn(() => {
    for (const key of Object.keys(shared)) delete shared[key];
  }),
  sealShared: vi.fn(async () => Object.freeze({ ...shared })),
}));

import {
  connectPageContext,
  executePageRequest,
  RESOLVED_SITE_SHARED,
  type PageRouteEntry,
} from "./execute-page-request";
import { shared as liveShared } from "../shared";
import { composeLayoutModules } from "./compose-layout-modules";
import { PageLoaderTimeoutError } from "./page-loader-timeout-error";
import { ClientDisconnectedError } from "./client-disconnected-error";
import { buildHydrationPayload } from "./build-hydration-payload";
import { defer } from "../loaders/defer";

class ResourceLike {
  public request: unknown;

  public constructor(private readonly value: string) {}

  public toJSON(): unknown {
    return { value: this.value, requestId: (this.request as { id?: string } | undefined)?.id };
  }
}

const request = {
  setValidatedData: vi.fn(),
} as unknown as Request;

function route(
  loaders: Partial<Record<"app" | "layout" | "page", PageRouteEntry["triple"]["app"]["loader"]>>,
): PageRouteEntry {
  return {
    path: "/account",
    name: "account",
    triple: {
      app: { loader: loaders.app },
      layout: { loader: loaders.layout },
      page: { loader: loaders.page },
    },
  };
}

/**
 * A `{ request, response }` pair wired to a fake raw Node req/res, so a test
 * can trip `request-abort-signal.ts`'s "aborted" listener the same way a
 * real dropped connection would, without a real HTTP server.
 */
function abortableHttp(): { request: Request; response: Response; rawRequest: EventEmitter } {
  const rawRequest = new EventEmitter();
  const rawResponse = Object.assign(new EventEmitter(), { writableEnded: false });
  const abortableRequest = {
    setValidatedData: vi.fn(),
    baseRequest: { raw: rawRequest },
  } as unknown as Request;
  const abortableResponse = new Response();

  (abortableResponse as unknown as { baseResponse: unknown }).baseResponse = { raw: rawResponse };

  return { request: abortableRequest, response: abortableResponse, rawRequest };
}

beforeEach(() => {
  resolvePageMetadata.mockClear();
  connectPageContext({
    buildStore: (payload) => payload as never,
    getStore: () => undefined,
    run: async (_store, callback) => callback(),
  });
});

describe("executePageRequest loaders", () => {
  it("merges resolver shared data before middleware and exposes site to loaders", async () => {
    const response = new Response();
    (response as unknown as { baseResponse: { sent: boolean } }).baseResponse = { sent: false };
    const site = { key: "tenant", host: "tenant.test", basePath: "", tenantKey: "tenant-1" };
    const siteRequest = {
      ...request,
      method: "POST",
      body: {},
      validated: () => ({}),
      header: () => undefined,
      site,
      [RESOLVED_SITE_SHARED]: { tenant: "tenant-1" },
    } as unknown as Request;
    const observed: unknown[] = [];
    const entry: PageRouteEntry = {
      path: "/account",
      name: "account",
      triple: {
        app: {
          middleware: [
            () => {
              observed.push((liveShared as unknown as { tenant?: string }).tenant);
            },
          ],
        },
        layout: {},
        page: {
          action: (ctx) => observed.push({ actionSite: ctx.site }),
          loader: (ctx) =>
            observed.push({ shared: (ctx.shared as { tenant?: string }).tenant, site: ctx.site }),
        },
      },
    };

    await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request: siteRequest, response }),
    });

    expect(observed).toEqual(["tenant-1", { actionSite: site }, { shared: "tenant-1", site }]);
  });

  it("leaves site undefined for a single-site loader", async () => {
    const observed: unknown[] = [];
    const entry = route({ page: (ctx) => observed.push(ctx.site) });

    await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: new Response() }),
    });

    expect(observed).toEqual([undefined]);
  });

  it("preserves a returned core Response and does not start lower loaders", async () => {
    const calls: string[] = [];
    const terminal = new Response();
    const finish = vi.fn();
    const entry = route({
      app: () => calls.push("app"),
      layout: () => {
        calls.push("layout");
        return terminal;
      },
      page: () => calls.push("page"),
    });

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: terminal }),
      finish,
    });

    expect(result).toBe(terminal);
    expect(calls).toEqual(["app", "layout"]);
    expect(resolvePageMetadata).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("awaits ordinary loaders root-to-leaf and keeps their values as data", async () => {
    const calls: string[] = [];
    const response = new Response();
    const entry = route({
      app: async () => {
        calls.push("app:start");
        await Promise.resolve();
        calls.push("app:end");
        return { app: true };
      },
      layout: async () => {
        calls.push("layout:start");
        await Promise.resolve();
        calls.push("layout:end");
        return 0;
      },
      page: () => {
        calls.push("page");
        return false;
      },
    });

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response }),
    });

    expect(calls).toEqual(["app:start", "app:end", "layout:start", "layout:end", "page"]);
    expect(result).toMatchObject({
      appData: { app: true },
      layoutData: 0,
      pageData: false,
    });
  });

  it("serializes loader toJSON values into the hydration payload without rewriting caller data", async () => {
    const resource = new ResourceLike("direct");
    const nested = new ResourceLike("nested");
    const listed = new ResourceLike("listed");
    const pageRequest = { ...request, id: "loader-request" } as Request;
    const result = await executePageRequest({
      url: "/account",
      routes: [route({ page: () => ({ resource, nested: { nested }, list: [listed] }) })],
      createHttp: () => ({ request: pageRequest, response: new Response() }),
    });

    expect(parse(stringify(buildHydrationPayload(result as never, "en")))).toMatchObject({
      pageData: {
        resource: { value: "direct", requestId: "loader-request" },
        nested: { nested: { value: "nested", requestId: "loader-request" } },
        list: [{ value: "listed", requestId: "loader-request" }],
      },
    });
    expect(resource).toBeInstanceOf(ResourceLike);
    expect(resource.request).toBe(pageRequest);
  });

  it("serializes a deferred toJSON value when it settles", async () => {
    const pageRequest = { ...request, id: "deferred-request" } as Request;
    const deferred = Promise.resolve(new ResourceLike("later"));
    const result = (await executePageRequest({
      url: "/account",
      routes: [route({ page: () => defer({ deferred }) })],
      createHttp: () => ({ request: pageRequest, response: new Response() }),
    })) as { deferredSettlements: Record<string, Promise<unknown>> };

    await expect(result.deferredSettlements.deferred).resolves.toEqual({
      ok: true,
      value: { value: "later", requestId: "deferred-request" },
    });
  });

  it("keeps composed layout values request-local for stage-8 metadata without adding them to the bundle", async () => {
    const composedLayout = composeLayoutModules(
      [
        {
          metadata: () => ({ title: "outer" }),
          loader: () => ({ layout: "outer" }),
        },
        {
          metadata: () => ({ title: "inner" }),
          loader: () => ({ layout: "inner" }),
        },
      ],
      1,
    );
    const entry: PageRouteEntry = {
      path: "/account",
      name: "account",
      triple: {
        app: {
          metadata: () => ({ title: "root" }),
          loader: () => ({ app: true }),
        },
        layout: composedLayout,
        page: {
          metadata: () => ({ title: "page" }),
          loader: () => ({ page: true }),
        },
      },
    };

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: new Response() }),
    });
    const metadataInput = resolvePageMetadata.mock.calls[0]?.[0];

    expect(metadataInput?.ancestors).toEqual([
      { kind: "root", metadata: entry.triple.app.metadata, data: { app: true } },
      { kind: "layout", metadata: composedLayout.layoutMetadata?.[0], data: { layout: "outer" } },
      { kind: "layout", metadata: composedLayout.layoutMetadata?.[1], data: { layout: "inner" } },
    ]);
    expect(result).toMatchObject({ layoutData: { layout: "inner" } });
    expect(result).not.toHaveProperty("capturedLayoutData");
  });
});

describe("executePageRequest ctx.signal", () => {
  it("hands every loader the same AbortSignal instance", async () => {
    const { request: abortRequest, response } = abortableHttp();
    const signals: AbortSignal[] = [];
    const entry = route({
      app: ({ signal }) => {
        signals.push(signal);
      },
      layout: ({ signal }) => {
        signals.push(signal);
      },
      page: ({ signal }) => {
        signals.push(signal);
      },
    });

    await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request: abortRequest, response }),
    });

    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]).toBe(signals[2]);
    expect(signals[0]?.aborted).toBe(false);
  });

  it("does not start the layout or page loader once the request is aborted after the app loader", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const calls: string[] = [];
    const entry = route({
      app: () => {
        calls.push("app");
        // Simulate the client disconnecting while the app loader is
        // already running — the app loader still completes, but the
        // boundary check before the NEXT level must see it.
        rawRequest.emit("aborted");
      },
      layout: () => {
        calls.push("layout");
      },
      page: () => {
        calls.push("page");
      },
    });

    await expect(
      executePageRequest({
        url: "/account",
        routes: [entry],
        createHttp: () => ({ request: abortRequest, response }),
      }),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);

    expect(calls).toEqual(["app"]);
  });

  // Review fix: an abandoned request answers nobody, but a genuine loader bug
  // that happened first is still a bug and rides along for the handler to report.
  it("keeps a genuine loader failure as the cause when the client then disconnects", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
    const entry = route({
      app: () => {
        rawRequest.emit("aborted");
        throw bug;
      },
    });

    const rejection = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request: abortRequest, response }),
    }).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ClientDisconnectedError);
    expect((rejection as ClientDisconnectedError).cause).toBe(bug);
  });

  it("drops a failure the abort itself caused", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const entry = route({
      app: () => {
        rawRequest.emit("aborted");
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });

    const rejection = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request: abortRequest, response }),
    }).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ClientDisconnectedError);
    expect((rejection as ClientDisconnectedError).cause).toBeUndefined();
  });

  it("discards a cookie a loader queued before the request was abandoned", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const setCookie = vi.spyOn(response, "cookie");
    const entry = route({
      app: ({ response: bufferedResponse }) => {
        bufferedResponse.cookie("session", "abc");
        rawRequest.emit("aborted");
      },
    });

    await expect(
      executePageRequest({
        url: "/account",
        routes: [entry],
        createHttp: () => ({ request: abortRequest, response }),
      }),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);

    expect(setCookie).not.toHaveBeenCalled();
  });

  // WR-016: an abandoned POST used to reach `finish` (the full render) with
  // the layout's loader data missing, and the layout's own read of it threw.
  it("never calls finish for a request abandoned while its loaders ran", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const finish = vi.fn();
    const entry = route({
      app: () => {
        rawRequest.emit("aborted");
      },
      layout: () => ({ activePage: "inspect" }),
    });

    await expect(
      executePageRequest({
        url: "/account",
        routes: [entry],
        createHttp: () => ({ request: abortRequest, response }),
        finish,
      }),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);

    expect(finish).not.toHaveBeenCalled();
  });

  it("never calls finish for a request abandoned after its loaders finished", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const finish = vi.fn();
    const entry = route({
      page: () => {
        // The last level: no later level boundary sees this abort.
        rawRequest.emit("aborted");
      },
    });

    await expect(
      executePageRequest({
        url: "/account",
        routes: [entry],
        createHttp: () => ({ request: abortRequest, response }),
        finish,
      }),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);

    expect(finish).not.toHaveBeenCalled();
  });

  // FW-08: a crossed navigation aborted the request after the layout loader
  // and before the page loader, and the page component rendered with `data`
  // undefined (`Cannot destructure property 'create' of 'data'`).
  it("never renders the page when the request is abandoned between the layout and page loaders", async () => {
    const { request: abortRequest, response, rawRequest } = abortableHttp();
    const finish = vi.fn();
    const calls: string[] = [];
    const entry = route({
      app: () => {
        calls.push("app");
      },
      layout: () => {
        calls.push("layout");
        rawRequest.emit("aborted");

        return { activePage: "maintenances" };
      },
      page: () => {
        calls.push("page");

        return { create: true };
      },
    });

    await expect(
      executePageRequest({
        url: "/account",
        routes: [entry],
        createHttp: () => ({ request: abortRequest, response }),
        finish,
      }),
    ).rejects.toBeInstanceOf(ClientDisconnectedError);

    expect(calls).toEqual(["app", "layout"]);
    expect(finish).not.toHaveBeenCalled();
  });

  it("commits a loader's cookie unchanged when the request is never aborted", async () => {
    const { request: abortRequest, response } = abortableHttp();
    const entry = route({
      app: ({ response: bufferedResponse }) => {
        bufferedResponse.cookie("session", "abc");
      },
    });

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request: abortRequest, response }),
    });

    expect((result as { commit?: { cookies: unknown[] } }).commit?.cookies).toEqual([
      { name: "session", value: "abc", options: undefined },
    ]);
  });
});

/**
 * Card `904a04eb`, audit §5.1: a non-deferred loader that never resolves
 * used to hold the request open forever. `web.loaderTimeout` bounds the
 * whole non-deferred loader chain (app → layout → page loaders, plus
 * `validation`) — never a `defer()`-ed value, never the render.
 */
describe("executePageRequest — web.loaderTimeout (card 904a04eb)", () => {
  afterEach(() => {
    config.set("web", {});
  });

  it("fails a hung page loader with PageLoaderTimeoutError (statusCode 504) within a few hundred ms", async () => {
    config.set("web", { loaderTimeout: 50 });
    const entry = route({
      page: () => new Promise(() => undefined),
    });

    const startedAt = Date.now();
    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: new Response() }),
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1000);

    const bundle = result as { error?: { error: unknown; statusCode?: number } };
    expect(bundle.error?.error).toBeInstanceOf(PageLoaderTimeoutError);
    expect(bundle.error?.statusCode).toBe(504);
  }, 2000);

  // WR-016: the disconnect guard must not swallow OUR OWN timeout abort — the
  // client is still connected on a real transport and still gets the 504.
  it("still renders the 504 for a loader timeout on a connected real transport", async () => {
    config.set("web", { loaderTimeout: 50 });
    const { request: connectedRequest, response } = abortableHttp();
    const finish = vi.fn(async (bundle: unknown) => bundle);
    const entry = route({
      page: () => new Promise(() => undefined),
    });

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request: connectedRequest, response }),
      finish,
    });

    expect(finish).toHaveBeenCalledTimes(1);
    const bundle = result as { error?: { error: unknown; statusCode?: number } };
    expect(bundle.error?.error).toBeInstanceOf(PageLoaderTimeoutError);
    expect(bundle.error?.statusCode).toBe(504);
  }, 2000);

  it("aborts the request's ctx.signal once the loader timeout fires", async () => {
    config.set("web", { loaderTimeout: 50 });
    let capturedSignal: AbortSignal | undefined;
    const entry = route({
      page: ({ signal }) => {
        capturedSignal = signal;
        return new Promise(() => undefined);
      },
    });

    await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: new Response() }),
    });

    expect(capturedSignal?.aborted).toBe(true);
  }, 2000);

  it("loaderTimeout: 0 disables the bound — a loader resolving at 100ms still returns its data", async () => {
    config.set("web", { loaderTimeout: 0 });
    const entry = route({
      page: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 100);
        }),
    });

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: new Response() }),
    });

    expect((result as { pageData?: unknown }).pageData).toEqual({ ok: true });
    expect((result as { error?: unknown }).error).toBeUndefined();
  }, 2000);

  it("does not affect an ordinary fast loader", async () => {
    config.set("web", { loaderTimeout: 50 });
    const entry = route({
      page: () => ({ fast: true }),
    });

    const result = await executePageRequest({
      url: "/account",
      routes: [entry],
      createHttp: () => ({ request, response: new Response() }),
    });

    expect((result as { pageData?: unknown }).pageData).toEqual({ fast: true });
    expect((result as { error?: unknown }).error).toBeUndefined();
  });
});
