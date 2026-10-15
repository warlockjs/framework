import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import { Response } from "../../../src/http/response";
import type { ResponseSSEController } from "../../../src/http/types";

/**
 * WR-006: a long-lived SSE stream must not retain its whole history, and its
 * producer needs a way to wait for a slow client instead of buffering
 * without bound.
 */

function bind(reply: FastifyReply): Response {
  const request = new Request();
  const response = new Response();

  response.request = request;
  response.setResponse(reply);
  request.response = response;

  return response;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });

  return (app.server.address() as AddressInfo).port;
}

/** Open a GET whose body is NOT read until `resume()` is called. */
function pausedGet(port: number, path: string) {
  const response = deferred<http.IncomingMessage>();
  const request = http.get({ host: "127.0.0.1", port, path }, (incoming) => {
    incoming.pause();
    response.resolve(incoming);
  });

  request.on("error", () => undefined);

  return { request, response: response.promise };
}

const PAYLOAD = "x".repeat(8 * 1024);

/**
 * Write until the connection is really stuck. Pausing the client only stops
 * Node from reading: the kernel's loopback socket buffers still absorb
 * several MB and the transport emits `drain`, so one "backpressured" reading
 * is not stable. Stop once no drain has come for 150 ms.
 */
async function fillUntilStuck(
  controller: { backpressured: boolean; drain(): Promise<boolean> },
  send: () => void,
): Promise<void> {
  for (;;) {
    while (!controller.backpressured) send();

    const drained = await Promise.race([
      controller.drain(),
      new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 150)),
    ]);

    if (drained === "stuck") return;

    if (drained === false) throw new Error("the stream closed while filling it");
  }
}

describe("response.sse()", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    app?.server.closeAllConnections();
    await app?.close();
    app = undefined;
  });

  it("keeps no events on the response body by default", async () => {
    app = Fastify();
    let sent: Response | undefined;

    app.get("/sse", async (_request, reply) => {
      sent = bind(reply);
      const sse = sent.sse();

      for (let index = 0; index < 100; index++) sse.send("tick", { index, PAYLOAD });

      sse.end();

      return reply;
    });

    const result = await app.inject({ method: "GET", url: "/sse" });

    expect(result.body.split("event: tick").length - 1).toBe(100);
    expect(sent?.body).toEqual([]);
  });

  it("keeps only the last `retainEvents` events", async () => {
    app = Fastify();
    let sent: Response | undefined;

    app.get("/sse", async (_request, reply) => {
      sent = bind(reply);
      const sse = sent.sse({ retainEvents: 2 });

      for (let index = 0; index < 5; index++) sse.send("tick", { index }, String(index));

      sse.end();

      return reply;
    });

    await app.inject({ method: "GET", url: "/sse" });

    expect(sent?.body).toEqual([
      { event: "tick", data: { index: 3 }, id: "3" },
      { event: "tick", data: { index: 4 }, id: "4" },
    ]);
  });

  it("write() waits for a slow client instead of buffering ahead of it", async () => {
    app = Fastify();
    const backpressured = deferred<ResponseSSEController>();
    const writeResult = deferred<boolean>();

    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      // Fill the transport until the paused client really blocks it.
      await fillUntilStuck(sse, () => sse.send("chunk", PAYLOAD));

      backpressured.resolve(sse);
      writeResult.resolve(await sse.write("chunk", PAYLOAD));
      sse.end();

      return reply;
    });

    const port = await listen(app);
    const { response } = pausedGet(port, "/sse");
    const incoming = await response;
    const sse = await backpressured.promise;

    expect(sse.backpressured).toBe(true);

    let settled = false;
    void writeResult.promise.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The client has read nothing, so the write is still waiting.
    expect(settled).toBe(false);

    incoming.resume();

    await expect(writeResult.promise).resolves.toBe(true);
  });

  it("aborts its signal and resolves pending writes with false when the client disconnects", async () => {
    app = Fastify();
    const backpressured = deferred<ResponseSSEController>();
    const writeResult = deferred<boolean>();
    const disconnected = deferred();

    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      sse.onDisconnect(() => disconnected.resolve());

      await fillUntilStuck(sse, () => sse.send("chunk", PAYLOAD));

      backpressured.resolve(sse);
      writeResult.resolve(await sse.write("chunk", PAYLOAD));

      return reply;
    });

    const port = await listen(app);
    const { request, response } = pausedGet(port, "/sse");

    await response;

    const sse = await backpressured.promise;

    request.destroy();

    await disconnected.promise;
    await expect(writeResult.promise).resolves.toBe(false);
    expect(sse.signal.aborted).toBe(true);
    expect(sse.ended).toBe(true);
    await expect(sse.drain()).resolves.toBe(false);
    await expect(sse.write("late", {})).resolves.toBe(false);
  });

  it("drain() resolves immediately when nothing is backed up", async () => {
    app = Fastify();
    const drained = deferred<boolean>();

    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      sse.send("hello", { ok: true });
      drained.resolve(await sse.drain());
      sse.end();

      return reply;
    });

    const port = await listen(app);
    const body = await fetch(`http://127.0.0.1:${port}/sse`).then((response) => response.text());

    expect(body).toContain("event: hello");
    await expect(drained.promise).resolves.toBe(true);
  });
});
