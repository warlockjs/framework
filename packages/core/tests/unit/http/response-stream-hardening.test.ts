import { log } from "@warlock.js/logger";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Request } from "../../../src/http/request";
import { Response, toSingleLineSseField } from "../../../src/http/response";
import { beginHttpDrain, startHttpServer } from "../../../src/http/server";

/**
 * Hardening of the long-lived responses (`sse()`, `stream()`) found in the
 * 5.30.0 review: disconnect handlers are isolated, a graceful drain's
 * `Connection: close` survives, and caller values cannot inject SSE fields.
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

describe("onDisconnect handlers", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    app?.server.closeAllConnections();
    await app?.close();
    app = undefined;
  });

  it("a throwing handler is logged, and the handlers after it still run", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => log);
    const laterHandlerRan = deferred<boolean>();
    const streaming = deferred();

    app = Fastify();
    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      sse.onDisconnect(() => {
        throw new Error("handler exploded");
      });
      sse.onDisconnect(() => laterHandlerRan.resolve(true));
      sse.comment("open");
      streaming.resolve();

      return reply;
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const client = http.get({ host: "127.0.0.1", port, path: "/sse" });

    client.on("error", () => undefined);
    await streaming.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    client.destroy();

    await expect(laterHandlerRan.promise).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      "http",
      "stream",
      expect.objectContaining({ message: "handler exploded" }),
      { source: "onDisconnect handler" },
    );
  });
});

describe("SSE field injection", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("toSingleLineSseField removes CR, LF and NUL", () => {
    expect(toSingleLineSseField("a\r\nb\nc\rd\0e")).toBe("abcde");
    expect(toSingleLineSseField(42)).toBe("42");
  });

  it("line breaks in event, id and comment text cannot start new fields or events", async () => {
    app = Fastify();
    app.get("/sse", async (_request, reply) => {
      const sse = bind(reply).sse();

      sse.send("tick\n\nevent: injected\ndata: owned", { ok: true }, "7\nretry: 1");
      sse.comment("note\ndata: injected");
      sse.end();

      return reply;
    });

    const result = await app.inject({ method: "GET", url: "/sse" });
    const lines = result.body.split("\n");

    expect(lines).toContain("event: tickevent: injecteddata: owned");
    expect(lines).toContain("id: 7retry: 1");
    // The comment's second line stays a comment.
    expect(lines).toContain(": data: injected");
    expect(lines.filter((line) => line.startsWith("event:"))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("retry:"))).toBe(false);
    expect(lines.filter((line) => line.startsWith("data:"))).toEqual(['data: {"ok":true}']);
  });
});

describe("long-lived responses during a graceful drain", () => {
  let server: ReturnType<typeof startHttpServer> | undefined;

  afterEach(async () => {
    server?.server.closeAllConnections();
    await server?.close().catch(() => undefined);
    server = undefined;
  });

  async function connectionHeaderFor(
    type: "sse" | "stream",
    drainFirst: boolean,
    headers?: Record<string, string>,
  ): Promise<string | null> {
    server = startHttpServer();
    const started = deferred();
    const release = deferred();

    server.get("/long", async (_request: unknown, reply: FastifyReply) => {
      started.resolve();
      await release.promise;

      const response = bind(reply);

      if (type === "sse") {
        const sse = response.sse({ headers });

        sse.send("tick", { n: 1 });
        sse.end();
      } else {
        const stream = response.stream("text/plain", { headers });

        stream.send("chunk");
        stream.end();
      }

      return reply;
    });

    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    const pending = fetch(`http://127.0.0.1:${port}/long`);

    await started.promise;

    if (drainFirst) beginHttpDrain(server.server);

    release.resolve();

    const response = await pending;

    await response.text();

    return response.headers.get("connection");
  }

  it("an SSE stream started after the drain began keeps Connection: close", async () => {
    await expect(connectionHeaderFor("sse", true)).resolves.toBe("close");
  });

  it("a stream started after the drain began keeps Connection: close", async () => {
    await expect(connectionHeaderFor("stream", true)).resolves.toBe("close");
  });

  it.each(["sse", "stream"] as const)(
    "caller keep-alive cannot override a draining %s reply",
    async (type) => {
      await expect(connectionHeaderFor(type, true, { Connection: "keep-alive" })).resolves.toBe(
        "close",
      );
    },
  );

  it("without a drain, an SSE stream still asks for keep-alive", async () => {
    await expect(connectionHeaderFor("sse", false)).resolves.toBe("keep-alive");
  });
});
