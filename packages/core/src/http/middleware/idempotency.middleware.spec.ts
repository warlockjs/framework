import { cache, MemoryCacheDriver } from "@warlock.js/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "../request";
import type { Response } from "../response";
import { idempotencyMiddleware } from "./idempotency.middleware";

/**
 * Uses the real memory cache driver through the shared `cache` singleton.
 * Depends on the memory driver's `onConflict: "create"` being atomic (a
 * synchronous check-and-set) for the concurrent case.
 */

function createRequest(): Request {
  return {
    method: "POST",
    body: { a: 1 },
    ip: "1.1.1.1",
    header: (name: string) => (name === "idempotency-key" ? "key-12345678" : undefined),
    locals: {},
    detectIp: () => "1.1.1.1",
  } as unknown as Request;
}

function createResponse() {
  let sent: ((response: Response) => void) | undefined;
  const response = {
    header: vi.fn(),
    onSent: (cb: (response: Response) => void) => {
      sent = cb;
    },
    replay: vi.fn(),
    conflict: vi.fn(),
    badRequest: vi.fn(),
    unprocessableEntity: vi.fn(),
  } as unknown as Response;

  async function send(statusCode: number, parsedBody: unknown = { ok: true }) {
    sent?.({ statusCode, parsedBody, contentType: "application/json" } as unknown as Response);
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { response, send };
}

/** Mimics the pipeline: middleware, then a handler that only runs when it did not short-circuit. */
async function run(handler: () => Promise<number>) {
  const { response, send } = createResponse();
  const middleware = idempotencyMiddleware();
  let handled = false;

  const short = await middleware({ request: createRequest(), response } as any);
  const shortCircuited =
    (response.replay as any).mock.calls.length > 0 || (response.conflict as any).mock.calls.length > 0;

  if (short === undefined && !shortCircuited) {
    handled = true;
    try {
      await send(await handler());
    } catch {
      await send(500);
    }
  }

  return { response, handled };
}

describe("idempotencyMiddleware — reservation", () => {
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
    await cache.flush();
  });

  it("runs the handler once for concurrent requests; the second gets 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const handler = vi.fn(async () => {
      await gate;
      return 200;
    });

    const first = run(handler);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await run(handler);

    expect(second.handled).toBe(false);
    expect(second.response.conflict).toHaveBeenCalledTimes(1);
    expect(second.response.header).toHaveBeenCalledWith("Retry-After", "1");

    release();
    await first;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("replays the stored response after completion", async () => {
    await run(async () => 201);
    const replayed = await run(async () => 201);

    expect(replayed.handled).toBe(false);
    expect(replayed.response.replay).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201, body: { ok: true } }),
    );
  });

  it("frees the key when the handler throws", async () => {
    await run(async () => {
      throw new Error("boom");
    });

    const handler = vi.fn(async () => 200);
    const retry = await run(handler);

    expect(retry.handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
