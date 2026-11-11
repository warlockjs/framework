import config from "@mongez/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectPageContext,
  executePageRequest,
  type PageContextRunner,
  type PageRouteEntry,
} from "../../src/server/index";
import { connectSharedStore, type SharedStoreResolver } from "../../src/shared";
import { createCoreHttp, requestContext } from "../../src/server/__fixtures__/core-http";

/**
 * `web.loaders: "parallel"` starts the app, layout and page loaders together
 * and settles them in the same order as the serial default: the first level
 * that throws or ends the request wins, and nothing a lower level buffered is
 * committed.
 */

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
  vi.stubEnv("NODE_ENV", "development");
  config.set("web", { loaders: "parallel" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  config.set("web", {});
});

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function runInline(triple: PageRouteEntry["triple"], url = "/inline") {
  const created: ReturnType<typeof createCoreHttp>[] = [];

  const result = executePageRequest({
    url,
    routes: [{ path: "/inline", name: "inline", triple }],
    createHttp(match) {
      const http = createCoreHttp({ url, params: match.params, query: match.query });
      created.push(http);
      return http;
    },
  });

  return { result, created };
}

describe('executePageRequest — web.loaders: "parallel"', () => {
  it("starts every level's loader before any of them settles, and keeps each level's data", async () => {
    const order: string[] = [];
    const loaderFor = (level: string) => async () => {
      order.push(`${level}:start`);
      await tick();
      order.push(`${level}:end`);
      return { level };
    };

    const { result } = runInline({
      app: { loader: loaderFor("app") },
      layout: { loader: loaderFor("layout") },
      page: { loader: loaderFor("page") },
    });

    const bundle = await result;

    expect(order.slice(0, 3)).toEqual(["app:start", "layout:start", "page:start"]);
    expect(bundle!.appData).toEqual({ level: "app" });
    expect(bundle!.layoutData).toEqual({ level: "layout" });
    expect(bundle!.pageData).toEqual({ level: "page" });
  });

  it("lets a layout redirect win: the page's buffer and data are never committed, and its signal aborts", async () => {
    let pageSignal: AbortSignal | undefined;
    const pageLoader = vi.fn(async ({ response, signal }: any) => {
      pageSignal = signal;
      response.header("x-from-page", "must-not-commit");
      response.cookie("page-cookie", "must-not-commit");
      await tick(20);
      return { secret: "must not surface" };
    });

    const { result, created } = runInline({
      app: { loader: async () => ({ ok: true }) },
      layout: {
        loader: async ({ response }: any) => {
          await tick(5);
          return response.redirect("/login");
        },
      },
      page: { loader: pageLoader },
    });

    const bundle = await result;
    const { reply } = created[0]!;

    expect(bundle!.shortCircuit).toMatchObject({
      stage: "loaders",
      level: "layout",
      kind: "redirect",
      url: "/login",
    });
    expect(bundle!.commit).toMatchObject({ committedLevels: ["app", "layout"] });
    expect(bundle!.commit!.cookies).toEqual([]);
    expect(reply.appliedHeaders["x-from-page"]).toBeUndefined();
    expect(bundle!.pageData).toBeUndefined();
    // Parallel mode starts the page loader; its result is discarded and its
    // signal tells it to stop.
    expect(pageLoader).toHaveBeenCalledTimes(1);
    expect(pageSignal?.aborted).toBe(true);
  });

  it("lets an app throw win over a page that settled first", async () => {
    const { result } = runInline({
      app: {
        loader: async () => {
          await tick(10);
          throw new Error("app loader failed");
        },
      },
      layout: {},
      page: { loader: async () => ({ fast: true }) },
    });

    const bundle = await result;

    expect(bundle!.error?.boundary.boundaryLevel).toBe("app");
    expect(bundle!.pageData).toBeUndefined();
  });

  it('refuses a value other than "serial" or "parallel", naming the option', async () => {
    config.set("web", { loaders: "fast" });

    const { result } = runInline({ app: {}, layout: {}, page: { loader: async () => ({}) } });

    await expect(result).rejects.toThrow('web.loaders must be "serial" or "parallel"');
  });
});
