import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import { Response } from "../../../src/http/response";
import type { ResponseStreamController } from "../../../src/http/types";

/**
 * For `response.stream()`: the same contract as `response.sse()` —
 * no unbounded history on the response body, and a producer that can wait
 * for a slow client and learn when it disconnects.
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

describe("response.stream()", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    app?.server.closeAllConnections();
    await app?.close();
    app = undefined;
  });

  it("applies caller stream headers and queues synchronous chunks", async () => {
    app = Fastify();
    app.get("/stream", async (_request, reply) => {
      const response = bind(reply);
      response.header("Cache-Control", "private, no-store");
      const stream = response.stream("text/plain", {
        headers: {
          "Cache-Control": "private, max-age=0",
          "X-Stream": "ready",
          "Content-Length": "3",
        },
      });
      expect(stream.enqueue("hello")).toBe(true);
      stream.end();
      return reply;
    });
    const result = await app.inject({ method: "GET", url: "/stream" });
    expect(result.headers["cache-control"]).toBe("private, max-age=0");
    expect(result.headers["x-stream"]).toBe("ready");
    expect(result.body).toBe("hello");
    expect(result.headers["content-length"]).toBeUndefined();
  });

  it("drops overflow without disconnecting when requested", async () => {
    app = Fastify();
    app.get("/stream", async (_request, reply) => {
      const stream = bind(reply).stream("text/plain", { maxQueuedBytes: 0, onOverflow: "drop" });
      expect(stream.enqueue("too much")).toBe(false);
      expect(stream.signal.aborted).toBe(false);
      expect(await stream.write("too much")).toBe(true);
      stream.send("too much");
      stream.render(createElement("p", null, "too much"));
      expect(stream.dropped).toBe(4);
      stream.end();
      return reply;
    });
    expect((await app.inject({ method: "GET", url: "/stream" })).body).toBe("");
  });

  it("keeps no chunks on the response body by default", async () => {
    app = Fastify();
    let sent: Response | undefined;

    app.get("/stream", async (_request, reply) => {
      sent = bind(reply);
      const stream = sent.stream();

      for (let index = 0; index < 100; index++) stream.send(`${index};`);

      stream.render(createElement("p", null, "rendered"));
      stream.end();

      return reply;
    });

    const port = await listen(app);
    const body = await fetch(`http://127.0.0.1:${port}/stream`).then((response) => response.text());

    expect(body.split(";").length - 1).toBe(100);
    expect(body).toContain("<p>rendered</p>");
    expect(sent?.body).toEqual([]);
  });

  it("keeps only the last `retainChunks` chunks, sent or rendered", async () => {
    app = Fastify();
    let sent: Response | undefined;

    app.get("/stream", async (_request, reply) => {
      sent = bind(reply);
      const stream = sent.stream("text/html", { retainChunks: 2 });

      stream.send("a");
      stream.send("b");
      stream.render(createElement("i", null, "c"));
      stream.end();

      return reply;
    });

    const port = await listen(app);
    await fetch(`http://127.0.0.1:${port}/stream`).then((response) => response.text());

    expect(sent?.body).toEqual(["b", "<i>c</i>"]);
  });

  it("still throws when writing after end()", async () => {
    app = Fastify();
    const thrown = deferred<unknown>();

    app.get("/stream", async (_request, reply) => {
      const stream = bind(reply).stream();

      stream.end();

      try {
        stream.send("late");
        thrown.resolve(undefined);
      } catch (error) {
        thrown.resolve(error);
      }

      return reply;
    });

    const port = await listen(app);
    await fetch(`http://127.0.0.1:${port}/stream`).then((response) => response.text());

    expect(String(await thrown.promise)).toContain("stream has already ended");
  });

  it("write() waits for a slow client instead of buffering ahead of it", async () => {
    app = Fastify();
    const backpressured = deferred<ResponseStreamController>();
    const writeResult = deferred<boolean>();

    app.get("/stream", async (_request, reply) => {
      const stream = bind(reply).stream();

      // Fill the transport until the paused client really blocks it.
      await fillUntilStuck(stream, () => stream.send(PAYLOAD));

      backpressured.resolve(stream);
      writeResult.resolve(await stream.write(PAYLOAD));
      stream.end();

      return reply;
    });

    const port = await listen(app);
    const { response } = pausedGet(port, "/stream");
    const incoming = await response;
    const stream = await backpressured.promise;

    expect(stream.backpressured).toBe(true);

    let settled = false;
    void writeResult.promise.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The client has read nothing, so the write is still waiting.
    expect(settled).toBe(false);

    incoming.resume();

    await expect(writeResult.promise).resolves.toBe(true);
  });

  it("aborts its signal, resolves pending writes with false and ignores later sends on disconnect", async () => {
    app = Fastify();
    const backpressured = deferred<ResponseStreamController>();
    const writeResult = deferred<boolean>();
    const disconnected = deferred();

    app.get("/stream", async (_request, reply) => {
      const stream = bind(reply).stream();

      stream.onDisconnect(() => disconnected.resolve());

      await fillUntilStuck(stream, () => stream.send(PAYLOAD));

      backpressured.resolve(stream);
      writeResult.resolve(await stream.write(PAYLOAD));

      return reply;
    });

    const port = await listen(app);
    const { request, response } = pausedGet(port, "/stream");

    await response;

    const stream = await backpressured.promise;

    request.destroy();

    await disconnected.promise;
    await expect(writeResult.promise).resolves.toBe(false);
    expect(stream.signal.aborted).toBe(true);
    expect(stream.ended).toBe(true);
    // A producer that has not noticed yet must not crash.
    expect(() => stream.send("late")).not.toThrow();
    await expect(stream.drain()).resolves.toBe(false);
    await expect(stream.write("late")).resolves.toBe(false);
  });

  it("drain() resolves immediately when nothing is backed up", async () => {
    app = Fastify();
    const drained = deferred<boolean>();

    app.get("/stream", async (_request, reply) => {
      const stream = bind(reply).stream();

      stream.send("hello");
      drained.resolve(await stream.drain());
      stream.end();

      return reply;
    });

    const port = await listen(app);
    const body = await fetch(`http://127.0.0.1:${port}/stream`).then((response) => response.text());

    expect(body).toBe("hello");
    await expect(drained.promise).resolves.toBe(true);
  });
});
