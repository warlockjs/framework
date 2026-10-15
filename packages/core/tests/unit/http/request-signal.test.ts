import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import { Response } from "../../../src/http/response";

/**
 * WR-012: `request.signal` aborts when the client disconnects before the
 * response finishes — and only then. Real loopback sockets, because the
 * distinction (request body fully read vs. client gone) only exists on a real
 * transport.
 */

function bind(reply: FastifyReply): Request {
  const request = new Request();
  const response = new Response();

  response.request = request;
  response.setResponse(reply);
  request.response = response;

  return request;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });

  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

describe("request.signal", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("aborts when the client disconnects before the response finishes", async () => {
    app = Fastify();
    const handlerStarted = deferred();
    const aborted = deferred<unknown>();

    app.get("/long", async (_fastifyRequest, reply) => {
      const request = bind(reply);
      const signal = request.signal;

      signal.addEventListener("abort", () => aborted.resolve(signal.reason));
      handlerStarted.resolve();

      await aborted.promise;

      return reply;
    });

    const baseUrl = await listen(app);
    const client = new AbortController();
    const pending = fetch(`${baseUrl}/long`, { signal: client.signal }).catch(() => undefined);

    await handlerStarted.promise;
    client.abort();
    await pending;

    const reason = await aborted.promise;

    expect(reason).toBeInstanceOf(DOMException);
    expect((reason as DOMException).name).toBe("AbortError");
  });

  it("does not abort when the request body has been read and the response is still running", async () => {
    app = Fastify();
    const seen: { abortedDuringWork?: boolean; abortedAfterFinish?: boolean } = {};
    const finished = deferred();

    app.post("/work", async (_fastifyRequest, reply) => {
      const request = bind(reply);
      const signal = request.signal;

      // The body is fully parsed by now; the incoming stream may already have
      // emitted `close`. Keep working past it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      seen.abortedDuringWork = signal.aborted;

      reply.raw.once("close", () => {
        setImmediate(() => {
          seen.abortedAfterFinish = signal.aborted;
          finished.resolve();
        });
      });

      return { ok: true };
    });

    const baseUrl = await listen(app);
    const response = await fetch(`${baseUrl}/work`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(10_000) }),
    });

    expect(await response.json()).toEqual({ ok: true });
    await finished.promise;

    expect(seen.abortedDuringWork).toBe(false);
    expect(seen.abortedAfterFinish).toBe(false);
  });

  it("attaches its listener lazily and removes it once the response closes", async () => {
    app = Fastify();
    const counts: { before?: number; during?: number; after?: number } = {};
    const finished = deferred();

    app.get("/count", async (_fastifyRequest, reply) => {
      const request = bind(reply);

      counts.before = reply.raw.listenerCount("close");
      void request.signal;
      void request.signal; // the same signal; one listener
      counts.during = reply.raw.listenerCount("close");

      reply.raw.once("finish", () => {
        reply.raw.once("close", () =>
          setImmediate(() => {
            counts.after = reply.raw.listenerCount("close");
            finished.resolve();
          }),
        );
      });

      return { ok: true };
    });

    const baseUrl = await listen(app);

    await (await fetch(`${baseUrl}/count`)).json();
    await finished.promise;

    expect(counts.during).toBe((counts.before ?? 0) + 1);
    expect(counts.after).toBe(0);
  });

  it("never aborts for a request without a bound response", () => {
    const request = new Request();

    expect(request.signal.aborted).toBe(false);
    expect(request.signal).toBe(request.signal);
  });
});
