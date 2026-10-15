import { cache, MemoryCacheDriver } from "@warlock.js/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "./../request";
import type { Response } from "./../response";
import { cacheMiddleware } from "./cache-response-middleware";

/**
 * `cacheMiddleware`'s `tags` option — joins the core response cache to the
 * same `cache.tags([...]).invalidate()` mechanism `@warlock.js/web`'s page
 * cache already uses (`route.cache.tags`), so `invalidateTags([...])` evicts
 * cached API responses, not just cached pages.
 *
 * `@warlock.js/cache`'s real `memory` driver is used through the same `cache`
 * singleton the middleware imports — no mock — configured exactly like
 * `core/src/connectors/cache-connector.ts` does at boot.
 *
 * The middleware only ever touches `request.getLocaleCode`/`request.path`
 * and `response.onSent`/`response.replay`/`response.isOk`/`response.request`/
 * `response.contentType`/`response.statusCode`/`response.parsedBody` — both
 * `Request` and `Response` are imported as types only in the middleware
 * itself, so minimal fakes satisfying that surface are enough here.
 */

function createRequest(path: string): Request {
  return {
    getLocaleCode: () => "en",
    path,
  } as Request;
}

/** Captures the single `onSent` callback the middleware registers, and lets a test invoke it. */
function createResponse() {
  let sentCallback: ((response: Response) => void) | undefined;

  const response = {
    onSent: (callback: (response: Response) => void) => {
      sentCallback = callback;
    },
    replay: vi.fn(),
  } as unknown as Response;

  async function simulateSend(sent: {
    request: Request;
    statusCode: number;
    parsedBody: unknown;
    contentType?: string;
  }): Promise<void> {
    if (!sentCallback) {
      throw new Error("middleware never registered an onSent callback");
    }

    sentCallback({
      isOk: sent.statusCode >= 200 && sent.statusCode < 300,
      request: sent.request,
      contentType: sent.contentType,
      statusCode: sent.statusCode,
      parsedBody: sent.parsedBody,
    } as unknown as Response);

    // The write inside `onSent` is fire-and-forget — flush the microtask
    // queue so it lands before the test reads the cache back.
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { response, simulateSend };
}

describe("cacheMiddleware — per-request key isolation", () => {
  beforeEach(async () => {
    cache.setCacheConfigurations({
      default: "memory",
      logging: false,
      drivers: { memory: MemoryCacheDriver },
      options: { memory: {} },
    });

    await cache.init();
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  it("gives different users different keys/responses and never mutates the options", async () => {
    const options = {
      cacheKey: (request: Request) => `profile:${(request as unknown as { userId: string }).userId}`,
      withLocale: false,
      ttl: 60,
      tags: (request: Request) => [`u:${(request as unknown as { userId: string }).userId}`],
    };
    const snapshot = { ...options };
    const middleware = cacheMiddleware(options);

    const alice = { ...createRequest("/me"), userId: "alice" } as unknown as Request;
    const bob = { ...createRequest("/me"), userId: "bob" } as unknown as Request;

    const first = createResponse();
    await middleware({ request: alice, response: first.response } as never);
    await first.simulateSend({ request: alice, statusCode: 200, parsedBody: { name: "alice" } });

    const second = createResponse();
    await middleware({ request: bob, response: second.response } as never);

    expect(second.response.replay).not.toHaveBeenCalled();

    await second.simulateSend({ request: bob, statusCode: 200, parsedBody: { name: "bob" } });

    await expect(cache.get("profile:alice")).resolves.toMatchObject({ data: { name: "alice" } });
    await expect(cache.get("profile:bob")).resolves.toMatchObject({ data: { name: "bob" } });
    expect(options).toEqual(snapshot);
    expect(typeof options.cacheKey).toBe("function");
  });
});

describe("cacheMiddleware — tags", () => {
  beforeEach(async () => {
    cache.setCacheConfigurations({
      default: "memory",
      logging: false,
      drivers: { memory: MemoryCacheDriver },
      options: { memory: {} },
    });

    await cache.init();
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  it("evicts a tagged cached response via cache.tags([...]).invalidate()", async () => {
    const request = createRequest("/orders");
    const { response, simulateSend } = createResponse();

    const middleware = cacheMiddleware({
      cacheKey: "orders.list",
      withLocale: false,
      ttl: 60,
      tags: ["orders"],
    });

    await middleware({ request, response } as never);
    await simulateSend({ request, statusCode: 200, parsedBody: { data: [1, 2, 3] } });

    await expect(cache.get("orders.list")).resolves.not.toBeNull();

    await cache.tags(["orders"]).invalidate();

    await expect(cache.get("orders.list")).resolves.toBeNull();
  });

  it("passes the request to a function-form tags option", async () => {
    const request = createRequest("/orders/42");
    const { response, simulateSend } = createResponse();
    let receivedRequest: Request | undefined;

    const middleware = cacheMiddleware({
      cacheKey: "orders.42",
      withLocale: false,
      ttl: 60,
      tags: (tagRequest) => {
        receivedRequest = tagRequest;
        return ["order.42"];
      },
    });

    await middleware({ request, response } as never);
    await simulateSend({ request, statusCode: 200, parsedBody: { id: 42 } });

    expect(receivedRequest).toBe(request);

    await cache.tags(["order.42"]).invalidate();

    await expect(cache.get("orders.42")).resolves.toBeNull();
  });

  it("leaves an untagged cached response unaffected by tag invalidation", async () => {
    const request = createRequest("/products");
    const { response, simulateSend } = createResponse();

    const middleware = cacheMiddleware({
      cacheKey: "products.list",
      withLocale: false,
      ttl: 60,
    });

    await middleware({ request, response } as never);
    await simulateSend({ request, statusCode: 200, parsedBody: { data: [] } });

    await expect(cache.get("products.list")).resolves.not.toBeNull();

    await cache.tags(["orders"]).invalidate();

    await expect(cache.get("products.list")).resolves.not.toBeNull();
  });

  it("serves a HIT from a tagged entry the same way as an untagged one", async () => {
    const request = createRequest("/orders");
    const { response, simulateSend } = createResponse();

    const middleware = cacheMiddleware({
      cacheKey: "orders.list",
      withLocale: false,
      ttl: 60,
      tags: ["orders"],
    });

    await middleware({ request, response } as never);
    await simulateSend({
      request,
      statusCode: 200,
      parsedBody: { data: [1] },
      contentType: "application/json",
    });

    await middleware({ request, response } as never);

    expect(response.replay).toHaveBeenCalledWith({
      status: 200,
      body: { data: [1] },
      contentType: "application/json",
    });
  });
});
